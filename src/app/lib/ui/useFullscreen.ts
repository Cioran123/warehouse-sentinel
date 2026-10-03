"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const current = () => document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null;

/**
 * Full-screen state for one element (or the whole page when no ref is given), using the
 * standard Fullscreen API with Safari's webkit-prefixed fallback.
 */
export function useFullscreen(ref?: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => {
      const el = current();
      setActive(ref ? !!el && el === ref.current : !!el);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [ref]);

  const toggle = useCallback(async () => {
    try {
      const el = current();
      // A tile can go full screen straight from a full-screen page; only leave when it is ours.
      if (el && (!ref || el === ref.current)) {
        const doc = document as FsDocument;
        await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
        return;
      }
      await enter(ref ? ref.current : document.documentElement);
    } catch {
      // the browser refused (no user gesture, or full screen disabled); nothing to undo
    }
  }, [ref]);

  return { active, toggle };
}

async function enter(el: HTMLElement | null): Promise<void> {
  if (!el) return;
  const target = el as FsElement;
  await (target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.());
}
