"use client";

import { useCallback, useEffect, useState } from "react";
import type { CameraStatus } from "@/app/lib/cameraStatus";
import type { ZoneCount } from "@/app/lib/search";
import type { EvalSummary, Incident } from "@/app/lib/types";
import { CommandProvider, useCommand } from "@/app/lib/ui/commandStore";
import CameraWall from "./CameraWall";
import ChatPanel from "./ChatPanel";
import EvalPanel from "./EvalPanel";
import IncidentDrawer from "./IncidentDrawer";
import IncidentFeed from "./IncidentFeed";
import VenuePanel from "./VenuePanel";

interface Props {
  venueName: string;
  statuses: CameraStatus[];
  /** Non-rejected incidents. */
  incidents: Incident[];
  zones: ZoneCount[];
  rejectedCount: number;
  evalSummary: EvalSummary | null;
  initialZoneId: string | null;
  initialIncidentId: string | null;
  initialQuery: string | null;
}

type MobilePanel = "map" | "cameras" | "chat";

const MOBILE_PANELS: [MobilePanel, string][] = [
  ["cameras", "Cameras"],
  ["map", "Floor plan"],
  ["chat", "Assistant"],
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** `/` focuses the chat, 1-9 focus the nth camera's zone. Esc is handled by the drawer. */
function Shortcuts({ statuses, onChat }: { statuses: CameraStatus[]; onChat: () => void }) {
  const { chatInputRef, toggleZone, openIncidentId } = useCommand();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || openIncidentId) return;
      if (e.key === "/") {
        e.preventDefault();
        onChat();
        requestAnimationFrame(() => chatInputRef.current?.focus());
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= statuses.length) toggleZone(statuses[n - 1].camera.zoneId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [statuses, toggleZone, chatInputRef, openIncidentId, onChat]);
  return null;
}

export default function CommandCenter({
  venueName,
  statuses,
  incidents,
  zones,
  rejectedCount,
  evalSummary,
  initialZoneId,
  initialIncidentId,
  initialQuery,
}: Props) {
  const [panel, setPanel] = useState<MobilePanel>(initialQuery ? "chat" : "cameras");
  const showChat = useCallback(() => setPanel("chat"), []);
  const show = (p: MobilePanel) => (panel === p ? "flex" : "hidden");
  const withFootage = statuses.filter((s) => s.indexStatus !== "missing_video").length;

  return (
    <CommandProvider incidents={incidents} initialZoneId={initialZoneId} initialIncidentId={initialIncidentId}>
      <Shortcuts statuses={statuses} onChat={showChat} />
      <div className="flex flex-col lg:h-full lg:min-h-0">
        <div className="flex gap-1 border-b border-white/[0.08] p-2 lg:hidden" role="tablist">
          {MOBILE_PANELS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={panel === id}
              onClick={() => setPanel(id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm ${panel === id ? "bg-white/10 text-white" : "text-slate-400"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(320px,5fr)_minmax(0,7fr)_minmax(320px,380px)] lg:grid-rows-[minmax(0,1fr)_auto]">
          <aside className={`${show("map")} flex-col gap-3 overflow-y-auto p-4 lg:col-start-1 lg:row-start-1 lg:flex lg:border-r lg:border-white/[0.08]`}>
            <VenuePanel
              venueName={venueName}
              zones={zones}
              statuses={statuses}
              rejectedCount={rejectedCount}
            />
          </aside>

          <section className={`${show("cameras")} min-w-0 flex-col gap-4 overflow-y-auto p-4 lg:col-start-2 lg:row-start-1 lg:flex`}>
            <CameraWall statuses={statuses} />
            <details className="group rounded-xl border border-white/10 bg-[#0c0c12]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-slate-300">
                <span>
                  <span className="font-semibold text-white">Evaluation vs. ground truth</span>
                  <span className="ml-2 text-[11px] text-slate-500">
                    {statuses.length} cameras · {withFootage} with footage
                    {evalSummary?.metrics.detected_rate !== undefined
                      ? ` · ${Math.round(evalSummary.metrics.detected_rate * 100)}% scenarios surfaced`
                      : ""}
                  </span>
                </span>
                <span className="text-slate-500 transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="border-t border-white/10 [&>section]:border-0 [&>section]:bg-transparent">
                <EvalPanel summary={evalSummary} />
              </div>
            </details>
          </section>

          <aside className={`${show("chat")} min-h-[70vh] flex-col lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:flex lg:min-h-0 lg:border-l lg:border-white/[0.08]`}>
            <ChatPanel zones={zones} initialQuery={initialQuery} />
          </aside>

          <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <IncidentFeed />
          </div>
        </div>
      </div>
      <IncidentDrawer />
    </CommandProvider>
  );
}
