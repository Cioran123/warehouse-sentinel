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
        className="mx-0.5 inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0 font-mono text-[11px] text-accent hover:bg-accent/15"
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
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      <div ref={scrollRef} className="flex max-h-[420px] min-h-[160px] flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] leading-relaxed text-ink-2">
              Ask what happens in this clip. Answers use keyframes from the span plus the recorded evidence, and
              cited moments like <span className="font-mono text-accent">▶ 0:12</span> jump the player.
            </p>
            <div className="-mx-2 flex flex-col items-start">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="max-w-[85%] self-end rounded-xl bg-sunken px-3 py-2 text-[13px] text-ink">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-1">
              <div
                className={`whitespace-pre-wrap text-[13px] leading-relaxed ${
                  m.error
                    ? "rounded-lg border border-high-line bg-high-soft px-3 py-2 text-high"
                    : m.mode === "refused"
                      ? "rounded-lg border border-medium-line bg-medium-soft px-3 py-2 text-medium"
                      : "text-ink"
                }`}
              >
                {withTimestamps(m.content, onSeek)}
              </div>
              {m.mode && m.mode !== "claude" && (
                <span className="text-[12px] text-ink-3">
                  {m.mode === "evidence" ? "Recorded evidence only (no model configured)" : "Out of scope for this system"}
                </span>
              )}
            </div>
          ),
        )}
        {loading && (
          <div className="flex items-center gap-2 self-start py-1 text-[12px] text-ink-3">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${d}ms` }} />
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
        className="m-3 flex items-center gap-2 rounded-lg border border-line-strong bg-surface p-1 pl-3 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Ask about this clip…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:bg-sunken disabled:text-ink-3"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
