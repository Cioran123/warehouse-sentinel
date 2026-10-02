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

interface Props {
  statuses: CameraStatus[];
  /** Non-rejected incidents. */
  incidents: Incident[];
  zones: ZoneCount[];
  evalSummary: EvalSummary | null;
  initialZoneId: string | null;
  initialIncidentId: string | null;
  initialQuery: string | null;
}

type MobilePanel = "cameras" | "chat";

const MOBILE_PANELS: [MobilePanel, string][] = [
  ["cameras", "Cameras"],
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
  statuses,
  incidents,
  zones,
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
        <div className="flex gap-1 border-b border-line bg-surface p-2 lg:hidden" role="tablist">
          {MOBILE_PANELS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={panel === id}
              onClick={() => setPanel(id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium ${panel === id ? "bg-sunken text-ink" : "text-ink-3"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:grid-rows-[minmax(0,1fr)_auto]">
          <section className={`${show("cameras")} min-w-0 flex-col gap-5 overflow-y-auto p-6 lg:col-start-1 lg:row-start-1 lg:flex`}>
            <CameraWall statuses={statuses} />
            <details className="group rounded-xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-[13px] transition-colors hover:bg-sunken">
                <span>
                  <span className="font-medium text-ink">Evaluation against ground truth</span>
                  <span className="ml-2 text-[12px] text-ink-3">
                    {statuses.length} cameras · {withFootage} with footage
                    {evalSummary?.metrics.detected_rate !== undefined
                      ? ` · ${Math.round(evalSummary.metrics.detected_rate * 100)}% scenarios surfaced`
                      : ""}
                  </span>
                </span>
                <span className="text-ink-3 transition-transform duration-200 group-open:rotate-90">›</span>
              </summary>
              <div className="border-t border-line [&>section]:border-0 [&>section]:bg-transparent">
                <EvalPanel summary={evalSummary} />
              </div>
            </details>
          </section>

          <aside className={`${show("chat")} min-h-[70vh] flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:min-h-0 lg:border-l lg:border-line`}>
            <ChatPanel zones={zones} initialQuery={initialQuery} />
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <IncidentFeed />
          </div>
        </div>
      </div>
      <IncidentDrawer />
    </CommandProvider>
  );
}
