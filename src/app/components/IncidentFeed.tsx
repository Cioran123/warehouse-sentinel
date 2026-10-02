"use client";

import { useEffect, useState } from "react";
import { formatSpan } from "@/app/lib/format";
import { EVENT_LABEL, PRIORITY_COLOR } from "@/app/lib/types";
import { useCommand, type FeedItem } from "@/app/lib/ui/commandStore";
import { VerificationBadge } from "./Badges";

function Since({ at }: { at: number }) {
  const [now, setNow] = useState(at);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  return <span className="font-mono text-[10px] text-slate-500">waiting {mins}m</span>;
}

function FeedCard({ item }: { item: FeedItem }) {
  const { openIncident, dismissFeed, openIncidentId } = useCommand();
  const i = item.incident;
  const color = PRIORITY_COLOR[i.priority];
  const open = openIncidentId === i.id;
  return (
    <div
      className={`feed-pop flex w-64 flex-shrink-0 flex-col gap-1.5 rounded-xl p-2.5 ${open ? "ring-2 ring-sky-400/50" : ""}`}
      style={{ background: `${color}0d`, border: `1px solid ${color}55`, borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-semibold text-white">{EVENT_LABEL[i.eventType]}</span>
        <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">{i.cameraId}</span>
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400">
        <span className="truncate">{i.zone} · {formatSpan(i.startSec, i.endSec)}</span>
        <Since at={item.seenAt} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <VerificationBadge status={i.verificationStatus} />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => openIncident(i.id)}
            className="rounded-md border border-slate-600 px-2 py-1 text-[10px] text-slate-200 transition-colors hover:border-slate-400 hover:text-white"
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => dismissFeed(i.id)}
            title="Mark reviewed"
            className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export default function IncidentFeed() {
  const { feed, resetFeed } = useCommand();
  const items = [...feed].sort(
    (a, b) => PRIORITY_RANK[a.incident.priority] - PRIORITY_RANK[b.incident.priority] || b.seenAt - a.seenAt,
  );
  const high = feed.filter((f) => f.incident.priority === "high").length;

  return (
    <section className="flex min-w-0 flex-col gap-2 border-t border-white/[0.08] bg-[#07070e] px-4 py-3" aria-label="Incident feed">
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Alerts</h2>
        <span className="text-[11px] text-slate-500">{feed.length} waiting for review</span>
        {high > 0 && (
          <span className="banner-pulse rounded-full border border-red-900 bg-[#3d0c0c] px-2.5 py-0.5 text-[11px] text-[#fca5a5]">
            ⚠ {high} high priority
          </span>
        )}
        <button type="button" onClick={resetFeed} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300">
          Replay
        </button>
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-[12px] text-slate-600">
          No alerts yet. Candidates appear here as each camera&apos;s playback reaches them.
        </p>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {items.map((item) => (
            <FeedCard key={item.incident.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
