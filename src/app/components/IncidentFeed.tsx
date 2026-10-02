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
  return <span className="tabular-nums text-ink-3">{mins < 1 ? "just now" : `${mins}m ago`}</span>;
}

function FeedCard({ item }: { item: FeedItem }) {
  const { openIncident, dismissFeed, openIncidentId } = useCommand();
  const i = item.incident;
  const open = openIncidentId === i.id;
  return (
    <div
      className={`feed-pop group flex w-72 flex-shrink-0 flex-col gap-2 rounded-xl border bg-surface p-3 transition-colors ${
        open ? "border-accent" : "border-line hover:border-line-strong"
      }`}
    >
      <button type="button" onClick={() => openIncident(i.id)} className="flex flex-col gap-1 text-left">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[i.priority] }} />
          <span className="truncate text-[13px] font-medium text-ink">{EVENT_LABEL[i.eventType]}</span>
        </span>
        <span className="flex items-center justify-between gap-2 pl-4 text-[12px]">
          <span className="truncate text-ink-2">
            {i.zone} <span className="font-mono text-ink-3">{formatSpan(i.startSec, i.endSec)}</span>
          </span>
          <Since at={item.seenAt} />
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 pl-4">
        <VerificationBadge status={i.verificationStatus} />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => dismissFeed(i.id)}
            title="Mark reviewed"
            className="rounded-md px-2 py-1 text-[12px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => openIncident(i.id)}
            className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-surface transition-colors hover:bg-ink-2"
          >
            Review
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
    <section className="flex min-w-0 flex-col gap-3 border-t border-line bg-sunken px-6 py-4" aria-label="Incident feed">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Alerts</h2>
        <span className="text-[12px] text-ink-3">
          {feed.length === 0 ? "Nothing waiting" : `${feed.length} waiting for review`}
          {high > 0 && <span className="font-medium text-high"> · {high} high priority</span>}
        </span>
        <button type="button" onClick={resetFeed} className="ml-auto text-[12px] text-ink-3 transition-colors hover:text-ink">
          Replay
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-3">
          Incidents appear here as each camera&apos;s playback reaches them.
        </p>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {items.map((item) => (
            <FeedCard key={item.incident.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
