"use client";

import { useState } from "react";
import { formatSpan } from "@/app/lib/format";

/**
 * The evidence clip the verifier was given, trimmed to the incident window: t=0 here is the
 * incident's startSec in the source recording.
 */
export default function IncidentClip({
  src,
  startSec,
  endSec,
}: {
  src: string;
  startSec: number;
  endSec: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="border-b border-line bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink-3">
        Clip for {formatSpan(startSec, endSec)} is not on disk. Run the pipeline to cut evidence clips, or
        open the incident to play the full recording.
      </div>
    );
  }

  return (
    <div className="relative">
      <video
        src={src}
        controls
        muted
        loop
        playsInline
        preload="metadata"
        className="aspect-video w-full bg-footage"
        onError={() => setFailed(true)}
      />
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-footage/80 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
        {formatSpan(startSec, endSec)}
      </span>
    </div>
  );
}
