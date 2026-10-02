"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { IncidentView } from "@/app/lib/incidentView";
import { useCommand } from "@/app/lib/ui/commandStore";
import IncidentViewer from "./IncidentViewer";

type Load = { id: string; view?: IncidentView; error?: string };

export default function IncidentDrawer() {
  const { openIncidentId, openIncident, selectZone } = useCommand();
  const onSiteMap = usePathname().startsWith("/site-map");
  const router = useRouter();
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
        className="absolute inset-0 cursor-default bg-ink/25"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="drawer-in relative flex h-full w-full max-w-[1100px] flex-col border-l border-line bg-canvas shadow-2xl outline-none sm:w-[92vw]"
      >
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
          <span className="text-[13px] font-semibold text-ink">Review</span>
          <span className="font-mono text-[11px] text-ink-3">{openIncidentId}</span>
          {view && !view.live && (
            <button
              type="button"
              onClick={() => {
                if (onSiteMap) {
                  selectZone(view.camera.zoneId);
                  openIncident(null);
                } else {
                  router.push(`/site-map?zone=${encodeURIComponent(view.camera.zoneId)}`);
                }
              }}
              className="rounded-md px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              Show {view.camera.zone} on site map
            </button>
          )}
          <Link
            href={`/incident/${openIncidentId}`}
            className="ml-auto rounded-md px-2 py-1 text-[12px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            Open full page ↗
          </Link>
          <button
            type="button"
            onClick={() => openIncident(null)}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            Close <kbd className="rounded border border-line bg-sunken px-1 font-sans text-[10px] text-ink-3">Esc</kbd>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!current && (
            <div className="flex animate-pulse flex-col gap-3" aria-label="Loading incident">
              <div className="h-6 w-72 rounded bg-hover" />
              <div className="h-4 w-48 rounded bg-hover" />
              <div className="aspect-video w-full max-w-3xl rounded-xl bg-hover" />
              <div className="h-12 w-full max-w-3xl rounded bg-hover" />
            </div>
          )}
          {current?.error && (
            <div className="rounded-lg border border-high-line bg-high-soft px-4 py-3 text-[13px] text-high">
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
