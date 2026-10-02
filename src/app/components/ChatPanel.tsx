"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatResponse, ChatTurn } from "@/app/lib/chat";
import { fetchWithToast } from "@/app/lib/fetchWithToast";
import type { ZoneCount } from "@/app/lib/search";
import { EVENT_LABEL } from "@/app/lib/types";
import { useCommand } from "@/app/lib/ui/commandStore";
import IncidentCard from "./IncidentCard";

const EXAMPLES = [
  "Show every forklift near miss across the site.",
  "Find people in restricted areas.",
  "Has anyone gone down in the pick zone?",
  "Which zones had repeated incidents?",
  "Show rejected candidates.",
];

const FOLLOW_UPS = ["Only the high-priority ones", "Only those kept by the verifier", "Which zones were they in?"];

const SHOWN = 4;

type Message =
  | { id: number; role: "user"; content: string }
  | { id: number; role: "assistant"; content: string; data?: ChatResponse; error?: boolean };

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-white/10 px-2.5 py-1 text-left text-[11px] text-slate-400 transition-colors hover:border-white/25 hover:text-slate-200"
    >
      {children}
    </button>
  );
}

function AssistantMessage({ msg, zoneName }: { msg: Extract<Message, { role: "assistant" }>; zoneName: (id: string) => string }) {
  const { toggleZone, selectedZoneId } = useCommand();
  const [expanded, setExpanded] = useState(false);
  const d = msg.data;
  const incidents = d ? (expanded ? d.incidents : d.incidents.slice(0, SHOWN)) : [];

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`rounded-xl rounded-tl-sm px-3 py-2 text-[13px] leading-relaxed ${
          msg.error ? "border border-red-500/40 bg-red-500/10 text-red-100" : "bg-white/[0.05] text-slate-200"
        }`}
      >
        {msg.content}
      </div>
      {d && (
        <>
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
            <span>{d.parser === "claude" ? "Claude" : "Keyword rules"}{d.followUp ? " · refined previous" : ""}:</span>
            {d.filters.eventTypes.map((t) => (
              <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">{EVENT_LABEL[t]}</span>
            ))}
            {d.filters.priorities.map((p) => (
              <span key={p} className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">{p} priority</span>
            ))}
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">{d.filters.statuses.join("/")}</span>
            <span>· {d.totalResults} result{d.totalResults === 1 ? "" : "s"}{d.backend ? ` · ${d.backend}` : ""}</span>
          </div>
          {d.zoneIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {d.zoneIds.map((z) => {
                const count = d.zoneCounts?.find((c) => c.zoneId === z);
                return (
                  <button
                    key={z}
                    type="button"
                    onClick={() => toggleZone(z)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      selectedZoneId === z
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-sky-400/40 bg-sky-400/10 text-sky-200 hover:border-sky-300"
                    }`}
                  >
                    ◎ {zoneName(z)}{count ? ` · ${count.total}` : ""}
                  </button>
                );
              })}
            </div>
          )}
          {incidents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {incidents.map((i) => (
                <IncidentCard key={i.id} incident={i} compact />
              ))}
              {d.incidents.length > SHOWN && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="self-start text-[11px] text-slate-500 hover:text-slate-300"
                >
                  {expanded ? "Show fewer" : `Show ${d.incidents.length - SHOWN} more`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ChatPanel({ zones, initialQuery }: { zones: ZoneCount[]; initialQuery: string | null }) {
  const { chatInputRef, setHighlightZoneIds, selectedZoneId } = useCommand();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const zoneName = useCallback((id: string) => zones.find((z) => z.zoneId === id)?.zone ?? id, [zones]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || loading) return;
      const userMsg: Message = { id: nextId.current++, role: "user", content: question };
      const history = [...messages, userMsg];
      setMessages(history);
      setInput("");
      setLoading(true);
      const context = [...messages].reverse().find((m) => m.role === "assistant" && m.data);
      try {
        const res = await fetchWithToast(
          "/api/chat",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: history.map<ChatTurn>((m) => ({ role: m.role, content: m.content })),
              context: context && context.role === "assistant" ? context.data?.filters : null,
            }),
          },
          { errorMessage: "Assistant request failed" },
        );
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as ChatResponse;
        setMessages((m) => [...m, { id: nextId.current++, role: "assistant", content: data.reply, data }]);
        setHighlightZoneIds(data.zoneIds);
      } catch {
        setMessages((m) => [
          ...m,
          { id: nextId.current++, role: "assistant", content: "Something went wrong answering that. Try again.", error: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, setHighlightZoneIds],
  );

  useEffect(() => {
    if (initialQuery && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialQuery);
    }
  }, [initialQuery, send]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const clear = () => {
    setMessages([]);
    setHighlightZoneIds([]);
  };

  const zone = selectedZoneId ? zoneName(selectedZoneId) : null;
  const zoneChips = zone
    ? [`What happened at ${zone}?`, `Any verified incidents in ${zone}?`, `Show rejected candidates in ${zone}`]
    : [];
  const lastIsAnswer = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#07070e]">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Assistant</h2>
          <p className="text-[11px] text-slate-500">Ask about incidents across the site</p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="text-[11px] text-slate-500 hover:text-slate-300">
            Clear
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-slate-400">
              Answers come only from the incident ledger. Matching zones light up on the map, and any incident
              opens in place for review.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {EXAMPLES.map((ex) => (
                <Chip key={ex} onClick={() => void send(ex)}>{ex}</Chip>
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
            <AssistantMessage key={m.id} msg={m} zoneName={zoneName} />
          ),
        )}
        {loading && (
          <div className="flex items-center gap-1.5 self-start rounded-xl bg-white/[0.05] px-3 py-2.5" aria-label="Thinking">
            {[0, 150, 300].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-white/[0.08] p-3">
        {(zoneChips.length > 0 || lastIsAnswer) && !loading && (
          <div className="flex flex-wrap gap-1.5">
            {zoneChips.map((c) => (
              <Chip key={c} onClick={() => void send(c)}>{c}</Chip>
            ))}
            {lastIsAnswer &&
              zoneChips.length === 0 &&
              FOLLOW_UPS.map((c) => (
                <Chip key={c} onClick={() => void send(c)}>{c}</Chip>
              ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <input
            ref={chatInputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder={zone ? `Ask about ${zone}…` : "Ask about incidents…  ( / )"}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0c0c12] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
