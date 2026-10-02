"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS } from "@/app/tab-config";

export interface StatusChip {
  label: string;
  value: string;
  color?: string;
}

export default function TabShell({ venueName, chips = [] }: { venueName: string; chips?: StatusChip[] }) {
  const pathname = usePathname();

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-white/10 bg-[#0c0c12] px-4 py-2.5">
      <Link href="/overview" className="flex items-baseline gap-2">
        <span className="text-sm font-bold tracking-[0.2em] text-white">WAREHOUSE SENTINEL</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{venueName}</span>
      </Link>
      <nav className="flex gap-1 rounded-lg bg-white/[0.04] p-1" aria-label="Workspace tabs">
        {TABS.map((tab) => {
          const active =
            pathname === tab.path || pathname.startsWith(`${tab.path}/`);
          return (
            <Link
              key={tab.path}
              href={tab.path}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                active
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <span
            key={c.label}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-slate-400"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color ?? "#64748b" }} />
            {c.label}
            <span className="font-medium text-slate-200">{c.value}</span>
          </span>
        ))}
        <span className="group relative">
          <button
            type="button"
            aria-label="About these results"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-[11px] font-semibold text-slate-400 hover:border-white/30 hover:text-white"
          >
            i
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute right-0 top-8 z-50 w-72 rounded-lg border border-white/10 bg-[#11111a] p-3 text-[11px] leading-relaxed text-slate-300 opacity-0 shadow-xl transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          >
            Warehouse Sentinel prioritizes safety footage for human review. It is not an emergency
            detector, does not identify people, and is not for judging individual workers.
          </span>
        </span>
      </div>
    </header>
  );
}
