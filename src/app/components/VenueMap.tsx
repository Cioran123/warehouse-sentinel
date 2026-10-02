"use client";

import { useRef, useState } from "react";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import { formatSpan } from "@/app/lib/format";
import type { ZoneCount } from "@/app/lib/search";
import { EVENT_LABEL, PRIORITY_COLOR } from "@/app/lib/types";
import {
  BUILDING,
  CAMERA_PINS,
  CHARGER_BAY,
  CHARGER_BAYS,
  CONE_HALF_DEG,
  CONE_LEN,
  DOCK_DOORS,
  EAST_DOOR,
  LANE,
  OFFICE,
  OFFICE_SPLIT_X,
  PLAN_H,
  PLAN_W,
  RACK_BOTTOM,
  RACK_TOP,
  RACK_W,
  RACK_XS,
  SHIPPING_DOCK,
  UNITS_PER_M,
  WALKWAY,
  ZONES,
} from "@/app/lib/floorPlan";
import { useCommand } from "@/app/lib/ui/commandStore";
import FloorAgents from "./FloorAgents";

const W = PLAN_W;
const H = PLAN_H;

function cone(x: number, y: number, dir: number, len = CONE_LEN, half = CONE_HALF_DEG): string {
  const rad = (a: number) => (a * Math.PI) / 180;
  const p = (a: number) => `${(x + len * Math.cos(rad(a))).toFixed(1)} ${(y + len * Math.sin(rad(a))).toFixed(1)}`;
  return `M${x} ${y} L${p(dir - half)} A${len} ${len} 0 0 1 ${p(dir + half)} Z`;
}

const INK = "#2b3140";
const ACCENT = "#4a54c6";
const HIGH = "#d03b2f";
const FIXTURE = "#8a909c";

function heat(total: number, max: number, hovered: boolean): string {
  if (total === 0) return `rgba(43,49,64,${hovered ? 0.05 : 0.018})`;
  return `rgba(208,59,47,${(0.05 + 0.09 * (total / max) + (hovered ? 0.04 : 0)).toFixed(3)})`;
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
  const hoveredRect = hover ? ZONES[hover] : undefined;
  const hoveredStatus = hover ? cameraOf.get(hover) : undefined;
  const below = hoveredRect ? hoveredRect.y + hoveredRect.h < H * 0.6 : true;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full rounded-xl border border-line bg-surface"
        role="group"
        aria-label="Site floor plan"
      >
        <defs>
          <pattern id="fp-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M16 0H0V16" fill="none" stroke={INK} strokeOpacity="0.045" />
          </pattern>
          <pattern id="fp-walkway" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="10" fill="#3f8a4f" fillOpacity="0.13" />
          </pattern>
          {statuses.map((s) => {
            const top = activeByCamera[s.camera.id]?.[0];
            const color = top ? PRIORITY_COLOR[top.priority] : INK;
            const pin = CAMERA_PINS[s.camera.zoneId];
            if (!pin) return null;
            return (
              <radialGradient key={s.camera.id} id={`fov-${s.camera.id}`} gradientUnits="userSpaceOnUse" cx={pin.x} cy={pin.y} r={CONE_LEN}>
                <stop offset="0" stopColor={color} stopOpacity={top ? 0.4 : 0.16} />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </radialGradient>
            );
          })}
        </defs>

        <rect width={W} height={H} fill="url(#fp-grid)" />

        {/* building shell */}
        <rect x={BUILDING.x} y={BUILDING.y} width={BUILDING.w} height={BUILDING.h} rx="3" fill="#f8f9fa" stroke={INK} strokeWidth="5" />
        {DOCK_DOORS.map((x) => (
          <g key={x}>
            <rect x={x - 26} y={BUILDING.y - 5} width="52" height="10" rx="1.5" fill="#e9ebef" stroke={FIXTURE} strokeWidth="1.25" />
            <line x1={x - 18} y1={BUILDING.y} x2={x + 18} y2={BUILDING.y} stroke={FIXTURE} strokeOpacity="0.6" />
          </g>
        ))}
        <rect x={EAST_DOOR.x} y={EAST_DOOR.y} width="10" height={EAST_DOOR.h} fill="#f8f9fa" />
        <line x1={EAST_DOOR.x - 3} y1={EAST_DOOR.y} x2={EAST_DOOR.x + 13} y2={EAST_DOOR.y} stroke={INK} strokeWidth="2" />
        <line x1={EAST_DOOR.x - 3} y1={EAST_DOOR.y + EAST_DOOR.h} x2={EAST_DOOR.x + 13} y2={EAST_DOOR.y + EAST_DOOR.h} stroke={INK} strokeWidth="2" />

        {/* walkway between the docks and the floor */}
        <rect x={WALKWAY.x} y={WALKWAY.y} width={WALKWAY.w} height={WALKWAY.h} fill="url(#fp-walkway)" />
        <line x1={WALKWAY.x} y1={WALKWAY.y} x2={WALKWAY.x + WALKWAY.w} y2={WALKWAY.y} stroke="#3f8a4f" strokeOpacity="0.4" />
        <line x1={WALKWAY.x} y1={WALKWAY.y + WALKWAY.h} x2={WALKWAY.x + WALKWAY.w} y2={WALKWAY.y + WALKWAY.h} stroke="#3f8a4f" strokeOpacity="0.4" />

        {/* areas without a camera */}
        <g className="pointer-events-none">
          {SHIPPING_DOCK.w > 0 && (
            <>
              <rect x={SHIPPING_DOCK.x} y={SHIPPING_DOCK.y} width={SHIPPING_DOCK.w} height={SHIPPING_DOCK.h} rx="4" fill="none" stroke="#c4c8cf" strokeDasharray="5 5" />
              <text x={SHIPPING_DOCK.x + 16} y={SHIPPING_DOCK.y + 24} className="fill-ink-3 text-[11px] font-medium tracking-[0.1em]">SHIPPING DOCK</text>
            </>
          )}
          <rect x={OFFICE.x} y={OFFICE.y} width={OFFICE.w} height={OFFICE.h} rx="4" fill="#eef0f3" stroke="#d3d6dc" />
          <line x1={OFFICE_SPLIT_X} y1={OFFICE.y} x2={OFFICE_SPLIT_X} y2={OFFICE.y + OFFICE.h} stroke="#d3d6dc" />
          <text x={OFFICE.x + 16} y={OFFICE.y + 24} className="fill-ink-3 text-[11px] font-medium tracking-[0.1em]">OFFICE</text>
          <text x={OFFICE_SPLIT_X + 16} y={OFFICE.y + 24} className="fill-ink-3 text-[11px] font-medium tracking-[0.1em]">BREAKROOM</text>
        </g>

        {/* camera zones */}
        {zones.map((z) => {
          const r = ZONES[z.zoneId];
          if (!r) return null;
          const selected = selectedZoneId === z.zoneId;
          const highlighted = highlightZoneIds.includes(z.zoneId);
          const dimmed = !!selectedZoneId && !selected;
          return (
            <g
              key={z.zoneId}
              className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[#4a54c6]"
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
              style={{ opacity: dimmed ? 0.5 : 1, transition: "opacity 200ms cubic-bezier(0.22,1,0.36,1)" }}
            >
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx="4"
                fill={heat(z.total, max, hover === z.zoneId)}
                stroke={selected || highlighted ? ACCENT : z.total ? "rgba(208,59,47,0.45)" : "#c4c8cf"}
                strokeWidth={selected ? 2.5 : highlighted ? 2 : 1.25}
                strokeDasharray={highlighted && !selected ? "6 4" : undefined}
                className={highlighted && !selected ? "zone-glow" : ""}
                style={{ transition: "fill 200ms ease-out, stroke 200ms ease-out" }}
              />
            </g>
          );
        })}

        {/* floor fixtures sit above zone shading so the layout stays readable */}
        <g className="pointer-events-none">
          {RACK_XS.map((x) => (
            <g key={x}>
              <rect x={x} y={RACK_TOP} width={RACK_W} height={RACK_BOTTOM - RACK_TOP} rx="1.5" fill="#e9ebef" stroke={FIXTURE} />
              <line x1={x + RACK_W / 2} y1={RACK_TOP} x2={x + RACK_W / 2} y2={RACK_BOTTOM} stroke={FIXTURE} strokeOpacity="0.5" />
              {Array.from({ length: 8 }, (_, i) => RACK_TOP + ((i + 1) * (RACK_BOTTOM - RACK_TOP)) / 9).map((y) => (
                <line key={y} x1={x} y1={y} x2={x + RACK_W} y2={y} stroke={FIXTURE} strokeOpacity="0.5" />
              ))}
            </g>
          ))}

          {[LANE.left, LANE.right].map((x) => (
            <line key={x} x1={x} y1={LANE.top} x2={x} y2={LANE.bottom} stroke="#c99a12" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="12 8" />
          ))}
          {[0.25, 0.5, 0.75].map((f) => LANE.top + f * (LANE.bottom - LANE.top)).map((y) => {
            const mid = (LANE.left + LANE.right) / 2;
            return (
              <path key={y} d={`M${mid - 14} ${y - 8} L${mid} ${y + 4} L${mid + 14} ${y - 8}`} fill="none" stroke="#c99a12" strokeOpacity="0.7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            );
          })}

          {CHARGER_BAYS.map((x) => (
            <g key={x}>
              <rect x={x} y={CHARGER_BAY.y} width={CHARGER_BAY.w} height={CHARGER_BAY.h} rx="2" fill="none" stroke="#b8bdc6" strokeDasharray="4 4" />
              <rect x={x + 14} y="558" width="20" height="12" rx="2" fill="#e9ebef" stroke={FIXTURE} />
              <path d={`M${x + 26} 560 l-5 5 h4 l-3 4`} fill="none" stroke="#3f8a4f" strokeOpacity="0.9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}

          {zones.map((z) => {
            const r = ZONES[z.zoneId];
            if (!r) return null;
            const selected = selectedZoneId === z.zoneId;
            const dimmed = !!selectedZoneId && !selected;
            const count = z.total ? `${z.total} incident${z.total === 1 ? "" : "s"}` : "No incidents";
            return (
              <g key={z.zoneId} style={{ opacity: dimmed ? 0.5 : 1, transition: "opacity 200ms ease-out" }}>
                <text x={r.x + 14} y={r.y + 24} className="fill-ink text-[12px] font-semibold tracking-[0.08em]">
                  {z.zone.toUpperCase()}
                </text>
                <text x={r.x + 14} y={r.y + 42} className="text-[12px]" fill={z.total ? HIGH : FIXTURE} fontWeight={z.total ? 500 : 400}>
                  {count}
                </text>
              </g>
            );
          })}
        </g>

        <FloorAgents />

        {statuses.map((s) => {
          const pin = CAMERA_PINS[s.camera.zoneId];
          if (!pin) return null;
          const top = activeByCamera[s.camera.id]?.[0];
          const color = top ? PRIORITY_COLOR[top.priority] : INK;
          return (
            <g
              key={s.camera.id}
              className="cursor-pointer"
              onClick={() => (top ? openIncident(top.id) : toggleZone(s.camera.zoneId))}
              onMouseEnter={() => enter(s.camera.zoneId)}
              onMouseLeave={leave}
            >
              <title>{top ? `${s.camera.id}: ${EVENT_LABEL[top.eventType]} (click to review)` : s.camera.id}</title>
              <path d={cone(pin.x, pin.y, pin.dir)} fill={`url(#fov-${s.camera.id})`} />
              {top && <circle cx={pin.x} cy={pin.y} r="9" fill={color} className="pin-ping" />}
              <circle cx={pin.x} cy={pin.y} r="9" fill="#fcfcfd" stroke={color} strokeWidth="2" />
              <circle cx={pin.x} cy={pin.y} r="3.5" fill={color} />
            </g>
          );
        })}

        {/* north arrow and scale */}
        <g className="pointer-events-none" transform="translate(978 20)">
          <path d="M0 -10 L5 4 L0 1 L-5 4 Z" fill={FIXTURE} />
          <text y="16" textAnchor="middle" className="fill-ink-3 text-[9px] font-semibold">N</text>
        </g>
        <g className="pointer-events-none" transform="translate(64 622)">
          <line x1="0" y1="0" x2={UNITS_PER_M * 10} y2="0" stroke={FIXTURE} strokeWidth="1.5" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke={FIXTURE} strokeWidth="1.5" />
          <line x1={UNITS_PER_M * 10} y1="-4" x2={UNITS_PER_M * 10} y2="4" stroke={FIXTURE} strokeWidth="1.5" />
          <text x={UNITS_PER_M * 10 + 12} y="4" className="fill-ink-3 text-[10px]">10 m</text>
        </g>
      </svg>

      {hovered && hoveredRect && (
        <div
          className="pointer-events-auto absolute z-10 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface p-3 text-[12px] shadow-lg shadow-ink/10"
          style={{
            left: `${Math.min(76, Math.max(24, ((hoveredRect.x + hoveredRect.w / 2) / W) * 100))}%`,
            ...(below
              ? { top: `${((hoveredRect.y + hoveredRect.h + 8) / H) * 100}%` }
              : { bottom: `${((H - hoveredRect.y + 8) / H) * 100}%` }),
          }}
          onMouseEnter={() => enter(hovered.zoneId)}
          onMouseLeave={leave}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-ink">{hovered.zone}</span>
            <span className="font-mono text-[11px] text-ink-3">{hoveredStatus?.camera.id}</span>
          </div>
          <div className="mt-0.5 text-ink-2">
            {hovered.total} incident{hovered.total === 1 ? "" : "s"} · {hovered.kept} kept
          </div>
          {hovered.eventTypes.length > 0 && (
            <div className="mt-1 text-ink-3">{hovered.eventTypes.map((t) => EVENT_LABEL[t]).join(", ")}</div>
          )}
          {hoveredStatus?.latest ? (
            <button
              type="button"
              onClick={() => openIncident(hoveredStatus.latest!.id)}
              className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-left text-ink transition-colors hover:bg-hover"
            >
              <span className="truncate">{EVENT_LABEL[hoveredStatus.latest.eventType]}</span>
              <span className="flex-shrink-0 font-mono text-ink-3">{formatSpan(hoveredStatus.latest.startSec, hoveredStatus.latest.endSec)}</span>
            </button>
          ) : (
            <div className="mt-2 text-ink-3">Nothing to review.</div>
          )}
        </div>
      )}
    </div>
  );
}
