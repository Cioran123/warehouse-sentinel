"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { planToWorld } from "@/app/lib/floorPlan";
import type { FloorAgent, FloorIncident, FloorTracks } from "@/app/lib/floorTracks";
import type { LabelStore } from "./labels";
import type { Playhead } from "./playhead";
import { C } from "./shared";

/**
 * Figures are drawn about a third over life size. At 100 m across, a 1.7 m body is four pixels
 * of a fitted view, so this is the same move a map makes when it draws a town bigger than scale.
 */
const FIGURE = 1.6;

/** Where an agent's label floats, in metres above the floor. */
const LABEL_H = { person: 2.6, vehicle: 3.4 };

export interface AgentPath {
  agent: FloorAgent;
  /** World metres per sample index. */
  wx: Float32Array;
  wz: Float32Array;
  prone: Uint8Array;
  /** Full floor route, drawn for agents that actually travel. */
  route: THREE.Vector3[] | null;
}

/** Projected plan coordinates into world metres, once, so the frame loop only interpolates. */
export function buildPaths(data: FloorTracks): AgentPath[] {
  return data.agents.map((agent) => {
    const n = agent.x.length;
    const wx = new Float32Array(n);
    const wz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = planToWorld(agent.x[i], agent.y[i]);
      wx[i] = x;
      wz[i] = z;
    }
    const prone = new Uint8Array(n);
    for (let i = 0; i < agent.prone.length; i += 2) {
      for (let s = agent.prone[i]; s <= agent.prone[i + 1]; s++) {
        const idx = s - agent.from;
        if (idx >= 0 && idx < n) prone[idx] = 1;
      }
    }
    const route = agent.moving
      ? Array.from({ length: n }, (_, i) => new THREE.Vector3(wx[i], 0.06, wz[i]))
      : null;
    return { agent, wx, wz, prone, route };
  });
}

/** Advances the clock, reports it, and announces which incident windows are open. */
export function Driver({
  head,
  incidents,
  onTick,
  onActive,
}: {
  head: Playhead;
  incidents: FloorIncident[];
  onTick: (t: number) => void;
  onActive: (ids: string[]) => void;
}) {
  const lastKey = useRef("");
  useFrame((_, dt) => {
    head.advance(dt);
    const now = head.t;
    onTick(now);
    const open = incidents.filter((i) => now >= i.startSec && now <= i.endSec);
    const key = open.map((i) => i.id).join(",");
    if (key !== lastKey.current) {
      lastKey.current = key;
      onActive(open.map((i) => i.id));
    }
  }, -1);
  return null;
}

interface Pose {
  x: number;
  z: number;
  heading: number;
  prone: number;
  speed: number;
}

/** Shared sampling: where is this track right now, and which way is it facing? */
function usePose(path: AgentPath, head: Playhead, step: number) {
  const pose = useRef<Pose>({ x: path.wx[0], z: path.wz[0], heading: 0, prone: 0, speed: 0 });
  const sample = (dt: number): boolean => {
    const s = head.t / step - path.agent.from;
    const n = path.wx.length;
    if (s < -1 || s > n) return false;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(s)));
    const i1 = Math.min(n - 1, i0 + 1);
    const f = Math.max(0, Math.min(1, s - i0));
    const back = Math.max(0, i0 - 4);
    const dx = path.wx[i1] - path.wx[back];
    const dz = path.wz[i1] - path.wz[back];
    const travel = Math.hypot(dx, dz);

    const p = pose.current;
    p.x = path.wx[i0] + (path.wx[i1] - path.wx[i0]) * f;
    p.z = path.wz[i0] + (path.wz[i1] - path.wz[i0]) * f;
    if (travel > 0.25) p.heading = Math.atan2(dx, dz);
    p.speed = travel / (step * Math.max(1, i1 - back));
    p.prone += ((path.prone[i0] ? 1 : 0) - p.prone) * Math.min(1, dt * 4);
    return true;
  };
  return { pose, sample };
}

function Person({
  path,
  head,
  step,
  alerted,
  labels,
}: {
  path: AgentPath;
  head: Playhead;
  step: number;
  alerted: boolean;
  labels: LabelStore;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const { pose, sample } = usePose(path, head, step);
  const { moving, key } = path.agent;
  const color = alerted ? C.high : moving ? C.moving : C.still;

  useFrame((state, dt) => {
    const g = root.current;
    const b = body.current;
    if (!g || !b) return;
    const live = sample(dt);
    g.visible = live;
    if (!live) return;
    const p = pose.current;
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.heading;
    // The detector sees the box go wide and short when someone goes down; lay the figure over.
    b.rotation.x = p.prone * (Math.PI / 2);
    b.position.y = p.prone * 0.3;
    if (moving) labels.set(key, p.x, LABEL_H.person - p.prone * 1.4, p.z);
    if (ring.current) {
      ring.current.scale.setScalar(
        alerted ? 1 + 0.2 * Math.sin(state.clock.elapsedTime * 4.2) : 1,
      );
    }
  });

  return (
    <group ref={root}>
      <group ref={body} scale={FIGURE}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <capsuleGeometry args={[0.21, 1.0, 4, 12]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
        <mesh position={[0, 1.53, 0]} castShadow>
          <sphereGeometry args={[0.15, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      </group>
      <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 0.98, 28]} />
        <meshBasicMaterial color={color} transparent opacity={alerted ? 0.8 : moving ? 0.5 : 0.34} />
      </mesh>
    </group>
  );
}

function Forklift({
  path,
  head,
  step,
  alerted,
  labels,
}: {
  path: AgentPath;
  head: Playhead;
  step: number;
  alerted: boolean;
  labels: LabelStore;
}) {
  const root = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const { pose, sample } = usePose(path, head, step);

  useFrame((state, dt) => {
    const g = root.current;
    if (!g) return;
    const live = sample(dt);
    g.visible = live;
    if (!live) return;
    const p = pose.current;
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.heading;
    labels.set(path.agent.key, p.x, LABEL_H.vehicle, p.z);
    if (beacon.current) {
      const on = p.speed > 0.2 || alerted;
      beacon.current.scale.setScalar(
        on ? 1 + 0.45 * Math.abs(Math.sin(state.clock.elapsedTime * 5)) : 0.8,
      );
    }
  });

  const body = alerted ? C.high : C.forklift;
  return (
    <group ref={root}>
      <group scale={FIGURE}>
        {[-0.52, 0.52].map((x) =>
          [-0.78, 0.72].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.3, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.3, 0.3, 0.2, 14]} />
              <meshStandardMaterial color={C.forkliftDark} roughness={0.9} />
            </mesh>
          )),
        )}
        <mesh position={[0, 0.65, -0.05]} castShadow>
          <boxGeometry args={[1.12, 0.6, 2.1]} />
          <meshStandardMaterial color={body} roughness={0.7} />
        </mesh>
        <mesh position={[0, 1.2, -0.55]} castShadow>
          <boxGeometry args={[0.95, 0.6, 0.9]} />
          <meshStandardMaterial color={body} roughness={0.7} />
        </mesh>
        {[-0.5, 0.5].map((x) =>
          [-0.95, 0.3].map((z) => (
            <mesh key={`g${x}${z}`} position={[x, 1.6, z]}>
              <boxGeometry args={[0.07, 1.3, 0.07]} />
              <meshStandardMaterial color={C.forkliftDark} roughness={0.8} />
            </mesh>
          )),
        )}
        <mesh position={[0, 2.28, -0.33]} castShadow>
          <boxGeometry args={[1.1, 0.08, 1.35]} />
          <meshStandardMaterial color={C.forkliftDark} roughness={0.8} />
        </mesh>
        {[-0.42, 0.42].map((x) => (
          <mesh key={`m${x}`} position={[x, 1.25, 1.02]} castShadow>
            <boxGeometry args={[0.13, 2.4, 0.13]} />
            <meshStandardMaterial color={C.forkliftDark} roughness={0.8} />
          </mesh>
        ))}
        {[-0.3, 0.3].map((x) => (
          <mesh key={`f${x}`} position={[x, 0.07, 1.6]} castShadow>
            <boxGeometry args={[0.13, 0.07, 1.15]} />
            <meshStandardMaterial color={C.forkliftDark} roughness={0.7} />
          </mesh>
        ))}
        <mesh ref={beacon} position={[0, 2.42, -0.33]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshBasicMaterial color={alerted ? C.high : "#e8a21f"} />
        </mesh>
      </group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.7, 1.95, 32]} />
        <meshBasicMaterial color={alerted ? C.high : C.forklift} transparent opacity={alerted ? 0.75 : 0.4} />
      </mesh>
    </group>
  );
}

/** Every tracked body and vehicle on the floor, plus the route each mover took. */
export default function Agents({
  paths,
  head,
  step,
  alertedKeys,
  labels,
}: {
  paths: AgentPath[];
  head: Playhead;
  step: number;
  alertedKeys: Set<string>;
  labels: LabelStore;
}) {
  const routes = useMemo(() => paths.filter((p) => p.route), [paths]);
  return (
    <group>
      {routes.map((p) => (
        <Line
          key={`r-${p.agent.key}`}
          points={p.route!}
          color={p.agent.kind === "vehicle" ? C.forklift : C.accent}
          lineWidth={1.6}
          transparent
          opacity={0.4}
        />
      ))}
      {paths.map((p) => {
        const common = {
          path: p,
          head,
          step,
          alerted: alertedKeys.has(p.agent.key),
          labels,
        };
        return p.agent.kind === "vehicle" ? (
          <Forklift key={p.agent.key} {...common} />
        ) : (
          <Person key={p.agent.key} {...common} />
        );
      })}
    </group>
  );
}
