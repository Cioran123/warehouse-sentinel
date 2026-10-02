"use client";

import { Edges } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import { CAMERA_PINS, CONE_HALF_DEG, CONE_LEN, HEIGHT, LANE, ZONES } from "@/app/lib/floorPlan";
import type { FloorIncident } from "@/app/lib/floorTracks";
import type { ZoneCount } from "@/app/lib/search";
import { at, boxOf, C, fovFootprint, fovVolume, m, radOf } from "./shared";

/** How high an incident marker stands, clear of the agent labels below it. */
export const PIN_H = 7.6;

/** Zone footprints: the clickable, incident-shaded floor patches each camera is responsible for. */
export function ZoneFloors({
  zones,
  selectedZoneId,
  highlightZoneIds,
  alertedZoneIds,
  onToggle,
}: {
  zones: ZoneCount[];
  selectedZoneId: string | null;
  highlightZoneIds: string[];
  alertedZoneIds: Set<string>;
  onToggle: (zoneId: string) => void;
}) {
  const max = Math.max(1, ...zones.map((z) => z.total));
  return (
    <group>
      {zones.map((z) => {
        const rect = ZONES[z.zoneId];
        if (!rect) return null;
        const b = boxOf(rect);
        const selected = selectedZoneId === z.zoneId;
        const alerted = alertedZoneIds.has(z.zoneId);
        const highlighted = highlightZoneIds.includes(z.zoneId);
        const dimmed = !!selectedZoneId && !selected;
        // Zones rest in neutral grey however many incidents they hold; red means right now.
        const opacity = alerted ? 0.17 : z.total ? 0.022 + 0.014 * (z.total / max) : 0.012;
        const stroke = alerted
          ? C.high
          : selected || highlighted
            ? C.accent
            : C.fixture;
        return (
          <mesh
            key={z.zoneId}
            position={[b.x, 0.02, b.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(z.zoneId);
            }}
            onPointerOver={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          >
            <planeGeometry args={[b.w, b.d]} />
            <meshBasicMaterial
              color={alerted ? C.high : C.ink}
              transparent
              opacity={dimmed ? opacity * 0.5 : opacity}
            />
            <Edges color={stroke} linewidth={selected || alerted ? 2 : 1} />
          </mesh>
        );
      })}
    </group>
  );
}

/** The forklift-only lane down Aisle A, which restricted-entry alerts are measured against. */
export function RestrictedLane({ alerted }: { alerted: boolean }) {
  const strip = boxOf({
    x: LANE.left,
    y: LANE.top,
    w: LANE.right - LANE.left,
    h: LANE.bottom - LANE.top,
  });
  const color = alerted ? C.high : C.lane;
  return (
    <group>
      <mesh position={[strip.x, 0.018, strip.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[strip.w, strip.d]} />
        <meshBasicMaterial color={color} transparent opacity={alerted ? 0.22 : 0.1} />
      </mesh>
      {[LANE.left, LANE.right].map((px) => {
        const [x, , z] = at(px, (LANE.top + LANE.bottom) / 2);
        return (
          <mesh key={px} position={[x, 0.03, z]}>
            <boxGeometry args={[0.18, 0.02, strip.d]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A camera on its mount, with the floor it covers shaded in. */
function CameraMount({
  status,
  alerted,
  onPick,
}: {
  status: CameraStatus;
  alerted: boolean;
  onPick: () => void;
}) {
  const pin = CAMERA_PINS[status.camera.zoneId];
  const geoms = useMemo(() => {
    if (!pin) return null;
    const r = m(CONE_LEN);
    return {
      floor: fovFootprint(r, pin.dir, CONE_HALF_DEG),
      volume: fovVolume(r, pin.dir, CONE_HALF_DEG, HEIGHT.cameraMount),
    };
  }, [pin]);
  if (!pin || !geoms) return null;

  const [x, , z] = at(pin.x, pin.y);
  const color = alerted ? C.high : C.ink;
  const facing = Math.atan2(Math.cos(radOf(pin.dir)), Math.sin(radOf(pin.dir)));

  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geoms.floor} position={[0, 0.04, 0]}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={alerted ? 0.15 : 0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={geoms.volume}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={alerted ? 0.07 : 0.022}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, HEIGHT.cameraMount / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.07, HEIGHT.cameraMount, 10]} />
        <meshStandardMaterial color={C.fixture} roughness={0.8} />
      </mesh>
      <group
        position={[0, HEIGHT.cameraMount, 0]}
        rotation={[0, facing, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <mesh position={[0, 0.16, 0.24]} castShadow>
          <boxGeometry args={[0.44, 0.34, 0.74]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.16, 0.64]}>
          <cylinderGeometry args={[0.13, 0.13, 0.12, 14]} />
          <meshStandardMaterial color="#1b1f28" roughness={0.3} metalness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

export function CameraMounts({
  statuses,
  alertedCameraIds,
  onPick,
}: {
  statuses: CameraStatus[];
  alertedCameraIds: Set<string>;
  onPick: (status: CameraStatus) => void;
}) {
  return (
    <group>
      {statuses.map((s) => (
        <CameraMount
          key={s.camera.id}
          status={s}
          alerted={alertedCameraIds.has(s.camera.id)}
          onPick={() => onPick(s)}
        />
      ))}
    </group>
  );
}

/** The stems that stand where an incident happened; their heads are DOM labels. */
export function IncidentPins({
  incidents,
  positions,
  activeIds,
}: {
  incidents: FloorIncident[];
  positions: Record<string, [number, number, number]>;
  activeIds: string[];
}) {
  return (
    <group>
      {incidents.map((inc) => {
        const pos = positions[inc.id];
        if (!pos) return null;
        const active = activeIds.includes(inc.id);
        return (
          <mesh key={inc.id} position={[pos[0], PIN_H / 2, pos[2]]}>
            <cylinderGeometry args={[0.04, 0.04, PIN_H, 8]} />
            <meshBasicMaterial
              color={active ? C.high : "#bf7781"}
              transparent
              opacity={active ? 0.85 : 0.45}
            />
          </mesh>
        );
      })}
    </group>
  );
}
