"use client";

import { useState } from "react";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import { useCommand } from "@/app/lib/ui/commandStore";
import CameraTile from "./CameraTile";
import WebcamTile from "./WebcamTile";

export default function CameraWall({ statuses }: { statuses: CameraStatus[] }) {
  const { selectedZoneId, toggleZone, selectZone, activeByCamera, reportTime } = useCommand();
  const [showOverlay, setShowOverlay] = useState(true);
  const [focusOnly, setFocusOnly] = useState(false);
  const selected = statuses.find((s) => s.camera.zoneId === selectedZoneId);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cameras</h2>
        {selected ? (
          <span className="flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/10 px-2.5 py-0.5 text-[11px] text-sky-200">
            Focused on {selected.camera.zone}
            <button type="button" onClick={() => selectZone(null)} className="text-sky-300 hover:text-white" aria-label="Clear zone focus">
              ✕
            </button>
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">Click a tile or a map zone to focus it</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-400">
          {selected && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={focusOnly} onChange={(e) => setFocusOnly(e.target.checked)} />
              This zone only
            </label>
          )}
          <label className="flex items-center gap-1.5" title="Blue boxes = people · amber boxes = vehicles · pink arrow = optical-flow motion">
            <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
            Tracking overlay
          </label>
        </div>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {statuses.map((s) => {
          const isSelected = s.camera.zoneId === selectedZoneId;
          const dimmed = !!selected && !isSelected;
          return (
            // Videos stay mounted while hidden or reordered so their playback keeps feeding alerts.
            <div
              key={s.camera.id}
              className={`transition-opacity ${dimmed ? (focusOnly ? "hidden" : "opacity-40 hover:opacity-100") : ""}`}
              style={{ order: isSelected ? 0 : 2 }}
            >
              <CameraTile
                status={s}
                showOverlay={showOverlay}
                active={activeByCamera[s.camera.id] ?? []}
                onTime={reportTime}
                selected={isSelected}
                onSelectZone={() => toggleZone(s.camera.zoneId)}
              />
            </div>
          );
        })}
        <div className={selected && focusOnly ? "hidden" : selected ? "opacity-40 hover:opacity-100" : ""} style={{ order: 1 }}>
          <WebcamTile showOverlay={showOverlay} />
        </div>
      </div>
    </div>
  );
}
