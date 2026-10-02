"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import type { ZoneCount } from "@/app/lib/search";
import { EVENT_LABEL, type Incident } from "@/app/lib/types";
import { CommandProvider, useCommand } from "@/app/lib/ui/commandStore";
import CameraTile from "./CameraTile";
import IncidentCard from "./IncidentCard";
import IncidentDrawer from "./IncidentDrawer";
import VenueMap from "./VenueMap";

/** WebGL only, and it pulls in three.js, so it stays out of the server bundle. */
const SiteMap3D = dynamic(() => import("./SiteMap3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(360px,calc(100vh-20rem),720px)] items-center justify-center rounded-xl border border-line bg-sunken">
      <p className="text-[13px] text-ink-3">Loading the floor…</p>
    </div>
  ),
});

type View = "3d" | "plan";

interface Props {
  venueName: string;
  statuses: CameraStatus[];
  /** Non-rejected incidents. */
  incidents: Incident[];
  zones: ZoneCount[];
  rejectedCount: number;
  initialZoneId: string | null;
  initialIncidentId: string | null;
}

const MAP_MAX_WIDTH = "calc((100vh - 14rem) * 1000 / 640)";

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12px] text-ink-3">
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-[3px] border border-high-line bg-high-soft" />
        Has incidents
      </li>
      <li className="flex items-center gap-2">
        <span className="relative flex h-3 w-3 items-center justify-center rounded-full border-2 border-ink">
          <span className="h-1 w-1 rounded-full bg-ink" />
        </span>
        Camera and its view
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-[3px] border-2 border-dashed border-accent" />
        Mentioned by the assistant
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-[3px] border-y-2 border-dashed border-[#c99a12]" />
        Robot lane, no foot traffic
      </li>
    </ul>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex items-center rounded-md border border-line bg-surface">
      {(
        [
          ["3d", "3D"],
          ["plan", "Plan"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          className={`px-2.5 py-1 text-[12px] transition-colors first:rounded-l-md last:rounded-r-md ${
            view === value ? "bg-accent-soft font-medium text-accent" : "text-ink-3 hover:bg-hover"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ZoneList({ zones, statuses }: { zones: ZoneCount[]; statuses: CameraStatus[] }) {
  const { selectedZoneId, toggleZone, highlightZoneIds } = useCommand();
  const cameraOf = new Map(statuses.map((s, i) => [s.camera.zoneId, { status: s, key: i + 1 }]));
  return (
    <ul className="-mx-2 flex flex-col">
      {zones.map((z) => {
        const selected = selectedZoneId === z.zoneId;
        const highlighted = highlightZoneIds.includes(z.zoneId);
        const cam = cameraOf.get(z.zoneId);
        return (
          <li key={z.zoneId}>
            <button
              type="button"
              onClick={() => toggleZone(z.zoneId)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                selected ? "bg-accent-soft" : highlighted ? "bg-sunken" : "hover:bg-sunken"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] font-medium ${selected ? "text-accent" : "text-ink"}`}>{z.zone}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {z.eventTypes.length ? z.eventTypes.map((t) => EVENT_LABEL[t]).join(", ") : "Quiet"}
                </span>
              </span>
              <span
                className={`flex-shrink-0 text-[13px] tabular-nums ${z.total ? "font-medium text-high" : "text-ink-3"}`}
                aria-label={`${z.total} incidents`}
              >
                {z.total}
              </span>
              {cam && (
                <kbd className="hidden h-5 min-w-5 flex-shrink-0 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-[11px] text-ink-3 lg:flex">
                  {cam.key}
                </kbd>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ZoneDetail({ status, incidents }: { status: CameraStatus; incidents: Incident[] }) {
  const { activeByCamera, reportTime, selectZone } = useCommand();
  const { camera } = status;
  const own = incidents.filter((i) => i.cameraId === camera.id).sort((a, b) => a.startSec - b.startSec);
  return (
    <div className="drawer-in flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{camera.zone}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{camera.scenario.replace(/^PLACEHOLDER:\s*/, "")}</p>
        </div>
        <button
          type="button"
          onClick={() => selectZone(null)}
          aria-label="Close zone"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          ✕
        </button>
      </div>
      <CameraTile key={camera.id} status={status} showOverlay active={activeByCamera[camera.id] ?? []} onTime={reportTime} />
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-ink">
          Incidents <span className="ml-1 font-normal tabular-nums text-ink-3">{own.length}</span>
        </h3>
        {own.length ? (
          own.map((i) => <IncidentCard key={i.id} incident={i} compact />)
        ) : (
          <p className="text-[12px] text-ink-3">Nothing flagged in this zone.</p>
        )}
      </section>
      <Link
        href={`/overview?q=${encodeURIComponent(`What happened at ${camera.zone}?`)}`}
        className="self-start text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
      >
        Ask the assistant about {camera.zone} →
      </Link>
    </div>
  );
}

function Inspector({ zones, statuses, incidents, rejectedCount }: Pick<Props, "zones" | "statuses" | "incidents" | "rejectedCount">) {
  const { selectedZoneId } = useCommand();
  const selected = statuses.find((s) => s.camera.zoneId === selectedZoneId);
  const total = zones.reduce((n, z) => n + z.total, 0);
  return (
    <div className="flex flex-col gap-5 p-5">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Zones</h2>
          <span className="text-[12px] text-ink-3">
            {total} open{rejectedCount ? `, ${rejectedCount} rejected hidden` : ""}
          </span>
        </div>
        <ZoneList zones={zones} statuses={statuses} />
      </section>
      <div className="h-px bg-line" />
      {selected ? (
        <ZoneDetail key={selected.camera.id} status={selected} incidents={incidents} />
      ) : (
        <p className="text-[13px] leading-relaxed text-ink-3">
          Select a zone to watch its camera and review what it flagged.
        </p>
      )}
    </div>
  );
}

export default function SiteMapView({ venueName, statuses, incidents, zones, rejectedCount, initialZoneId, initialIncidentId }: Props) {
  const [view, setView] = useState<View>("3d");
  const width = view === "3d" ? undefined : MAP_MAX_WIDTH;
  return (
    <CommandProvider incidents={incidents} initialZoneId={initialZoneId} initialIncidentId={initialIncidentId}>
      <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        <section className="flex min-w-0 flex-col gap-4 p-6 lg:min-h-0 lg:overflow-y-auto">
          <header className="mx-auto flex w-full items-end justify-between gap-4" style={{ maxWidth: width }}>
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold tracking-tight text-ink">{venueName.replace(/\s*\(.*\)$/, "")} floor</h1>
              <p className="mt-1 text-[13px] text-ink-3">
                {view === "3d"
                  ? "Everyone each camera is tracking, placed on the floor it watches."
                  : "Each camera, what it can see, and what it flagged."}
              </p>
            </div>
            <ViewToggle view={view} onChange={setView} />
          </header>
          <div className="mx-auto w-full" style={{ maxWidth: width }}>
            {view === "3d" ? (
              <SiteMap3D zones={zones} statuses={statuses} />
            ) : (
              <VenueMap zones={zones} statuses={statuses} />
            )}
          </div>
          <div className="mx-auto w-full" style={{ maxWidth: width }}>
            {view === "3d" ? (
              <p className="text-[12px] leading-relaxed text-ink-3">
                Drag to orbit, scroll to zoom, click a zone to fly to it. Positions come from each
                camera&rsquo;s tracked boxes, projected onto the floor through that camera&rsquo;s
                calibrated ground plane &mdash; nothing here is simulated.
              </p>
            ) : (
              <Legend />
            )}
          </div>
        </section>
        <aside className="min-w-0 border-t border-line bg-surface lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <Inspector zones={zones} statuses={statuses} incidents={incidents} rejectedCount={rejectedCount} />
        </aside>
      </div>
      <IncidentDrawer />
    </CommandProvider>
  );
}
