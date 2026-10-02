"use client";

import { useEffect, useState } from "react";
import type { FloorAgent, FloorTracks } from "@/app/lib/floorTracks";
import { cameraTime } from "@/app/lib/ui/videoClock";

/** Plan-unit markers, matching the 3D view's palette (sitemap3d/shared.ts). */
const COLOR = { still: "#a8aeb8", moving: "#394052", forklift: "#d49a26", high: "#d03b2f" };
const TRAIL_SAMPLES = 6;
/** Redraw rate; tracks are sampled every 0.5 s, so 20 fps interpolation is already smooth. */
const FRAME_MS = 50;

interface Placed {
  agent: FloorAgent;
  x: number;
  y: number;
  heading: number;
  trail: string | null;
  alerted: boolean;
}

function place(agent: FloorAgent, t: number, step: number, alertedKeys: Set<string>): Placed | null {
  const s = t / step - agent.from;
  const n = agent.x.length;
  if (s < 0 || s > n - 1 + 0.5) return null;
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(s)));
  const i1 = Math.min(n - 1, i0 + 1);
  const f = Math.max(0, Math.min(1, s - i0));
  const x = agent.x[i0] + (agent.x[i1] - agent.x[i0]) * f;
  const y = agent.y[i0] + (agent.y[i1] - agent.y[i0]) * f;
  const back = Math.max(0, i0 - 3);
  const heading = (Math.atan2(agent.y[i1] - agent.y[back], agent.x[i1] - agent.x[back]) * 180) / Math.PI;
  let trail: string | null = null;
  if (agent.moving && i0 > 0) {
    const from = Math.max(0, i0 - TRAIL_SAMPLES);
    const pts = [];
    for (let i = from; i <= i0; i++) pts.push(`${agent.x[i]},${agent.y[i]}`);
    pts.push(`${x},${y}`);
    trail = pts.join(" ");
  }
  return { agent, x, y, heading, trail, alerted: alertedKeys.has(agent.key) };
}

/**
 * Everyone each camera is tracking, on the 2D plan. Each camera's markers follow that camera's
 * video when a tile for it is playing (see videoClock.ts), else loop its footage on a site clock.
 */
function layout(data: FloorTracks, siteT: number): Placed[] {
  const durations = Object.fromEntries(data.cameras.map((c) => [c.id, c.durationSec]));
  const timeOf = (cameraId: string) => cameraTime(cameraId, siteT, durations[cameraId] ?? data.durationSec);
  const alertedKeys = new Set<string>();
  for (const inc of data.incidents) {
    const t = timeOf(inc.cameraId);
    if (t >= inc.startSec && t <= inc.endSec) inc.agentKeys.forEach((k) => alertedKeys.add(k));
  }
  return data.agents
    .map((a) => place(a, timeOf(a.cameraId), data.sampleStep, alertedKeys))
    .filter((p): p is Placed => p !== null)
    .sort((a, b) => Number(a.alerted) - Number(b.alerted));
}

/**
 * Everyone each camera is tracking, on the 2D plan. Each camera's markers follow that camera's
 * video when a tile for it is playing (see videoClock.ts), else loop its footage on a site clock.
 */
export default function FloorAgents() {
  const [data, setData] = useState<FloorTracks | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/floor-tracks", { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<FloorTracks>) : null))
      .then((d) => d && setData(d))
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (!data) return;
    const begin = performance.now();
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        setPlaced(layout(data, (now - begin) / 1000));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  return (
    <g className="pointer-events-none" aria-label="Tracked people and vehicles">
      {placed.map((p) =>
        p.trail ? (
          <polyline
            key={`trail-${p.agent.key}`}
            points={p.trail}
            fill="none"
            stroke={p.alerted ? COLOR.high : p.agent.kind === "vehicle" ? COLOR.forklift : COLOR.moving}
            strokeOpacity="0.35"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null,
      )}
      {placed.map((p) => {
        const color = p.alerted ? COLOR.high : p.agent.kind === "vehicle" ? COLOR.forklift : p.agent.moving ? COLOR.moving : COLOR.still;
        return (
          <g key={p.agent.key} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
            <title>
              {p.agent.kind === "vehicle" ? `${p.agent.cls ?? "vehicle"} V${p.agent.trackId}` : `person #${p.agent.trackId}`} · {p.agent.zone}
            </title>
            {p.alerted && <circle r="11" fill={COLOR.high} className="pin-ping" />}
            {p.agent.kind === "vehicle" ? (
              <g transform={`rotate(${p.heading.toFixed(0)})`}>
                <rect x="-10" y="-6" width="20" height="12" rx="2.5" fill={color} stroke="#fcfcfd" strokeWidth="1.5" />
                <rect x="6" y="-4" width="7" height="2" fill={color} />
                <rect x="6" y="2" width="7" height="2" fill={color} />
              </g>
            ) : (
              <circle r="5" fill={color} stroke="#fcfcfd" strokeWidth="1.5" />
            )}
          </g>
        );
      })}
    </g>
  );
}
