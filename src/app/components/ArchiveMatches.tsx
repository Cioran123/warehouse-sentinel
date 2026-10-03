"use client";

import { useEffect, useState } from "react";
import { formatSpan } from "@/app/lib/format";
import type { ArchiveResult } from "@/app/lib/vss";

/**
 * Similar moments from the VAST VSS archive: the incident's description goes to VSS hybrid
 * search (Cosmos captions + Cosmos-Embed1 vectors in VAST DataBase), and hits play back from
 * the VAST segments bucket through /api/vss/stream.
 */
export default function ArchiveMatches({ query }: { query: string }) {
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/vss/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: ctl.signal,
    })
      .then((r) => r.json() as Promise<ArchiveResult>)
      .then(setResult)
      .catch(() => {});
    return () => ctl.abort();
  }, [query]);

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink">Similar moments in the VAST archive</h2>
        <span className="text-[11px] text-ink-3">VAST VSS search</span>
      </div>
      {!result ? (
        <p className="text-[12px] text-ink-3">Searching the archive…</p>
      ) : !result.configured ? (
        <p className="text-[12px] leading-relaxed text-ink-3">
          Not connected to the VAST video archive. On the Builders Challenge VM this searches the
          team&rsquo;s pre-ingested footage (set INGRESS_URL, VSS_USERNAME, VSS_PASSWORD elsewhere).
        </p>
      ) : result.error ? (
        <p className="text-[12px] text-ink-3">VAST archive unavailable: {result.error}</p>
      ) : result.hits.length === 0 ? (
        <p className="text-[12px] text-ink-3">No similar moments above the similarity threshold.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {result.summary && <p className="text-[12px] leading-relaxed text-ink-2">{result.summary}</p>}
          <ul className="flex flex-col gap-2">
            {result.hits.map((h) => (
              <li key={h.source} className="rounded-lg bg-sunken p-2.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
                  <span className="truncate font-mono">
                    {[h.cameraId, h.location].filter(Boolean).join(" · ") || h.source.split("/").pop()}
                    {h.startSec !== undefined && h.endSec !== undefined ? ` · ${formatSpan(h.startSec, h.endSec)}` : ""}
                  </span>
                  <span className="flex-shrink-0 tabular-nums">{Math.round(h.similarity * 100)}% match</span>
                </div>
                {h.caption && <p className="mt-1 line-clamp-3 text-[12px] text-ink-2">{h.caption}</p>}
                {playing === h.source ? (
                  <video
                    src={`/api/vss/stream?source=${encodeURIComponent(h.source)}`}
                    controls
                    autoPlay
                    muted
                    className="mt-2 w-full rounded-md"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlaying(h.source)}
                    className="mt-1.5 text-[12px] font-medium text-accent hover:text-accent-hover"
                  >
                    Play segment
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
