"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, type ReactNode } from "react";
import * as THREE from "three";

/**
 * Floating labels for the 3D floor.
 *
 * Rather than mounting a React root per label inside the scene, every label is one plain DOM
 * node in a layer over the canvas, and the frame loop projects its world anchor to screen
 * coordinates. That keeps label typography identical to the rest of the app and keeps the
 * per-frame work down to a matrix multiply and a transform write.
 */
export class LabelStore {
  private anchors = new Map<string, THREE.Vector3>();
  private nodes = new Map<string, HTMLElement>();

  /** Moves a label's anchor. Safe to call every frame. */
  set(id: string, x: number, y: number, z: number): void {
    const v = this.anchors.get(id);
    if (v) v.set(x, y, z);
    else this.anchors.set(id, new THREE.Vector3(x, y, z));
  }

  attach(id: string, el: HTMLElement | null): void {
    if (el) this.nodes.set(id, el);
    else this.nodes.delete(id);
  }

  each(fn: (el: HTMLElement, anchor: THREE.Vector3) => void): void {
    for (const [id, el] of this.nodes) {
      const anchor = this.anchors.get(id);
      if (anchor) fn(el, anchor);
    }
  }
}

export interface Label {
  id: string;
  /** Fixed anchor in world metres. Omit for labels the frame loop positions instead. */
  anchor?: [number, number, number];
  node: ReactNode;
  /** Labels that can be clicked opt back into pointer events. */
  interactive?: boolean;
}

/** Lives inside the canvas: projects every anchor and writes the screen transform. */
export function LabelProjector({ store }: { store: LabelStore }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    store.each((el, anchor) => {
      v.copy(anchor).project(camera);
      if (v.z > 1) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "visible";
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    });
    // Priority stays at 0: anything above it hands the render loop over to the caller.
  });

  return null;
}

/** Lives over the canvas: the DOM nodes the projector moves. */
export function LabelLayer({ store, labels }: { store: LabelStore; labels: Label[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {labels.map((label) => {
        if (label.anchor) store.set(label.id, ...label.anchor);
        return (
          <div
            key={label.id}
            ref={(el) => store.attach(label.id, el)}
            className={`absolute left-0 top-0 ${label.interactive ? "pointer-events-auto" : ""}`}
            style={{ visibility: "hidden" }}
          >
            {label.node}
          </div>
        );
      })}
    </div>
  );
}
