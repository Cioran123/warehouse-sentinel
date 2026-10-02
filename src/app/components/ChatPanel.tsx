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
  "Is anyone missing a hard hat?",
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
      className="rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
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
        className={`text-[13px] leading-relaxed ${
          msg.error ? "rounded-lg border border-high-line bg-high-soft px-3 py-2 text-high" : "text-ink"
        }`}
      >
        {msg.content}
      </div>
      {d && (
        <>
          <p className="text-[12px] leading-relaxed text-ink-3">
            {d.totalResults} result{d.totalResults === 1 ? "" : "s"} for{" "}
            {[
              d.filters.eventTypes.length ? d.filters.eventTypes.map((t) => EVENT_LABEL[t]).join(" or ") : "any event",
              ...d.filters.priorities.map((p) => `${p} priority`),
              d.filters.statuses.join(" or "),
            ].join(", ")}
            {d.followUp ? ", refining the last answer" : ""}. Parsed by {d.parser === "claude" ? "Claude" : "keyword rules"}
            {d.backend ? `, ${d.backend} index` : ""}.
          </p>
          {d.zoneIds.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {d.zoneIds.map((z) => {
                const count = d.zoneCounts?.find((c) => c.zoneId === z);
                return (
                  <button
                    key={z}
                    type="button"
                    onClick={() => toggleZone(z)}
                    className={`text-[12px] font-medium underline-offset-2 transition-colors hover:underline ${
                      selectedZoneId === z ? "text-ink underline" : "text-accent"
                    }`}
                  >
                    {zoneName(z)}{count ? ` (${count.total})` : ""}
                  </button>
                );
              })}
            </div>
          )}
          {incidents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {incidents.map((i) => (
                <IncidentCard key={i.id} incident={i} compact clip />
              ))}
              {d.incidents.length > SHOWN && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="self-start text-[12px] text-ink-3 transition-colors hover:text-ink"
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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface">
      <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Assistant</h2>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="text-[12px] text-ink-3 transition-colors hover:text-ink">
            Clear
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-ink-2">
              Answers come only from the incident ledger. Each match plays its evidence clip here, cameras in
              matching zones are outlined, and any incident opens in place for the full recording.
            </p>
            <div className="-mx-2 flex flex-col items-start">
              <span className="px-2 pb-1 text-[12px] text-ink-3">Try</span>
              {EXAMPLES.map((ex) => (
                <Chip key={ex} onClick={() => void send(ex)}>{ex}</Chip>
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
            <AssistantMessage key={m.id} msg={m} zoneName={zoneName} />
          ),
        )}
        {loading && (
          <div className="flex items-center gap-1.5 self-start py-1" aria-label="Thinking">
            {[0, 150, 300].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line p-4">
        {(zoneChips.length > 0 || lastIsAnswer) && !loading && (
          <div className="-mx-2 flex flex-wrap">
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
          className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface p-1 pl-3 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]"
        >
          <input
            ref={chatInputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder={zone ? `Ask about ${zone}…` : "Ask about incidents…"}
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
      </div>
    </div>
  );
}
