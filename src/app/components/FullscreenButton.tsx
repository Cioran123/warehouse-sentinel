"use client";

export default function FullscreenButton({
  active,
  onToggle,
  label,
  className = "",
}: {
  active: boolean;
  onToggle: () => void;
  /** What goes full screen, e.g. "Forklift Lane". */
  label: string;
  className?: string;
}) {
  const text = active ? `Exit full screen` : `Full screen: ${label}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={text}
      title={text}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${className}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {active ? (
          <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
        ) : (
          <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
        )}
      </svg>
    </button>
  );
}
