"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useOptionalCommand } from "@/app/lib/ui/commandStore";

/** Opens the incident drawer inside the command center, or the incident page anywhere else. */
export default function IncidentLink({
  id,
  className,
  style,
  title,
  children,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  const command = useOptionalCommand();
  if (!command) {
    return (
      <Link href={`/incident/${id}`} className={className} style={style} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={title}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        command.openIncident(id);
      }}
      className={`text-left ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
