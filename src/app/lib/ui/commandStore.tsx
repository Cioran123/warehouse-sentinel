"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Incident } from "@/app/lib/types";

export interface FeedItem {
  incident: Incident;
  /** Wall-clock time the incident popped into the feed. */
  seenAt: number;
}

interface CommandState {
  selectedZoneId: string | null;
  selectZone: (zoneId: string | null) => void;
  toggleZone: (zoneId: string) => void;
  /** Zones the latest chat answer refers to. */
  highlightZoneIds: string[];
  setHighlightZoneIds: (ids: string[]) => void;
  openIncidentId: string | null;
  openIncident: (id: string | null) => void;
  /** Incidents whose span contains each camera's current playback time, highest priority first. */
  activeByCamera: Record<string, Incident[]>;
  reportTime: (cameraId: string, t: number) => void;
  feed: FeedItem[];
  dismissFeed: (id: string) => void;
  resetFeed: () => void;
  chatInputRef: RefObject<HTMLInputElement | null>;
}

const CommandContext = createContext<CommandState | null>(null);

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

function syncUrl(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}

interface ProviderProps {
  /** Non-rejected incidents; they pop into the feed as each camera's playback reaches them. */
  incidents: Incident[];
  initialZoneId?: string | null;
  initialIncidentId?: string | null;
  children: ReactNode;
}

export function CommandProvider({ incidents, initialZoneId = null, initialIncidentId = null, children }: ProviderProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(initialZoneId);
  const [highlightZoneIds, setHighlightZoneIds] = useState<string[]>([]);
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(initialIncidentId);
  const [activeByCamera, setActiveByCamera] = useState<Record<string, Incident[]>>({});
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const seen = useRef(new Set<string>());
  const dismissed = useRef(new Set<string>());
  const activeKey = useRef<Record<string, string>>({});
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const selectZone = useCallback((zoneId: string | null) => {
    setSelectedZoneId(zoneId);
    syncUrl("zone", zoneId);
  }, []);

  const toggleZone = useCallback((zoneId: string) => {
    setSelectedZoneId((cur) => {
      const next = cur === zoneId ? null : zoneId;
      syncUrl("zone", next);
      return next;
    });
  }, []);

  const openIncident = useCallback((id: string | null) => {
    setOpenIncidentId(id);
    syncUrl("incident", id);
  }, []);

  const reportTime = useCallback(
    (cameraId: string, t: number) => {
      const own = incidents.filter((i) => i.cameraId === cameraId);
      const fresh = own.filter((i) => t >= i.startSec && !seen.current.has(i.id) && !dismissed.current.has(i.id));
      if (fresh.length) {
        fresh.forEach((i) => seen.current.add(i.id));
        const at = Date.now();
        setFeed((f) => [...fresh.map((incident) => ({ incident, seenAt: at })), ...f]);
      }
      const now = own
        .filter((i) => t >= i.startSec && t <= i.endSec + 0.5 && !dismissed.current.has(i.id))
        .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
      const key = now.map((i) => i.id).join(",");
      if (activeKey.current[cameraId] !== key) {
        activeKey.current[cameraId] = key;
        setActiveByCamera((a) => ({ ...a, [cameraId]: now }));
      }
    },
    [incidents],
  );

  const dismissFeed = useCallback((id: string) => {
    dismissed.current.add(id);
    setFeed((f) => f.filter((x) => x.incident.id !== id));
  }, []);

  const resetFeed = useCallback(() => {
    seen.current.clear();
    dismissed.current.clear();
    setFeed([]);
  }, []);

  const value = useMemo<CommandState>(
    () => ({
      selectedZoneId,
      selectZone,
      toggleZone,
      highlightZoneIds,
      setHighlightZoneIds,
      openIncidentId,
      openIncident,
      activeByCamera,
      reportTime,
      feed,
      dismissFeed,
      resetFeed,
      chatInputRef,
    }),
    [selectedZoneId, selectZone, toggleZone, highlightZoneIds, openIncidentId, openIncident, activeByCamera, reportTime, feed, dismissFeed, resetFeed],
  );

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommand(): CommandState {
  const ctx = useContext(CommandContext);
  if (!ctx) throw new Error("useCommand must be used inside <CommandProvider>");
  return ctx;
}

/** Null outside the command center, so shared components can fall back to page links. */
export function useOptionalCommand(): CommandState | null {
  return useContext(CommandContext);
}
