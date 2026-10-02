"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { IncidentView } from "@/app/lib/incidentView";
import { useCommand } from "@/app/lib/ui/commandStore";
import IncidentViewer from "./IncidentViewer";

type Load = { id: string; view?: IncidentView; error?: string };

export default function IncidentDrawer() {
  const { openIncidentId, openIncident, selectZone } = useCommand();
  const [load, setLoad] = useState<Load | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openIncidentId) return;
    let cancelled = false;
    fetch(`/api/incidents/${encodeURIComponent(openIncidentId)}/view`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (IncidentView & { error?: string }) | null;
        if (cancelled) return;
        if (!r.ok || !body) setLoad({ id: openIncidentId, error: body?.error ?? `Request failed (${r.status})` });
        else setLoad({ id: openIncidentId, view: body });
      })
      .catch(() => {
        if (!cancelled) setLoad({ id: openIncidentId, error: "Network error loading the incident" });
      });
    return () => {
      cancelled = true;
    };
  }, [openIncidentId]);

  useEffect(() => {
    if (!openIncidentId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openIncident(null);
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [openIncidentId, openIncident]);

  if (!openIncidentId) return null;
  const current = load?.id === openIncidentId ? load : null;
  const view = current?.view;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Incident review">
      <button
        type="button"
        aria-label="Close incident"
        onClick={() => openIncident(null)}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="drawer-in relative flex h-full w-full max-w-[1100px] flex-col border-l border-white/10 bg-[#09090f] shadow-2xl outline-none sm:w-[92vw]"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Incident review</span>
          <span className="font-mono text-[11px] text-slate-600">{openIncidentId}</span>
          {view && !view.live && (
            <button
              type="button"
              onClick={() => selectZone(view.camera.zoneId)}
              className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:border-white/30 hover:text-white"
            >
              Show {view.camera.zone} on map
            </button>
          )}
          <Link
            href={`/incident/${openIncidentId}`}
            className="ml-auto text-[11px] text-slate-500 hover:text-slate-300"
          >
            Open full page ↗
          </Link>
          <button
            type="button"
            onClick={() => openIncident(null)}
            className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:border-white/30"
          >
            Close <kbd className="ml-1 text-slate-500">Esc</kbd>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!current && (
            <div className="flex animate-pulse flex-col gap-3" aria-label="Loading incident">
              <div className="h-6 w-72 rounded bg-white/5" />
              <div className="h-4 w-48 rounded bg-white/5" />
              <div className="aspect-video w-full max-w-3xl rounded-xl bg-white/5" />
              <div className="h-12 w-full max-w-3xl rounded bg-white/5" />
            </div>
          )}
          {current?.error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              Could not load this incident: {current.error}
            </div>
          )}
          {view && (
            <IncidentViewer key={view.incident.id} {...view} variant="drawer" onSelectIncident={openIncident} />
          )}
        </div>
      </div>
    </div>
  );
}
