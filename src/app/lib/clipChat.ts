import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeFrameBatch, getAnthropic, type FrameInput } from "@/app/lib/anthropic";
import { extractThumbnail } from "@/app/lib/ffmpeg";
import { formatSpan } from "@/app/lib/format";
import { loadIncidentView, type IncidentView } from "@/app/lib/incidentView";
import { unsupportedTerm } from "@/app/lib/search";
import { CLIPS_DIR } from "@/app/lib/storage";
import { EVENT_LABEL } from "@/app/lib/types";
import { cameraVideoPath, fileExists } from "@/app/lib/venue";
import { traced } from "@/app/lib/weave";

export interface ClipTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ClipAnswer {
  answer: string;
  /** claude: answered from keyframes + ledger; evidence: no model available; refused: out of scope. */
  mode: "claude" | "evidence" | "refused";
  /** Source-video timestamps of the keyframes the model saw. */
  frameTimes: number[];
}

const KEYFRAMES = 6;
const frameCache = new Map<string, Promise<FrameInput[]>>();

/** Evenly spaced keyframes over the incident span plus a second of context on each side. */
async function keyframes(view: IncidentView): Promise<FrameInput[]> {
  const { incident, camera, live } = view;
  const video = live ? path.join(CLIPS_DIR, `${incident.id}.mp4`) : cameraVideoPath(camera);
  if (!(await fileExists(video))) return [];
  const start = live ? incident.startSec : Math.max(0, incident.startSec - 1);
  const end = live ? incident.endSec : Math.min(camera.durationSec || incident.endSec + 1, incident.endSec + 1);
  const span = Math.max(0.5, end - start);
  const times = Array.from({ length: KEYFRAMES }, (_, k) => start + (span * (k + 0.5)) / KEYFRAMES);
  const dir = path.join(os.tmpdir(), "sentinel-ask", incident.id);
  const frames: FrameInput[] = [];
  for (const [k, t] of times.entries()) {
    const out = path.join(dir, `f${k}.jpg`);
    try {
      // Live clips start at the incident's startSec, so seek relative to the clip.
      await extractThumbnail(video, out, live ? t - incident.startSec : t);
      frames.push({ base64: (await fs.readFile(out)).toString("base64"), timestamp: t });
    } catch (err) {
      console.warn(`[ask] keyframe at ${t.toFixed(1)}s failed:`, err instanceof Error ? err.message : err);
    }
  }
  return frames;
}

function cachedKeyframes(view: IncidentView): Promise<FrameInput[]> {
  const key = `${view.incident.id}:${view.incident.startSec}:${view.incident.endSec}`;
  let p = frameCache.get(key);
  if (!p) {
    p = keyframes(view).catch(() => []);
    frameCache.set(key, p);
    void p.then((frames) => {
      if (!frames.length) frameCache.delete(key);
    });
  }
  return p;
}

function evidenceSummary(view: IncidentView): string {
  const i = view.incident;
  const obs = i.observations.length ? i.observations : i.signalNotes ?? [];
  return [
    `${EVENT_LABEL[i.eventType]} on ${view.camera.id} (${view.camera.zone}), ${formatSpan(i.startSec, i.endSec)}.`,
    i.cosmosExplanation ? `Verifier: ${i.cosmosExplanation}` : "No verifier explanation recorded.",
    obs.length ? `Evidence: ${obs.map((o) => o.replace(/\.$/, "")).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildPrompt(view: IncidentView, history: ClipTurn[], question: string, frameTimes: number[]): string {
  const i = view.incident;
  return `You help a safety supervisor review one candidate incident from warehouse camera footage.
${frameTimes.length ? `The images above are keyframes from the source video at the labeled timestamps (seconds).` : "No keyframes are available; answer from the record below only."}

Incident record:
- Type: ${EVENT_LABEL[i.eventType]} (${i.priority} priority, verification: ${i.verificationStatus})
- Camera: ${view.camera.id}, zone ${view.camera.zone}
- Span: ${i.startSec.toFixed(1)}s to ${i.endSec.toFixed(1)}s
- Scenario label: ${view.camera.scenario}
- Verifier explanation: ${i.cosmosExplanation ?? "none"}
- Verifier observations: ${i.observations.join("; ") || "none"}
- Candidate-check notes: ${(i.signalNotes ?? []).join("; ") || "none"}
- Signals: ${i.signals ? JSON.stringify(i.signals) : "none"}
- Highlighted track ids: ${i.trackIds?.join(", ") || "none"}

Rules:
- Describe only what is observable (positions, movement, posture, distances between people and vehicles). Say plainly when the frames or record cannot answer.
- Never identify people or infer identity, intent, blame, intoxication, or medical conditions.
- Use cautious language ("appears", "possible") and keep it under 120 words.
- When you refer to a moment, cite its source timestamp exactly as [t=12.4s].

${history.length ? `Earlier in this conversation:\n${history.slice(-6).map((t) => `${t.role}: ${t.content}`).join("\n")}\n\n` : ""}Operator question: ${question}`;
}

async function askImpl(id: string, question: string, history: ClipTurn[]): Promise<ClipAnswer | null> {
  const view = await loadIncidentView(id);
  if (!view) return null;

  const term = unsupportedTerm(question);
  if (term) {
    return {
      answer: `I can't help with "${term}": Warehouse Sentinel only describes observable movement and posture, not identity, blame, or medical conditions. ${evidenceSummary(view)}`,
      mode: "refused",
      frameTimes: [],
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      answer: `Clip Q&A needs ANTHROPIC_API_KEY. Here is the recorded evidence instead: ${evidenceSummary(view)}`,
      mode: "evidence",
      frameTimes: [],
    };
  }

  const frames = await cachedKeyframes(view);
  const frameTimes = frames.map((f) => f.timestamp);
  const prompt = buildPrompt(view, history, question, frameTimes);
  let answer: string;
  if (frames.length) {
    answer = await analyzeFrameBatch(frames, prompt);
  } else {
    const res = await getAnthropic().messages.create({
      model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5",
      max_tokens: 600,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content[0];
    answer = block && block.type === "text" ? block.text : "";
  }
  return { answer: answer.trim() || "No answer returned.", mode: "claude", frameTimes };
}

export function askAboutClip(id: string, question: string, history: ClipTurn[]): Promise<ClipAnswer | null> {
  return traced("sentinel.ask_clip", askImpl, id, question, history);
}
