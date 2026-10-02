"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ClipAnswer, ClipTurn } from "@/app/lib/clipChat";
import { fetchWithToast } from "@/app/lib/fetchWithToast";
import { formatTime } from "@/app/lib/format";
import type { Incident } from "@/app/lib/types";

const SUGGESTIONS = [
  "What happens right before the flagged span?",
  "Describe the movement of the highlighted people.",
  "What supports the verifier's decision?",
  "Is anything ambiguous in this clip?",
];

type Message = { id: number; role: "user" | "assistant"; content: string; mode?: ClipAnswer["mode"]; error?: boolean };

const TIMESTAMP = /\[t=(\d+(?:\.\d+)?)s\]/g;

/** Turns [t=12.4s] citations into buttons that seek the player. */
function withTimestamps(text: string, onSeek: (t: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TIMESTAMP)) {
    const t = Number(m[1]);
    out.push(text.slice(last, m.index));
    out.push(
      <button
        key={`${m.index}-${t}`}
        type="button"
        onClick={() => onSeek(t)}
        className="mx-0.5 inline-flex items-center gap-1 rounded bg-sky-400/15 px-1.5 py-0 font-mono text-[11px] text-sky-200 hover:bg-sky-400/30"
        title="Jump to this moment"
      >
        ▶ {formatTime(t)}
      </button>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export default function ClipChat({ incident, onSeek }: { incident: Incident; onSeek: (t: number) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    const history: ClipTurn[] = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { id: nextId.current++, role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetchWithToast(
        `/api/incidents/${encodeURIComponent(incident.id)}/ask`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history }) },
        { errorMessage: "Clip question failed" },
      );
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as ClipAnswer;
      setMessages((m) => [...m, { id: nextId.current++, role: "assistant", content: data.answer, mode: data.mode }]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: nextId.current++, role: "assistant", content: "Could not answer that. Try again.", error: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-col rounded-xl border border-white/10 bg-[#0c0c12]">
      <div ref={scrollRef} className="flex max-h-[420px] min-h-[160px] flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-slate-400">
              Ask what happens in this clip. Answers use keyframes from the span plus the recorded evidence, and
              cited moments like <span className="font-mono text-sky-300">▶ 0:12</span> jump the player.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-left text-[11px] text-slate-400 transition-colors hover:border-white/25 hover:text-slate-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="self-end rounded-xl rounded-tr-sm bg-sky-500/15 px-3 py-2 text-[13px] text-sky-50">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-1">
              <div
                className={`whitespace-pre-wrap rounded-xl rounded-tl-sm px-3 py-2 text-[13px] leading-relaxed ${
                  m.error
                    ? "border border-red-500/40 bg-red-500/10 text-red-100"
                    : m.mode === "refused"
                      ? "border border-amber-500/40 bg-amber-500/10 text-amber-100"
                      : "bg-white/[0.05] text-slate-200"
                }`}
              >
                {withTimestamps(m.content, onSeek)}
              </div>
              {m.mode && m.mode !== "claude" && (
                <span className="text-[10px] text-slate-500">
                  {m.mode === "evidence" ? "Recorded evidence only (no model configured)" : "Out of scope for this system"}
                </span>
              )}
            </div>
          ),
        )}
        {loading && (
          <div className="flex items-center gap-2 self-start rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] text-slate-400">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            Looking at keyframes…
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex gap-2 border-t border-white/10 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Ask about this clip…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#09090f] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
