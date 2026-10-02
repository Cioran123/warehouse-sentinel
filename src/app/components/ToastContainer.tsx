"use client";

import { useEffect } from "react";
import { dismissToast, useToasts, type ToastType } from "@/app/lib/ui/useToast";

const AUTO_DISMISS_MS = 4_000;

const STYLE: Record<ToastType, string> = {
  info: "border-line bg-surface text-ink",
  success: "border-line bg-surface text-ink",
  error: "border-high-line bg-high-soft text-high",
};

export default function ToastContainer() {
  const toasts = useToasts();

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismissToast(t.id), AUTO_DISMISS_MS),
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg shadow-ink/10 ${STYLE[t.type]}`}
        >
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 text-ink-2 transition-colors hover:text-ink"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
