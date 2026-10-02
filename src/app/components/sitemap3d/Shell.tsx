"use client";

import { Edges, Grid } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BUILDING,
  CHARGER_BAY,
  CHARGER_BAYS,
  DOCK_DOORS,
  EAST_DOOR,
  HEIGHT,
  OFFICE,
  OFFICE_SPLIT_X,
  RACK_BOTTOM,
  RACK_TOP,
  RACK_W,
  RACK_XS,
  SHIPPING_DOCK,
  WALKWAY,
} from "@/app/lib/floorPlan";
import { at, boxOf, C, m, seeded } from "./shared";

const INTERIOR = boxOf(BUILDING);
const WALL_T = m(5);
const SHELF_LEVELS = [1.1, 2.2, 3.3, 4.2];
/** The top shelf is the rack's roof line, so nothing is stacked on it. */
const PALLET_LEVELS = SHELF_LEVELS.slice(0, 3);

/** The four perimeter walls, with the dock doors cut in as darker panels. */
function Walls() {
  const half = { x: INTERIOR.w / 2, z: INTERIOR.d / 2 };
  const walls: [number, number, number, number][] = [
    // [centre x, centre z, width, depth]
    [0, -half.z, INTERIOR.w + WALL_T, WALL_T],
    [0, half.z, INTERIOR.w + WALL_T, WALL_T],
    [-half.x, 0, WALL_T, INTERIOR.d],
    [half.x, 0, WALL_T, INTERIOR.d],
  ];
  return (
    <group>
      {walls.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, HEIGHT.wall / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[w, HEIGHT.wall, d]} />
          <meshStandardMaterial color={C.wall} roughness={0.95} metalness={0} />
          <Edges color={C.ink} threshold={20} />
        </mesh>
      ))}
      {DOCK_DOORS.map((px) => (
        <mesh key={px} position={at(px, BUILDING.y, HEIGHT.dockDoor / 2)}>
          <boxGeometry args={[m(52), HEIGHT.dockDoor, WALL_T * 1.3]} />
          <meshStandardMaterial color="#cfd3da" roughness={0.9} />
          <Edges color={C.fixture} threshold={20} />
        </mesh>
      ))}
      <mesh position={at(BUILDING.x + BUILDING.w, EAST_DOOR.y + EAST_DOOR.h / 2, 1.45)}>
        <boxGeometry args={[WALL_T * 1.3, 2.9, m(EAST_DOOR.h)]} />
        <meshStandardMaterial color="#cfd3da" roughness={0.9} />
        <Edges color={C.fixture} threshold={20} />
      </mesh>
    </group>
  );
}

/** Pallets on the shelves, batched into one draw call. */
function Pallets() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const slots = useMemo(() => {
    const rand = seeded(20261002);
    const out: [number, number, number, number][] = [];
    const length = RACK_BOTTOM - RACK_TOP;
    for (const rx of RACK_XS) {
      for (const level of PALLET_LEVELS) {
        for (let bay = 0; bay < 7; bay++) {
          if (rand() > 0.62) continue;
          const py = RACK_TOP + ((bay + 0.5) * length) / 7;
          const [x, z] = at(rx + RACK_W / 2, py);
          out.push([x, level + 0.51, z, 0.6 + rand() * 0.25]);
        }
      }
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = new THREE.Object3D();
    slots.forEach(([x, y, z, s], i) => {
      t.position.set(x, y, z);
      t.scale.set(1, s, 1);
      t.updateMatrix();
      mesh.setMatrixAt(i, t.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [slots]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, slots.length]} castShadow>
      <boxGeometry args={[m(26), 0.85, m(30)]} />
      <meshStandardMaterial color={C.pallet} roughness={0.95} />
    </instancedMesh>
  );
}

/** Pallet racking: shelf beams between end uprights, with the rack volume outlined. */
function Racks() {
  const length = m(RACK_BOTTOM - RACK_TOP);
  const width = m(RACK_W);
  return (
    <group>
      {RACK_XS.map((rx) => {
        const [x, z] = at(rx + RACK_W / 2, (RACK_TOP + RACK_BOTTOM) / 2);
        return (
          <group key={rx} position={[x, 0, z]}>
            {SHELF_LEVELS.map((y) => (
              <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
                <boxGeometry args={[width, 0.16, length]} />
                <meshStandardMaterial color={C.shelf} roughness={0.9} />
              </mesh>
            ))}
            {[-length / 2, 0, length / 2].map((dz) => (
              <mesh key={dz} position={[0, HEIGHT.rack / 2, dz]} castShadow>
                <boxGeometry args={[width * 0.92, HEIGHT.rack, 0.22]} />
                <meshStandardMaterial color={C.rackEdge} roughness={0.85} />
              </mesh>
            ))}
            <mesh position={[0, HEIGHT.rack / 2, 0]}>
              <boxGeometry args={[width, HEIGHT.rack, length]} />
              <meshBasicMaterial visible={false} />
              <Edges color={C.rackEdge} threshold={20} />
            </mesh>
          </group>
        );
      })}
      <Pallets />
    </group>
  );
}

/** Office and breakroom: the one part of the floor no camera covers. */
function Office() {
  const b = boxOf(OFFICE);
  const [sx] = at(OFFICE_SPLIT_X, 0);
  return (
    <group>
      <mesh position={[b.x, HEIGHT.office / 2, b.z]} castShadow receiveShadow>
        <boxGeometry args={[b.w, HEIGHT.office, b.d]} />
        <meshStandardMaterial color={C.office} roughness={0.95} />
        <Edges color={C.fixture} threshold={20} />
      </mesh>
      <mesh position={[sx, HEIGHT.office / 2, b.z]}>
        <boxGeometry args={[0.12, HEIGHT.office, b.d]} />
        <meshStandardMaterial color={C.fixture} roughness={0.9} />
      </mesh>
    </group>
  );
}

function ChargerBays() {
  return (
    <group>
      {CHARGER_BAYS.map((px) => {
        const bay = boxOf({ x: px, y: CHARGER_BAY.y, w: CHARGER_BAY.w, h: CHARGER_BAY.h });
        const [cx, , cz] = at(px + CHARGER_BAY.w / 2, CHARGER_BAY.y + CHARGER_BAY.h);
        return (
          <group key={px}>
            <mesh position={[bay.x, 0.02, bay.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[bay.w, bay.d]} />
              <meshBasicMaterial color={C.fixture} transparent opacity={0.07} />
              <Edges color={C.fixture} />
            </mesh>
            <mesh position={[cx, 0.6, cz + 0.4]} castShadow>
              <boxGeometry args={[0.8, 1.2, 0.5]} />
              <meshStandardMaterial color="#cdd1d8" roughness={0.85} />
              <Edges color={C.fixture} threshold={20} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Floor, grid, walkway, and the uncovered shipping dock outline. */
function Ground() {
  const walk = boxOf(WALKWAY);
  const ship = boxOf(SHIPPING_DOCK);
  return (
    <group>
      <mesh position={[0, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[INTERIOR.w * 1.8, INTERIOR.d * 2.1]} />
        <meshStandardMaterial color={C.apron} roughness={1} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[INTERIOR.w, INTERIOR.d]} />
        <meshStandardMaterial color={C.floor} roughness={1} />
      </mesh>
      <Grid
        position={[0, 0.008, 0]}
        args={[INTERIOR.w, INTERIOR.d]}
        cellSize={2.5}
        cellThickness={0.5}
        cellColor={C.grid}
        sectionSize={10}
        sectionThickness={0.8}
        sectionColor={C.gridMajor}
        fadeDistance={260}
        fadeStrength={0.6}
        infiniteGrid={false}
      />
      <mesh position={[walk.x, 0.014, walk.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[walk.w, walk.d]} />
        <meshBasicMaterial color="#3f8a4f" transparent opacity={0.1} />
      </mesh>
      <mesh position={[ship.x, 0.012, ship.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ship.w, ship.d]} />
        <meshBasicMaterial color={C.ink} transparent opacity={0.025} />
        <Edges color={C.fixture} />
      </mesh>
    </group>
  );
}

/** Everything that never moves. Rendered once and reused across every frame. */
export default function Shell() {
  return (
    <group>
      <Ground />
      <Walls />
      <Racks />
      <Office />
      <ChargerBays />
    </group>
  );
}
