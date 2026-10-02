"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { formatSpan, formatTime } from "@/app/lib/format";
import {
  EVENT_LABEL,
  STATUS_COLOR,
  type Camera,
  type Incident,
  type TrackFrame,
} from "@/app/lib/types";
import { PriorityBadge, SourceBadge, VerificationBadge } from "./Badges";
import ClipChat from "./ClipChat";
import EventTimeline, { type TimelineBand } from "./EventTimeline";
import TrackOverlay, { nearestFrame } from "./TrackOverlay";
import VideoPlayer, { type VideoPlayerHandle } from "./VideoPlayer";

interface Props {
  incident: Incident;
  camera: Camera;
  venueName: string;
  cameraIncidents: Incident[];
  tracks: TrackFrame[];
  syntheticTracks: boolean;
  /** Live webcam incident: there is no recording, so the player shows the evidence clip, whose
   * t=0 is the incident's startSec (seconds into the webcam session). */
  live?: boolean;
  /** "drawer" stacks everything in one column for the command-center side sheet. */
  variant?: "page" | "drawer";
  /** Called when another incident is picked on the timeline; defaults to navigating to its page. */
  onSelectIncident?: (id: string) => void;
}

type SideTab = "evidence" | "ask";

function Evidence({ incident, camera, venueName, live }: Pick<Props, "incident" | "camera" | "venueName"> & { live: boolean }) {
  const hasVerifierEvidence =
    incident.observations.length > 0 &&
    incident.observations.join("\n") !== (incident.signalNotes ?? []).join("\n");

  return (
    <>
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Verifier result</h2>
        <div className="mb-2 flex items-center gap-2">
          <VerificationBadge status={incident.verificationStatus} />
        </div>
        <p className="text-[13px] leading-relaxed text-ink">{incident.cosmosExplanation ?? "No explanation recorded."}</p>
        <p className="mt-2 text-[11px] text-ink-3">
          {incident.verifier ?? "unverified"} · prompt {incident.promptVersion ?? "—"}
        </p>
        <h3 className="mb-1 mt-4 text-[12px] font-medium text-ink-3">Observable evidence</h3>
        {hasVerifierEvidence ? (
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-2">
            {incident.observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-3">No verifier evidence yet; see the candidate signals below.</p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Candidate signals (YOLO)</h2>
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-2">
          {(incident.signalNotes ?? []).map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        {incident.signals && Object.keys(incident.signals).length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
            {Object.entries(incident.signals).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {incident.evidenceClipUrl && !live && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-[13px] font-semibold text-ink">Clip sent to verifier</h2>
          <video src={incident.evidenceClipUrl} controls muted preload="metadata" className="w-full rounded-lg" />
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Source</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-3">Site</dt><dd className="text-ink-2">{venueName}</dd>
          <dt className="text-ink-3">Camera</dt><dd className="text-ink-2">{camera.id} · {camera.zone}</dd>
          <dt className="text-ink-3">File</dt><dd className="font-mono text-ink-2">{incident.videoId}</dd>
          <dt className="text-ink-3">Span</dt><dd className="font-mono text-ink-2">{formatSpan(incident.startSec, incident.endSec)}</dd>
          <dt className="text-ink-3">Source</dt><dd className="text-ink-2">{incident.sourceType}</dd>
          <dt className="text-ink-3">Scenario</dt><dd className="text-ink-2">{camera.scenario}</dd>
          <dt className="text-ink-3">Tracks</dt><dd className="font-mono text-ink-2">{incident.trackIds?.length ? incident.trackIds.map((t) => `#${t}`).join(", ") : "—"}</dd>
        </dl>
      </section>
    </>
  );
}

export default function IncidentViewer({
  incident,
  camera,
  venueName,
  cameraIncidents,
  tracks,
  syntheticTracks,
  live = false,
  variant = "page",
  onSelectIncident,
}: Props) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const offset = live ? incident.startSec : 0;
  const initialTime = live ? 0 : Math.max(0, incident.startSec - 5);
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(live ? incident.endSec - incident.startSec : camera.durationSec);
  const [showOverlay, setShowOverlay] = useState(true);
  const [tab, setTab] = useState<SideTab>("evidence");
  const highlight = useMemo(() => new Set(incident.trackIds ?? []), [incident.trackIds]);
  const frame = nearestFrame(tracks, time);
  const selectIncident = onSelectIncident ?? ((id: string) => (window.location.href = `/incident/${id}`));
  /** Seek to a source-video timestamp (live clips start at the incident's startSec). */
  const seekSource = (t: number) => playerRef.current?.seekTo(Math.max(0, t - offset));

  const bands: TimelineBand[] = [
    ...(camera.groundTruth
      ? [{
          id: "gt",
          startSec: camera.groundTruth.startSec,
          endSec: camera.groundTruth.endSec,
          color: "#42485a",
          label: `Ground truth: ${EVENT_LABEL[camera.groundTruth.eventType]}`,
          row: 0 as const,
          outlined: true,
        }]
      : []),
    ...cameraIncidents.map((i) => ({
      id: i.id,
      startSec: i.startSec - offset,
      endSec: i.endSec - offset,
      color: STATUS_COLOR[i.verificationStatus],
      label: `${EVENT_LABEL[i.eventType]} (${i.verificationStatus})`,
      row: 1 as const,
      active: i.id === incident.id,
    })),
  ];

  const jumps: [string, number][] = live
    ? [["Start", 0], ["End", incident.endSec - incident.startSec]]
    : [
        ["−10s context", incident.startSec - 10],
        ["Start", incident.startSec],
        ["End", incident.endSec],
        ["+10s after", incident.endSec + 10],
      ];

  const main = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {variant === "page" && (
          <Link href={`/overview?incident=${incident.id}`} className="self-start text-[12px] text-ink-3 transition-colors hover:text-ink">← Back to Live</Link>
        )}
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{EVENT_LABEL[incident.eventType]}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <PriorityBadge priority={incident.priority} />
          <VerificationBadge status={incident.verificationStatus} />
          <span className="text-[12px] text-ink-2">
            {camera.zone} <span className="font-mono text-ink-3">{camera.id} · {formatSpan(incident.startSec, incident.endSec)}</span>
          </span>
          <SourceBadge sourceType={incident.sourceType} />
        </div>
      </div>

      {incident.requiresHumanReview && (
        <div className="rounded-lg border border-medium-line bg-medium-soft px-4 py-2.5 text-[13px] leading-relaxed text-medium">
          Human review recommended. This is an observable-signal match, not a determination of blame,
          identity, or medical condition.
        </div>
      )}

      <VideoPlayer
        ref={playerRef}
        src={live ? incident.evidenceClipUrl ?? "" : `/api/cameras/${camera.id}/video`}
        initialTime={initialTime}
        onTimeChange={setTime}
        onDurationChange={setDuration}
        overlay={showOverlay ? <TrackOverlay camera={camera} frame={frame} highlight={highlight} /> : null}
      />

      <div className="flex flex-wrap items-center gap-2">
        {jumps.map(([label, t]) => (
          <button
            key={label}
            type="button"
            onClick={() => playerRef.current?.seekTo(Math.max(0, t))}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            {label} <span className="font-mono text-ink-3">{formatTime(Math.max(0, t))}</span>
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
          {live
            ? "Restricted polygon (live clip, no saved tracks)"
            : `YOLO tracks + pose + flow${camera.restrictedPolygons?.length ? " + restricted polygon" : ""}`}
          {syntheticTracks ? " (synthetic seed tracks)" : ""}
        </label>
      </div>

      <EventTimeline
        bands={bands}
        currentTime={time}
        duration={duration}
        onSeek={(s) => playerRef.current?.seekTo(s)}
        onSelect={(id) => {
          if (id !== "gt" && id !== incident.id) selectIncident(id);
        }}
      />
    </div>
  );

  const side = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex gap-1 rounded-lg bg-sunken p-1" role="tablist">
        {([
          ["evidence", "Evidence"],
          ["ask", "Ask about this clip"],
        ] as [SideTab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              tab === id ? "bg-surface text-ink shadow-sm shadow-ink/5" : "text-ink-3 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={tab === "evidence" ? "flex flex-col gap-4" : "hidden"}>
        <Evidence incident={incident} camera={camera} venueName={venueName} live={live} />
      </div>
      <div className={tab === "ask" ? "flex flex-col" : "hidden"}>
        <ClipChat incident={incident} onSeek={seekSource} />
      </div>
    </div>
  );

  if (variant === "drawer") {
    return (
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        {main}
        {side}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {main}
      <aside>{side}</aside>
    </div>
  );
}
