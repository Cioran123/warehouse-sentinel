"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { TABS } from "@/app/tab-config";

/** Arrow keys belong to whatever has focus when it is a field, slider, media element, or open dialog. */
function arrowsTaken(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"].includes(el.tagName) || el.isContentEditable) return true;
  if (el.closest('[role="slider"], [role="dialog"], [role="listbox"], [role="menu"]')) return true;
  return !!document.querySelector('[aria-modal="true"]');
}

export interface StatusChip {
  label: string;
  value: string;
}

export default function TabShell({ venueName, chips = [] }: { venueName: string; chips?: StatusChip[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeIndex = TABS.findIndex((t) => pathname === t.path || pathname.startsWith(`${t.path}/`));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || arrowsTaken(e.target)) return;
      e.preventDefault();
      const from = activeIndex < 0 ? 0 : activeIndex;
      const next = (from + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
      router.push(TABS[next].path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, router]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-line bg-surface px-5">
      <Link href="/overview" className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-surface" aria-hidden>
          WS
        </span>
        <span className="text-[14px] font-semibold tracking-tight text-ink">Warehouse Sentinel</span>
        <span className="text-[13px] text-ink-3">{venueName}</span>
      </Link>
      <nav className="flex h-full items-stretch gap-1" aria-label="Workspace tabs (← → to switch)" title="Use ← and → to switch tabs">
        {TABS.map((tab) => {
          const active = pathname === tab.path || pathname.startsWith(`${tab.path}/`);
          return (
            <Link
              key={tab.path}
              href={tab.path}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center px-2.5 text-[13px] font-medium transition-colors ${
                active ? "text-ink" : "text-ink-3 hover:text-ink"
              }`}
            >
              {tab.label}
              {active && <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-ink" />}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        {chips.length > 0 && (
          <dl className="hidden items-center gap-4 text-[12px] md:flex">
            {chips.map((c) => (
              <div key={c.label} className="flex items-baseline gap-1.5">
                <dt className="text-ink-3">{c.label}</dt>
                <dd className="font-medium tabular-nums text-ink-2">{c.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <span className="group relative">
          <button
            type="button"
            aria-label="About these results"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-semibold text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            ?
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute right-0 top-9 z-50 w-72 rounded-lg border border-line bg-surface p-3 text-[12px] leading-relaxed text-ink-2 opacity-0 shadow-lg shadow-ink/5 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            Warehouse Sentinel prioritizes safety footage for human review. It is not an emergency
            detector, does not identify people, and is not for judging individual workers. All footage
            shown is synthetic.
          </span>
        </span>
      </div>
    </header>
  );
}
