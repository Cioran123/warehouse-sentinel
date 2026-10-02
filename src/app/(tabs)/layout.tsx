import TabShell, { type StatusChip } from "@/app/components/TabShell";
import ToastContainer from "@/app/components/ToastContainer";
import { getCameraStatuses } from "@/app/lib/cameraStatus";
import { listIncidents, loadVenue } from "@/app/lib/venue";

async function statusChips(): Promise<{ venueName: string; chips: StatusChip[] }> {
  try {
    const [venue, statuses, incidents] = await Promise.all([loadVenue(), getCameraStatuses(), listIncidents()]);
    const indexed = statuses.filter((s) => s.indexStatus === "indexed" || s.indexStatus === "tracked").length;
    const kept = incidents.filter((i) => i.verificationStatus === "kept").length;
    const verifier = incidents.find((i) => i.verifier)?.verifier?.split(":")[0] ?? "none";
    return {
      venueName: venue.venueName.replace(/\s*\(.*\)$/, ""),
      chips: [
        { label: "Cameras indexed", value: `${indexed}/${statuses.length}`, color: indexed ? "#22c55e" : "#94a3b8" },
        { label: "Verified", value: String(kept), color: kept ? "#22c55e" : "#94a3b8" },
        { label: "Verifier", value: verifier, color: verifier === "none" ? "#94a3b8" : "#60a5fa" },
        { label: "Index", value: process.env.INDEX_BACKEND === "vast" ? "VAST" : "local", color: "#c084fc" },
      ],
    };
  } catch {
    return { venueName: "Site A", chips: [] };
  }
}

export default async function TabsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { venueName, chips } = await statusChips();
  return (
    <div className="flex h-screen flex-col bg-[#09090f]">
      <TabShell venueName={venueName} chips={chips} />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      <ToastContainer />
    </div>
  );
}
