"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { PLAN_H, PLAN_W } from "@/app/lib/floorPlan";
import { paintHeat, type HeatMap } from "@/app/lib/incidentHeat";
import { boxOf } from "./shared";

/** The incident heat map, laid on the floor just above the zone shading. */
export default function HeatLayer({ heat }: { heat: HeatMap }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    paintHeat(heat, canvas);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    return t;
  }, [heat]);
  useEffect(() => () => texture.dispose(), [texture]);

  // The grid covers the whole plan, so plan (0, 0) lands on the texture's north-west corner.
  const full = boxOf({ x: 0, y: 0, w: PLAN_W, h: PLAN_H });
  return (
    <mesh position={[full.x, 0.05, full.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[full.w, full.d]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
