import { formatSpan } from "@/app/lib/format";
import { EVENT_LABEL, PRIORITY_COLOR, type Incident } from "@/app/lib/types";
import { PriorityBadge, VerificationBadge } from "./Badges";
import IncidentClip from "./IncidentClip";
import IncidentLink from "./IncidentLink";

export default function IncidentCard({
  incident,
  compact = false,
  clip = false,
}: {
  incident: Incident;
  compact?: boolean;
  /** Play the evidence clip in the card itself, for answers that should carry their own footage. */
  clip?: boolean;
}) {
  const rejected = incident.verificationStatus === "rejected";

  if (compact) {
    const summary = (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[incident.priority] }} />
            <span className="truncate text-[13px] font-medium text-ink">{EVENT_LABEL[incident.eventType]}</span>
          </span>
          <span className="flex-shrink-0 font-mono text-[11px] text-ink-3">{formatSpan(incident.startSec, incident.endSec)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate pl-4 text-[12px] text-ink-2">
            {incident.zone} <span className="font-mono text-ink-3">{incident.cameraId}</span>
          </span>
          <VerificationBadge status={incident.verificationStatus} />
        </div>
      </>
    );

    // The player carries its own controls, so it sits beside the link rather than inside it.
    if (clip && incident.evidenceClipUrl) {
      return (
        <div className={`overflow-hidden rounded-lg border border-line bg-surface ${rejected ? "opacity-70" : ""}`}>
          <IncidentClip src={incident.evidenceClipUrl} startSec={incident.startSec} endSec={incident.endSec} />
          <IncidentLink
            id={incident.id}
            className="block w-full px-3 py-2 transition-colors hover:bg-sunken"
            title="Open the full recording for review"
          >
            {summary}
          </IncidentLink>
        </div>
      );
    }

    return (
      <IncidentLink
        id={incident.id}
        className={`block w-full rounded-lg border border-line bg-surface px-3 py-2 transition-colors hover:border-line-strong hover:bg-sunken ${rejected ? "opacity-70" : ""}`}
        title="Open incident"
      >
        {summary}
      </IncidentLink>
    );
  }

  return (
    <div
      className={`rounded-xl border border-line bg-surface px-4 py-3 ${rejected ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-medium text-ink">{EVENT_LABEL[incident.eventType]}</span>
        <PriorityBadge priority={incident.priority} />
        <VerificationBadge status={incident.verificationStatus} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[12px] text-ink-3">
        <span>{incident.cameraId}</span>
        <span>{incident.zone}</span>
        <span>{formatSpan(incident.startSec, incident.endSec)}</span>
      </div>
      {incident.observations.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
          {incident.observations.slice(0, 3).map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-3">
          {incident.requiresHumanReview ? "Human review recommended" : "No review flag"}
          {incident.verifier ? ` · ${incident.verifier}` : ""}
        </span>
        <IncidentLink
          id={incident.id}
          className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-surface transition-colors hover:bg-ink-2"
        >
          Review
        </IncidentLink>
      </div>
    </div>
  );
}
