"use client";

import { useRef, useState } from "react";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import { formatSpan } from "@/app/lib/format";
import type { ZoneCount } from "@/app/lib/search";
import { EVENT_LABEL, PRIORITY_COLOR } from "@/app/lib/types";
import { useCommand } from "@/app/lib/ui/commandStore";

const W = 1000;
const H = 640;

/** Hand-drawn floor plan on a 1000x640 canvas: docks along the north wall, racking below. */
const ZONE_SHAPES: Record<string, { d: string; label: [number, number] }> = {
  receiving_dock: { d: "M80 56 h480 v96 h-480 z", label: [320, 108] },
  aisle_a: { d: "M420 184 h100 v376 h-100 z", label: [470, 300] },
  pick_zone: { d: "M80 184 h320 v376 h-320 z", label: [215, 300] },
  charging_station: { d: "M640 384 h300 v176 h-300 z", label: [790, 470] },
};

/** Where each zone's camera is mounted and which way it looks (degrees, 0 = right, 90 = down). */
const CAMERA_PINS: Record<string, { x: number; y: number; dir: number }> = {
  receiving_dock: { x: 66, y: 48, dir: 25 },
  aisle_a: { x: 470, y: 172, dir: 90 },
  pick_zone: { x: 66, y: 176, dir: 45 },
  charging_station: { x: 952, y: 372, dir: 140 },
};

/** Rack rows for orientation (not zones). */
const RACKS: [number, number, number, number][] = [
  [110, 200, 50, 340], [200, 200, 50, 340], [290, 200, 50, 340],
  [360, 200, 50, 340], [530, 200, 50, 340],
];

function cone(x: number, y: number, dir: number, len = 70, half = 24): string {
  const rad = (a: number) => (a * Math.PI) / 180;
  const p = (a: number) => `${(x + len * Math.cos(rad(a))).toFixed(1)} ${(y + len * Math.sin(rad(a))).toFixed(1)}`;
  return `M${x} ${y} L${p(dir - half)} A${len} ${len} 0 0 1 ${p(dir + half)} Z`;
}

function shade(total: number, max: number): string {
  if (total === 0) return "rgba(148,163,184,0.08)";
  const a = 0.15 + 0.35 * (total / Math.max(1, max));
  return `rgba(239,68,68,${a.toFixed(2)})`;
}

interface Props {
  zones: ZoneCount[];
  statuses: CameraStatus[];
}

export default function VenueMap({ zones, statuses }: Props) {
  const { selectedZoneId, toggleZone, highlightZoneIds, activeByCamera, openIncident } = useCommand();
  const [hover, setHover] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const max = Math.max(1, ...zones.map((z) => z.total));
  const cameraOf = new Map(statuses.map((s) => [s.camera.zoneId, s]));

  const enter = (zoneId: string) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHover(zoneId);
  };
  const leave = () => {
    leaveTimer.current = setTimeout(() => setHover(null), 150);
  };

  const hovered = hover ? zones.find((z) => z.zoneId === hover) : undefined;
  const hoveredShape = hover ? ZONE_SHAPES[hover] : undefined;
  const hoveredStatus = hover ? cameraOf.get(hover) : undefined;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl border border-white/10 bg-[#0c0c12]" role="group" aria-label="Floor plan">
        {/* building, dock doors, racking, and non-camera areas for orientation */}
        <rect x="40" y="40" width="920" height="560" fill="none" stroke="#334155" strokeWidth="3" />
        {[120, 220, 320, 420, 520, 680, 780, 880].map((x) => (
          <rect key={x} x={x - 30} y="34" width="60" height="12" fill="#1e293b" stroke="#475569" />
        ))}
        <rect x="600" y="56" width="340" height="96" fill="none" stroke="#1e293b" strokeWidth="2" strokeDasharray="6 6" />
        <text x="770" y="110" textAnchor="middle" className="fill-slate-600 text-[20px]">Shipping dock</text>
        <rect x="640" y="184" width="300" height="170" fill="none" stroke="#1e293b" strokeWidth="2" strokeDasharray="6 6" />
        <text x="790" y="275" textAnchor="middle" className="fill-slate-600 text-[20px]">Office / breakroom</text>
        <text x="500" y="628" textAnchor="middle" className="fill-slate-600 text-[20px]">South wall</text>

        {zones.map((z) => {
          const shape = ZONE_SHAPES[z.zoneId];
          if (!shape) return null;
          const selected = selectedZoneId === z.zoneId;
          const highlighted = highlightZoneIds.includes(z.zoneId);
          return (
            <g
              key={z.zoneId}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${z.zone}: ${z.total} incidents, ${z.kept} kept`}
              onClick={() => toggleZone(z.zoneId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleZone(z.zoneId);
                }
              }}
              onMouseEnter={() => enter(z.zoneId)}
              onMouseLeave={leave}
              onFocus={() => enter(z.zoneId)}
              onBlur={leave}
            >
              <path
                d={shape.d}
                fill={shade(z.total, max)}
                fillRule="evenodd"
                stroke={selected ? "#f8fafc" : highlighted ? "#38bdf8" : z.total ? "#f87171" : "#475569"}
                strokeWidth={selected || highlighted ? 5 : 2}
                className={`transition-opacity hover:opacity-80 ${highlighted && !selected ? "zone-glow" : ""}`}
              />
            </g>
          );
        })}

        {/* racking, the lane line, and zone labels sit above zone shading so the layout stays readable */}
        <g className="pointer-events-none">
          {RACKS.map(([x, y, w, h]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill="#1e293b" fillOpacity="0.7" stroke="#475569" />
          ))}
          <line x1="470" y1="200" x2="470" y2="550" stroke="#ca8a04" strokeOpacity="0.6" strokeWidth="3" strokeDasharray="14 10" />
          {zones.map((z) => {
            const shape = ZONE_SHAPES[z.zoneId];
            if (!shape) return null;
            return (
              <g key={z.zoneId}>
                <text
                  x={shape.label[0]}
                  y={shape.label[1] - 6}
                  textAnchor="middle"
                  stroke="#09090f"
                  strokeWidth="5"
                  paintOrder="stroke"
                  className="pointer-events-none fill-white text-[24px] font-semibold"
                >
                  {z.zone}
                </text>
                <text
                  x={shape.label[0]}
                  y={shape.label[1] + 20}
                  textAnchor="middle"
                  stroke="#09090f"
                  strokeWidth="4"
                  paintOrder="stroke"
                  className="pointer-events-none fill-slate-300 text-[19px]"
                >
                  {z.total} · {z.kept} kept
                </text>
              </g>
            );
          })}
        </g>
        {statuses.map((s) => {
          const pin = CAMERA_PINS[s.camera.zoneId];
          if (!pin) return null;
          const top = activeByCamera[s.camera.id]?.[0];
          const color = top ? PRIORITY_COLOR[top.priority] : "#94a3b8";
          const selected = selectedZoneId === s.camera.zoneId;
          return (
            <g
              key={s.camera.id}
              className="cursor-pointer"
              onClick={() => (top ? openIncident(top.id) : toggleZone(s.camera.zoneId))}
              onMouseEnter={() => enter(s.camera.zoneId)}
              onMouseLeave={leave}
            >
              <title>{top ? `${s.camera.id}: ${EVENT_LABEL[top.eventType]} (click to review)` : s.camera.id}</title>
              <path d={cone(pin.x, pin.y, pin.dir)} fill={color} fillOpacity={top ? 0.35 : selected ? 0.25 : 0.12} />
              {top && <circle cx={pin.x} cy={pin.y} r="11" fill={color} className="pin-ping" />}
              <circle cx={pin.x} cy={pin.y} r="11" fill="#0c0c12" stroke={color} strokeWidth="3" />
              <circle cx={pin.x} cy={pin.y} r="4" fill={color} />
            </g>
          );
        })}
      </svg>

      {hovered && hoveredShape && (
        <div
          className="absolute z-10 w-56 -translate-x-1/2 rounded-lg border border-white/15 bg-[#11111a]/95 p-2.5 text-[11px] shadow-xl backdrop-blur"
          style={{
            left: `${Math.min(72, Math.max(28, (hoveredShape.label[0] / W) * 100))}%`,
            top: `${((hoveredShape.label[1] + 34) / H) * 100}%`,
          }}
          onMouseEnter={() => enter(hovered.zoneId)}
          onMouseLeave={leave}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white">{hovered.zone}</span>
            <span className="font-mono text-slate-500">{hoveredStatus?.camera.id}</span>
          </div>
          <div className="mt-0.5 text-slate-400">
            {hovered.total} incident{hovered.total === 1 ? "" : "s"} · {hovered.kept} kept
          </div>
          {hovered.eventTypes.length > 0 && (
            <div className="mt-1 text-slate-500">{hovered.eventTypes.map((t) => EVENT_LABEL[t]).join(", ")}</div>
          )}
          {hoveredStatus?.latest ? (
            <button
              type="button"
              onClick={() => openIncident(hoveredStatus.latest!.id)}
              className="mt-2 w-full rounded-md border border-white/10 px-2 py-1 text-left text-slate-200 hover:border-white/30"
            >
              Latest: {EVENT_LABEL[hoveredStatus.latest.eventType]}{" "}
              <span className="font-mono text-slate-500">{formatSpan(hoveredStatus.latest.startSec, hoveredStatus.latest.endSec)}</span>
            </button>
          ) : (
            <div className="mt-2 text-slate-600">No incident to review.</div>
          )}
        </div>
      )}
    </div>
  );
}
