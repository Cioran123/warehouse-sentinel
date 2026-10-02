import { formatSpan } from "@/app/lib/format";
import { EVENT_LABEL, PRIORITY_COLOR, type Incident } from "@/app/lib/types";
import { PriorityBadge, VerificationBadge } from "./Badges";
import IncidentLink from "./IncidentLink";

export default function IncidentCard({ incident, compact = false }: { incident: Incident; compact?: boolean }) {
  const rejected = incident.verificationStatus === "rejected";

  if (compact) {
    return (
      <IncidentLink
        id={incident.id}
        className={`block w-full rounded-r-lg border border-white/10 bg-[#0c0c12] px-3 py-2 transition-colors hover:border-white/25 ${rejected ? "opacity-60" : ""}`}
        style={{ borderLeft: `3px solid ${PRIORITY_COLOR[incident.priority]}` }}
        title="Open incident"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] font-semibold text-white">{EVENT_LABEL[incident.eventType]}</span>
          <span className="flex-shrink-0 font-mono text-[10px] text-slate-500">{formatSpan(incident.startSec, incident.endSec)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px] text-slate-400">
            {incident.cameraId} · {incident.zone}
          </span>
          <VerificationBadge status={incident.verificationStatus} />
        </div>
      </IncidentLink>
    );
  }

  return (
    <div
      className={`rounded-r-xl border border-white/10 bg-[#0c0c12] px-4 py-3 ${rejected ? "opacity-60" : ""}`}
      style={{ borderLeft: `3px solid ${PRIORITY_COLOR[incident.priority]}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{EVENT_LABEL[incident.eventType]}</span>
        <PriorityBadge priority={incident.priority} />
        <VerificationBadge status={incident.verificationStatus} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs text-slate-400">
        <span>{incident.cameraId}</span>
        <span>{incident.zone}</span>
        <span>{formatSpan(incident.startSec, incident.endSec)}</span>
      </div>
      {incident.observations.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[13px] text-slate-300">
          {incident.observations.slice(0, 3).map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-500">
          {incident.requiresHumanReview ? "Human review recommended" : "No review flag"}
          {incident.verifier ? ` · ${incident.verifier}` : ""}
        </span>
        <IncidentLink
          id={incident.id}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          Review
        </IncidentLink>
      </div>
    </div>
  );
}
