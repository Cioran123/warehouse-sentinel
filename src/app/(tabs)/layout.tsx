import TabShell, { type StatusChip } from "@/app/components/TabShell";
import ToastContainer from "@/app/components/ToastContainer";
import { getCameraStatuses } from "@/app/lib/cameraStatus";
import { vastStatus } from "@/app/lib/vast";
import { listIncidents, loadVenue } from "@/app/lib/venue";

async function statusChips(): Promise<{ venueName: string; chips: StatusChip[] }> {
  try {
    const [venue, statuses, incidents, vast] = await Promise.all([loadVenue(), getCameraStatuses(), listIncidents(), vastStatus()]);
    const indexed = statuses.filter((s) => s.indexStatus === "indexed" || s.indexStatus === "tracked").length;
    const kept = incidents.filter((i) => i.verificationStatus === "kept").length;
    const verifier = incidents.find((i) => i.verifier)?.verifier?.split(":")[0] ?? "none";
    return {
      venueName: venue.venueName.replace(/\s*\(.*\)$/, ""),
      chips: [
        { label: "Cameras", value: `${indexed}/${statuses.length} indexed` },
        { label: "Verified", value: String(kept) },
        { label: "Verifier", value: verifier === "none" ? "Off" : verifier[0].toUpperCase() + verifier.slice(1) },
        {
          label: "VAST",
          value: !vast.configured ? "Not configured" : vast.reachable ? `Connected · ${vast.index === "vast" ? "VastDB index" : "local index"}` : "Offline, local fallback",
        },
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
    <div className="flex h-screen flex-col bg-canvas">
      <TabShell venueName={venueName} chips={chips} />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      <ToastContainer />
    </div>
  );
}
