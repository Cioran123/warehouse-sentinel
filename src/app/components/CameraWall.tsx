"use client";

import Link from "next/link";
import { useState } from "react";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import { useCommand } from "@/app/lib/ui/commandStore";
import CameraTile from "./CameraTile";
import WebcamTile from "./WebcamTile";

export default function CameraWall({ statuses }: { statuses: CameraStatus[] }) {
  const { selectedZoneId, toggleZone, selectZone, highlightZoneIds, activeByCamera, reportTime } = useCommand();
  const [showOverlay, setShowOverlay] = useState(true);
  const [focusOnly, setFocusOnly] = useState(false);
  const selected = statuses.find((s) => s.camera.zoneId === selectedZoneId);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Cameras</h2>
        {selected ? (
          <span className="flex items-center gap-1.5 rounded-md bg-accent-soft py-0.5 pl-2 pr-1 text-[12px] text-accent">
            {selected.camera.zone}
            <button
              type="button"
              onClick={() => selectZone(null)}
              className="flex h-5 w-5 items-center justify-center rounded text-accent transition-colors hover:bg-accent/10"
              aria-label="Clear zone focus"
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">Click a feed to focus its zone. Keys 1 to {statuses.length} work too.</span>
        )}
        <div className="ml-auto flex items-center gap-4 text-[12px] text-ink-2">
          {selected && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={focusOnly} onChange={(e) => setFocusOnly(e.target.checked)} />
              Only this zone
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-1.5" title="Blue boxes are people, orange boxes are vehicles, the pink arrow is overall motion">
            <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
            Detections
          </label>
          <Link
            href={selected ? `/site-map?zone=${encodeURIComponent(selected.camera.zoneId)}` : "/site-map"}
            className="font-medium text-ink-2 transition-colors hover:text-ink"
          >
            Site map →
          </Link>
        </div>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {statuses.map((s) => {
          const isSelected = s.camera.zoneId === selectedZoneId;
          const dimmed = !!selected && !isSelected;
          return (
            // Videos stay mounted while hidden or reordered so their playback keeps feeding alerts.
            <div
              key={s.camera.id}
              className={`transition-opacity duration-200 ${dimmed ? (focusOnly ? "hidden" : "opacity-50 hover:opacity-100") : ""}`}
              style={{ order: isSelected ? 0 : 2 }}
            >
              <CameraTile
                status={s}
                showOverlay={showOverlay}
                active={activeByCamera[s.camera.id] ?? []}
                onTime={reportTime}
                selected={isSelected}
                highlighted={highlightZoneIds.includes(s.camera.zoneId)}
                onSelectZone={() => toggleZone(s.camera.zoneId)}
              />
            </div>
          );
        })}
        <div className={selected && focusOnly ? "hidden" : selected ? "opacity-50 transition-opacity hover:opacity-100" : ""} style={{ order: 3 }}>
          <WebcamTile showOverlay={showOverlay} />
        </div>
      </div>
    </div>
  );
}
