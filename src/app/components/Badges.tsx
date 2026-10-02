import { PRIORITY_COLOR, type Priority, type SourceType, type VerificationStatus } from "@/app/lib/types";

const PRIORITY_LABEL: Record<Priority, string> = { high: "High priority", medium: "Medium priority", low: "Low priority" };

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: PRIORITY_COLOR[priority] }}>
      <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLOR[priority] }} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

const STATUS: Record<VerificationStatus, { label: string; className: string; mark: string }> = {
  kept: { label: "Verified", className: "text-ink font-medium", mark: "bg-ink" },
  candidate: { label: "Unverified", className: "text-ink-2", mark: "border-[1.5px] border-ink-3" },
  rejected: { label: "Rejected", className: "text-ink-3 line-through decoration-ink-3/50", mark: "bg-line-strong" },
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] ${s.className}`}>
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${s.mark}`} />
      {s.label}
    </span>
  );
}

export function SourceBadge({ sourceType }: { sourceType: SourceType }) {
  return (
    <span className="text-[12px] text-ink-3">
      {sourceType === "synthetic_sdg" ? "Synthetic footage (VAST SDG)" : sourceType.replace("_", " ")}
    </span>
  );
}
