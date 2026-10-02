"use client";

import type { CameraStatus } from "@/app/lib/cameraStatus";
import type { ZoneCount } from "@/app/lib/search";
import { EVENT_LABEL, PRIORITY_COLOR } from "@/app/lib/types";
import { useCommand } from "@/app/lib/ui/commandStore";
import VenueMap from "./VenueMap";

interface Props {
  venueName: string;
  zones: ZoneCount[];
  statuses: CameraStatus[];
  rejectedCount: number;
}

export default function VenuePanel({ venueName, zones, statuses, rejectedCount }: Props) {
  const { selectedZoneId, toggleZone, highlightZoneIds, activeByCamera } = useCommand();
  const cameraOf = new Map(statuses.map((s, i) => [s.camera.zoneId, { status: s, key: i + 1 }]));

  return (
    <>
      <div>
        <h1 className="text-sm font-semibold text-white">{venueName}</h1>
        <p className="text-[11px] text-slate-500">
          Kept and unverified incidents by zone · {rejectedCount} rejected hidden
        </p>
      </div>

      <VenueMap zones={zones} statuses={statuses} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.25), rgba(239,68,68,0.85))" }} />
          Shading = incident count
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full border-2" style={{ borderColor: PRIORITY_COLOR.high }} />
          Pulsing pin = incident on screen now
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm border-2 border-sky-400" />
          Mentioned in chat
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {zones.map((z) => {
          const cam = cameraOf.get(z.zoneId);
          const top = cam ? activeByCamera[cam.status.camera.id]?.[0] : undefined;
          const selected = selectedZoneId === z.zoneId;
          const highlighted = highlightZoneIds.includes(z.zoneId);
          return (
            <li key={z.zoneId}>
              <button
                type="button"
                onClick={() => toggleZone(z.zoneId)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected
                    ? "border-white/40 bg-white/[0.06]"
                    : highlighted
                      ? "border-sky-400/50 bg-sky-400/[0.06]"
                      : "border-white/10 bg-[#0c0c12] hover:border-white/25"
                }`}
              >
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${top ? "animate-pulse" : ""}`}
                  style={{ background: top ? PRIORITY_COLOR[top.priority] : z.total ? "#f87171" : "#334155" }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-white">{z.zone}</span>
                    <span className="flex-shrink-0 font-mono text-[10px] text-slate-500">
                      {cam?.status.camera.id}
                      {cam && <kbd className="ml-1.5 rounded border border-white/10 px-1 text-slate-500">{cam.key}</kbd>}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {z.total} incident{z.total === 1 ? "" : "s"} · {z.kept} kept
                    {z.eventTypes.length > 0 ? ` · ${z.eventTypes.map((t) => EVENT_LABEL[t]).join(", ")}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
