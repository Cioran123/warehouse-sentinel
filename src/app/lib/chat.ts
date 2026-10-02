import { getAnthropic } from "@/app/lib/anthropic";
import { formatSpan } from "@/app/lib/format";
import {
  DEFAULT_STATUSES,
  describeFilters,
  parseQuery,
  searchWithFilters,
  unsupportedTerm,
  type IndexBackend,
  type SearchFilters,
  type SearchResponse,
  type ZoneCount,
} from "@/app/lib/search";
import {
  EVENT_LABEL,
  EVENT_TYPES,
  type Camera,
  type EventType,
  type Incident,
  type Priority,
  type VerificationStatus,
} from "@/app/lib/types";
import { loadVenue } from "@/app/lib/venue";
import { traced } from "@/app/lib/weave";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatTurn[];
  /** Filters behind the previous answer, so follow-ups like "only the high-priority ones" refine it. */
  context?: SearchFilters | null;
}

export interface ChatResponse {
  reply: string;
  replyBy: "claude" | "template";
  /** Incidents to show under the reply, most relevant first. */
  incidents: Incident[];
  totalResults: number;
  /** Zones the answer refers to, for highlighting on the venue map. */
  zoneIds: string[];
  zoneCounts?: ZoneCount[];
  filters: SearchFilters;
  parser: SearchResponse["parser"];
  backend?: IndexBackend;
  followUp: boolean;
}

const MAX_SHOWN = 20;
const FOLLOW_UP = /^(only|just|and|also|but|what about|how about|now|of those|which of|same|exclude|include|any of|show me only|show only)\b|\b(those|them|these|they)\b/i;

const STATUS_TEXT: Record<VerificationStatus, string> = {
  kept: "verifier kept it",
  candidate: "unverified",
  rejected: "verifier rejected it",
};

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function cleanContext(raw: unknown, cameras: Camera[]): SearchFilters | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const zones = new Set(cameras.map((c) => c.zoneId));
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const statuses = strings(r.statuses).filter((s): s is VerificationStatus => ["kept", "candidate", "rejected"].includes(s));
  return {
    eventTypes: strings(r.eventTypes).filter((t): t is EventType => (EVENT_TYPES as string[]).includes(t)),
    zoneIds: strings(r.zoneIds).filter((z) => zones.has(z)),
    priorities: strings(r.priorities).filter((p): p is Priority => ["low", "medium", "high"].includes(p)),
    statuses: statuses.length ? statuses : DEFAULT_STATUSES,
    intent: r.intent === "zone_counts" ? "zone_counts" : "list",
  };
}

function mergeFollowUp(ctx: SearchFilters, latest: SearchFilters, question: string): SearchFilters {
  return {
    eventTypes: latest.eventTypes.length ? latest.eventTypes : ctx.eventTypes,
    zoneIds: latest.zoneIds.length ? latest.zoneIds : ctx.zoneIds,
    priorities: latest.priorities.length ? latest.priorities : ctx.priorities,
    statuses: sameSet(latest.statuses, DEFAULT_STATUSES) ? ctx.statuses : latest.statuses,
    intent: latest.intent === "zone_counts" ? "zone_counts" : ctx.intent,
    // A refinement need not name an event or zone itself; only explicit out-of-scope asks are refused.
    unsupported: unsupportedTerm(question) ? latest.unsupported : undefined,
  };
}

function incidentLine(i: Incident): string {
  const notes = (i.observations.length ? i.observations : i.signalNotes ?? []).slice(0, 2).join("; ");
  return `- ${i.id}: ${EVENT_LABEL[i.eventType]} at ${i.zone} (${i.cameraId}, ${formatSpan(i.startSec, i.endSec)}), ${i.priority} priority, ${STATUS_TEXT[i.verificationStatus]}${notes ? `. Evidence: ${notes}` : ""}`;
}

function templateReply(res: SearchResponse, cameras: Camera[]): string {
  if (res.filters.unsupported || res.results.length === 0) return res.message ?? "No supported incident found.";
  if (res.zoneCounts) {
    const top = res.zoneCounts.find((z) => z.total > 0);
    return `${res.message}${top ? ` The busiest zone is ${top.zone} with ${top.total}.` : ""}`;
  }
  const n = res.results.length;
  const top = res.results[0];
  const zones = new Set(res.results.map((i) => i.cameraId));
  return [
    `${n} matching incident${n === 1 ? "" : "s"} (${describeFilters(res.filters, cameras)}).`,
    `Highest priority: ${EVENT_LABEL[top.eventType].toLowerCase()} at ${top.zone} (${top.cameraId}, ${formatSpan(top.startSec, top.endSec)}, ${STATUS_TEXT[top.verificationStatus]}).`,
    zones.size > 1 ? `Spread across ${zones.size} cameras.` : "",
    "Review recommended before acting.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function claudeReply(
  history: ChatTurn[],
  res: SearchResponse,
  cameras: Camera[],
): Promise<{ reply: string; incidentIds: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const listed = res.results.slice(0, 12);
  const zoneTable = res.zoneCounts
    ?.map((z) => `- ${z.zone}: ${z.total} incidents, ${z.kept} kept`)
    .join("\n");
  const prompt = `You are the review assistant for Warehouse Sentinel, a tool that prioritizes warehouse safety camera footage for human review.
Answer the operator's latest question using ONLY the search results below. Do not invent incidents, times, or details.
Use cautious language ("possible", "review recommended"). Never claim identity, intent, blame, or medical conditions, and never judge individual workers.
Keep the reply to 1-3 sentences (under 70 words). Mention zones and camera ids where useful.

Conversation so far:
${history.slice(-6).map((t) => `${t.role}: ${t.content}`).join("\n")}

Interpreted search: ${describeFilters(res.filters, cameras)}
${res.message ? `System note: ${res.message}\n` : ""}Results (${res.results.length} total${res.results.length > listed.length ? `, first ${listed.length} shown` : ""}):
${listed.map(incidentLine).join("\n") || "(none)"}
${zoneTable ? `Zone counts:\n${zoneTable}` : ""}

Return ONLY JSON: {"reply": "...", "incidentIds": ["ids from the results, most relevant first"]}`;
  try {
    const out = await getAnthropic().messages.create({
      model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5",
      max_tokens: 400,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    const block = out.content[0];
    const text = block && block.type === "text" ? block.text : "";
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as { reply?: unknown; incidentIds?: unknown };
    if (typeof parsed.reply !== "string" || !parsed.reply.trim()) return null;
    const known = new Set(res.results.map((i) => i.id));
    const ids = Array.isArray(parsed.incidentIds)
      ? parsed.incidentIds.filter((x): x is string => typeof x === "string" && known.has(x))
      : [];
    return { reply: parsed.reply.trim(), incidentIds: ids };
  } catch (err) {
    console.warn("[chat] Claude reply failed, using template:", err instanceof Error ? err.message : err);
    return null;
  }
}

function zonesFor(res: SearchResponse, cameras: Camera[]): string[] {
  if (res.filters.unsupported) return [];
  if (res.zoneCounts) return res.zoneCounts.filter((z) => z.total > 0).map((z) => z.zoneId);
  const zoneOf = new Map(cameras.map((c) => [c.id, c.zoneId]));
  const ids = Array.from(new Set(res.results.map((i) => zoneOf.get(i.cameraId)).filter((z): z is string => !!z)));
  return ids.length ? ids : res.filters.zoneIds;
}

async function chatImpl(req: ChatRequest): Promise<ChatResponse> {
  const venue = await loadVenue();
  const question = req.messages[req.messages.length - 1].content;
  const context = cleanContext(req.context, venue.cameras);
  const followUp = !!context && FOLLOW_UP.test(question.trim());

  const parsed = await parseQuery(question);
  const filters = followUp && context ? mergeFollowUp(context, parsed.filters, question) : parsed.filters;
  const res = await searchWithFilters(question, filters, parsed.parser);

  const viaClaude = res.filters.unsupported ? null : await claudeReply(req.messages, res, venue.cameras);
  const picked = viaClaude?.incidentIds ?? [];
  const ordered = [
    ...picked.map((id) => res.results.find((i) => i.id === id)!),
    ...res.results.filter((i) => !picked.includes(i.id)),
  ];

  return {
    reply: viaClaude?.reply ?? templateReply(res, venue.cameras),
    replyBy: viaClaude ? "claude" : "template",
    incidents: ordered.slice(0, MAX_SHOWN),
    totalResults: res.results.length,
    zoneIds: zonesFor(res, venue.cameras),
    zoneCounts: res.zoneCounts,
    filters: res.filters,
    parser: res.parser,
    backend: res.backend,
    followUp,
  };
}

export function chat(req: ChatRequest): Promise<ChatResponse> {
  return traced("sentinel.chat", chatImpl, req);
}
