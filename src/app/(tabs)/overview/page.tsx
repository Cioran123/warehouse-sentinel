import CommandCenter from "@/app/components/CommandCenter";
import { getCameraStatuses } from "@/app/lib/cameraStatus";
import { countByZone } from "@/app/lib/search";
import { listIncidents, loadEvalSummary, loadVenue } from "@/app/lib/venue";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string; incident?: string; q?: string }>;
}) {
  const [params, venue, statuses, incidents, evalSummary] = await Promise.all([
    searchParams,
    loadVenue(),
    getCameraStatuses(),
    listIncidents(),
    loadEvalSummary(),
  ]);
  const visible = incidents.filter((i) => i.verificationStatus !== "rejected");
  const zoneId = venue.cameras.some((c) => c.zoneId === params.zone) ? params.zone! : null;

  return (
    <CommandCenter
      venueName={venue.venueName}
      statuses={statuses}
      incidents={visible}
      zones={countByZone(visible, venue.cameras)}
      rejectedCount={incidents.length - visible.length}
      evalSummary={evalSummary}
      initialZoneId={zoneId}
      initialIncidentId={params.incident?.trim() || null}
      initialQuery={params.q?.trim() || null}
    />
  );
}
