"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import { CAMERA_PINS, HEIGHT, ZONE_LABEL_AT, ZONES } from "@/app/lib/floorPlan";
import type { FloorIncident, FloorTracks } from "@/app/lib/floorTracks";
import { buildHeat, heatColor, incidentSpots, simulateHistory } from "@/app/lib/incidentHeat";
import type { ZoneCount } from "@/app/lib/search";
import { EVENT_LABEL_SHORT, type EventType } from "@/app/lib/types";
import { useCommand } from "@/app/lib/ui/commandStore";
import Agents, { buildPaths, Driver, type AgentPath } from "./sitemap3d/Agents";
import { LabelLayer, LabelProjector, LabelStore, type Label } from "./sitemap3d/labels";
import { CameraMounts, IncidentPins, PIN_H, RestrictedLane, ZoneFloors } from "./sitemap3d/Overlays";
import { Playhead } from "./sitemap3d/playhead";
import HeatLayer from "./sitemap3d/Heat";
import Shell from "./sitemap3d/Shell";
import { at, boxOf, C } from "./sitemap3d/shared";

interface Props {
  zones: ZoneCount[];
  statuses: CameraStatus[];
}

const SPEEDS = [0.5, 1, 2, 4] as const;
const OVERVIEW = { target: new THREE.Vector3(0, 0, 0), distance: 86 };

/** The slice of OrbitControls this component drives. */
interface Orbit {
  target: THREE.Vector3;
  update(): void;
  addEventListener(type: "start", fn: () => void): void;
  removeEventListener(type: "start", fn: () => void): void;
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Where each incident is standing, taken from its agents halfway through the window. */
function pinPositions(
  paths: AgentPath[],
  incidents: FloorIncident[],
  step: number,
): Record<string, [number, number, number]> {
  const byKey = new Map(paths.map((p) => [p.agent.key, p]));
  const out: Record<string, [number, number, number]> = {};
  for (const inc of incidents) {
    const slot = Math.round((inc.startSec + inc.endSec) / 2 / step);
    let x = 0;
    let z = 0;
    let n = 0;
    for (const key of inc.agentKeys) {
      const p = byKey.get(key);
      if (!p) continue;
      const i = Math.max(0, Math.min(p.wx.length - 1, slot - p.agent.from));
      x += p.wx[i];
      z += p.wz[i];
      n++;
    }
    if (n) out[inc.id] = [x / n, 0, z / n];
  }
  return out;
}

/**
 * Eases the orbit camera onto whatever the supervisor selected, keeping whichever angle they
 * were already looking from, and gets out of the way the moment they take the mouse.
 */
function ViewRig({ focus }: { focus: { key: string; target: THREE.Vector3; distance: number } }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as Orbit | null;
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!controls) return;
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1) dir.set(0, 0.76, 0.65);
    dir.normalize();
    goal.current = {
      target: focus.target.clone(),
      position: focus.target.clone().addScaledVector(dir, focus.distance),
    };
    const cancel = () => {
      goal.current = null;
    };
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [focus, camera, controls]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 4.5);
    controls.target.lerp(g.target, k);
    camera.position.lerp(g.position, k);
    controls.update();
    if (camera.position.distanceTo(g.position) < 0.25) goal.current = null;
  });

  return null;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#ffffff", "#ccd3dd", 0.45]} />
      <directionalLight
        position={[68, 74, -58]}
        intensity={1.0}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0009}
        shadow-camera-left={-78}
        shadow-camera-right={78}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-far={300}
      />
    </>
  );
}

function Placeholder({ note }: { note: string }) {
  return (
    <div className="flex h-[clamp(360px,calc(100vh-20rem),720px)] items-center justify-center rounded-xl border border-line bg-sunken">
      <p className="text-[13px] text-ink-3">{note}</p>
    </div>
  );
}

/** Labels float over a 3D scene, so they carry a halo instead of a box. */
const tag = "whitespace-nowrap font-mono text-[10px] leading-none";
const HALO = "0 0 3px #f4f5f8, 0 0 3px #f4f5f8, 0 0 6px #f4f5f8";

export default function SiteMap3D({ zones, statuses }: Props) {
  const { selectedZoneId, toggleZone, selectZone, highlightZoneIds, openIncident } = useCommand();
  const [data, setData] = useState<FloorTracks | null>(null);
  const [error, setError] = useState(false);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [view, setView] = useState<"live" | "heat">("live");
  const [simulate, setSimulate] = useState(false);

  const [head] = useState(() => new Playhead());
  const [labels] = useState(() => new LabelStore());
  const timeRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/floor-tracks", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: FloorTracks) => {
        head.setDuration(d.durationSec);
        head.cameraDurations = Object.fromEntries(d.cameras.map((c) => [c.id, c.durationSec]));
        setData(d);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      });
    return () => ctl.abort();
  }, [head]);

  const paths = useMemo(() => (data ? buildPaths(data) : []), [data]);
  const pins = useMemo(
    () => (data ? pinPositions(paths, data.incidents, data.sampleStep) : {}),
    [data, paths],
  );

  const heat = useMemo(() => {
    if (!data) return null;
    const { spots, perIncident } = incidentSpots(data);
    const extra = simulate ? simulateHistory(data, perIncident) : [];
    // each simulated incident is splatted as four points
    return buildHeat([...spots, ...extra], data.incidents.length, Math.round(extra.length / 4));
  }, [data, simulate]);

  const active = useMemo(() => {
    const open = (data?.incidents ?? []).filter((i) => activeIds.includes(i.id));
    return {
      keys: new Set(open.flatMap((i) => i.agentKeys)),
      zones: new Set(open.map((i) => i.zoneId)),
      cameras: new Set(open.map((i) => i.cameraId)),
      list: open,
    };
  }, [data, activeIds]);

  const focus = useMemo(() => {
    const rect = selectedZoneId ? ZONES[selectedZoneId] : null;
    if (!rect) return { key: "overview", ...OVERVIEW };
    const b = boxOf(rect);
    return {
      key: selectedZoneId!,
      target: new THREE.Vector3(b.x, 0, b.z),
      distance: Math.max(b.w, b.d) * 1.5 + 22,
    };
  }, [selectedZoneId]);

  /** Zone names, camera ids, incident heads, and a tag per moving track. */
  const labelList = useMemo((): Label[] => {
    const out: Label[] = [];
    for (const z of zones) {
      const rect = ZONES[z.zoneId];
      if (!rect) continue;
      const alerted = active.zones.has(z.zoneId);
      const selected = selectedZoneId === z.zoneId;
      const spot = ZONE_LABEL_AT[z.zoneId] ?? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      out.push({
        id: `zone-${z.zoneId}`,
        anchor: at(spot.x, spot.y, 0.3),
        node: (
          <div className="text-center" style={{ textShadow: HALO }}>
            <div
              className="whitespace-nowrap text-[11px] font-semibold tracking-[0.1em]"
              style={{ color: alerted ? C.high : selected ? C.accent : "#454c5c" }}
            >
              {z.zone.toUpperCase()}
            </div>
            <div
              className="whitespace-nowrap text-[10px]"
              style={{ color: z.total ? "#767c89" : "#a2a8b2" }}
            >
              {z.total ? `${z.total} incident${z.total === 1 ? "" : "s"}` : "no incidents"}
            </div>
          </div>
        ),
      });
    }

    for (const s of statuses) {
      const pin = CAMERA_PINS[s.camera.zoneId];
      if (!pin) continue;
      const alerted = active.cameras.has(s.camera.id);
      out.push({
        id: `cam-${s.camera.id}`,
        anchor: at(pin.x, pin.y, HEIGHT.cameraMount + 1),
        interactive: true,
        node: (
          <button
            type="button"
            onClick={() => toggleZone(s.camera.zoneId)}
            className={`${tag} transition-colors hover:underline`}
            style={{
              color: alerted ? C.high : "#6b7280",
              textShadow: HALO,
              fontWeight: alerted ? 600 : 400,
            }}
          >
            {s.camera.id.replace("WH_", "")}
          </button>
        ),
      });
    }

    for (const inc of data?.incidents ?? []) {
      const pos = pins[inc.id];
      if (!pos) continue;
      const open = activeIds.includes(inc.id);
      out.push({
        id: `inc-${inc.id}`,
        anchor: [pos[0], PIN_H + 0.3, pos[2]],
        interactive: true,
        node: (
          <button
            type="button"
            onClick={() => openIncident(inc.id)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 text-[11px] font-medium leading-none shadow-sm transition-colors"
            style={
              open
                ? { background: C.high, borderColor: C.high, color: "#fff" }
                : { background: "rgba(255,255,255,0.95)", borderColor: "#e3c3bf", color: C.high }
            }
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: open ? "#fff" : C.high }}
            />
            {EVENT_LABEL_SHORT[inc.eventType as EventType] ?? inc.eventType}
          </button>
        ),
      });
    }

    for (const p of paths) {
      if (!p.agent.moving) continue;
      const alerted = active.keys.has(p.agent.key);
      const vehicle = p.agent.kind === "vehicle";
      out.push({
        id: p.agent.key,
        node: (
          <span
            className={tag}
            style={{
              color: alerted ? C.high : vehicle ? "#8a6a10" : C.moving,
              textShadow: HALO,
              fontWeight: alerted ? 600 : 400,
            }}
          >
            {vehicle ? `${p.agent.cls ?? "vehicle"} #` : "#"}
            {p.agent.trackId}
            {" · "}
            {p.agent.cameraId.replace("WH_", "")}
          </span>
        ),
      });
    }
    return out;
  }, [
    zones,
    statuses,
    paths,
    pins,
    data,
    activeIds,
    active,
    selectedZoneId,
    toggleZone,
    openIncident,
  ]);

  const onTick = useCallback((t: number) => {
    if (timeRef.current) timeRef.current.textContent = clock(t);
    const slider = sliderRef.current;
    if (slider && document.activeElement !== slider) slider.value = t.toFixed(2);
  }, []);

  const setPlay = (next: boolean) => {
    head.setPlaying(next);
    setPlaying(next);
  };
  const pickSpeed = (next: number) => {
    head.setSpeed(next);
    setSpeed(next);
  };

  if (error) return <Placeholder note="Could not load floor tracks. Run pipeline/detect.py, then reload." />;
  if (!data) return <Placeholder note="Projecting camera tracks onto the floor…" />;

  const moving = data.agents.filter((a) => a.moving).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-[clamp(360px,calc(100vh-20rem),720px)] overflow-hidden rounded-xl border border-line bg-surface">
        <Canvas
          flat
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ position: [0, 70, 60], fov: 38, near: 0.5, far: 900 }}
          onPointerMissed={() => selectZone(null)}
        >
          <color attach="background" args={[C.bg]} />
          <Lights />
          <Shell />
          <RestrictedLane alerted={active.zones.has("cross_aisle")} />
          {view === "heat" && heat && <HeatLayer heat={heat} />}
          <ZoneFloors
            zones={zones}
            selectedZoneId={selectedZoneId}
            highlightZoneIds={highlightZoneIds}
            alertedZoneIds={active.zones}
            onToggle={toggleZone}
          />
          <CameraMounts
            statuses={statuses}
            alertedCameraIds={active.cameras}
            onPick={(s) => toggleZone(s.camera.zoneId)}
          />
          <Agents
            paths={paths}
            head={head}
            step={data.sampleStep}
            alertedKeys={active.keys}
            labels={labels}
          />
          <IncidentPins incidents={data.incidents} positions={pins} activeIds={activeIds} />
          <Driver head={head} incidents={data.incidents} onTick={onTick} onActive={setActiveIds} />
          <LabelProjector store={labels} />
          <ViewRig focus={focus} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={14}
            maxDistance={210}
            minPolarAngle={0.12}
            maxPolarAngle={Math.PI / 2.15}
            target={[0, 0, 0]}
          />
        </Canvas>

        <LabelLayer store={labels} labels={labelList} />

        <div className="absolute left-3 top-3 flex items-center rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur-sm">
          {([
            ["live", "Live"],
            ["heat", "Heat map"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`px-2.5 py-1 text-[12px] transition-colors first:rounded-l-md last:rounded-r-md ${
                view === value ? "bg-accent-soft font-medium text-accent" : "text-ink-3 hover:bg-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "heat" && heat ? (
          <div className="absolute bottom-3 left-3 flex w-60 flex-col gap-2 rounded-lg border border-line bg-surface/95 px-3 py-2.5 text-[11px] text-ink-3 backdrop-blur-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-ink">Where incidents happen</span>
              <span className="tabular-nums">
                {heat.realIncidents} real{heat.simulatedIncidents ? ` + ${heat.simulatedIncidents} sim.` : ""}
              </span>
            </div>
            <div>
              <div
                className="h-2 w-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${[0.05, 0.3, 0.55, 0.8, 1]
                    .map((t) => {
                      const [r, g, b] = heatColor(t);
                      return `rgb(${r | 0},${g | 0},${b | 0})`;
                    })
                    .join(",")})`,
                }}
              />
              <div className="mt-0.5 flex justify-between">
                <span>Fewer</span>
                <span>More, weighted by priority</span>
              </div>
            </div>
            <ol className="flex flex-col gap-0.5">
              {heat.zones.filter((z) => z.weight > 0).slice(0, 4).map((z, i) => (
                <li key={z.zoneId} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-2">
                    {i + 1}. {zones.find((zz) => zz.zoneId === z.zoneId)?.zone ?? z.zoneId}
                  </span>
                  <span className="tabular-nums">{Math.round(z.share * 100)}%</span>
                </li>
              ))}
            </ol>
            <label className="flex items-center gap-1.5 border-t border-line pt-2 text-ink-2">
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} className="accent-accent" />
              Simulate a week of history
            </label>
            {simulate && (
              <span className="leading-snug text-[#b45309]">
                Demo data: simulated incidents seeded from the real ones and the site&rsquo;s risk areas.
              </span>
            )}
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-lg border border-line bg-surface/90 px-3 py-2 text-[11px] text-ink-3 backdrop-blur-sm">
          <span className="text-[12px] font-medium text-ink">
            {data.agents.length} tracks · {moving} moving
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.moving }} />
            Walking
            <span className="ml-2 h-2.5 w-2.5 rounded-full" style={{ background: C.still }} />
            Standing
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.forklift }} />
            Forklift
            <span className="ml-2 h-2.5 w-2.5 rounded-full" style={{ background: C.high }} />
            Flagged
          </span>
        </div>
        )}

        {active.list.length > 0 && (
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            {active.list.map((inc) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => openIncident(inc.id)}
                className="feed-pop flex items-center gap-2 rounded-lg border border-high-line bg-high-soft px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-high-soft/70"
              >
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-high" />
                <span className="font-medium text-high">
                  {EVENT_LABEL_SHORT[inc.eventType as EventType] ?? inc.eventType}
                </span>
                <span className="text-ink-3">now · {inc.zoneId.replace(/_/g, " ")}</span>
                <span className="text-ink-2">→</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlay(!playing)}
          aria-label={playing ? "Pause playback" : "Play playback"}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors hover:bg-hover"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden>
            {playing ? (
              <path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z" />
            ) : (
              <path d="M3 1.4 10.2 6 3 10.6z" />
            )}
          </svg>
        </button>
        <span className="flex-shrink-0 font-mono text-[12px] tabular-nums text-ink-2">
          <span ref={timeRef}>0:00</span>
          <span className="text-ink-3"> / {clock(data.durationSec)}</span>
        </span>
        <div className="relative min-w-[180px] flex-1">
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={data.durationSec}
            step={0.05}
            defaultValue={0}
            aria-label="Scrub floor playback"
            onChange={(e) => head.seek(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="pointer-events-none absolute inset-x-0 -bottom-0.5 h-1">
            {data.incidents.map((inc) => (
              <span
                key={inc.id}
                className="absolute h-1 rounded-full bg-high"
                style={{
                  left: `${(inc.startSec / data.durationSec) * 100}%`,
                  width: `${Math.max(1, ((inc.endSec - inc.startSec) / data.durationSec) * 100)}%`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center rounded-md border border-line bg-surface">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pickSpeed(s)}
              aria-pressed={speed === s}
              className={`px-2 py-1 text-[12px] tabular-nums transition-colors first:rounded-l-md last:rounded-r-md ${
                speed === s ? "bg-accent-soft font-medium text-accent" : "text-ink-3 hover:bg-hover"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => selectZone(null)}
          className="flex-shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-hover"
        >
          Whole floor
        </button>
      </div>
    </div>
  );
}
