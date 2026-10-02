import SiteMapView from "@/app/components/SiteMapView";
import { getCameraStatuses } from "@/app/lib/cameraStatus";
import { countByZone } from "@/app/lib/search";
import { listIncidents, loadVenue } from "@/app/lib/venue";

export const dynamic = "force-dynamic";

export default async function SiteMapPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string; incident?: string }>;
}) {
  const [params, venue, statuses, incidents] = await Promise.all([
    searchParams,
    loadVenue(),
    getCameraStatuses(),
    listIncidents(),
  ]);
  const visible = incidents.filter((i) => i.verificationStatus !== "rejected");
  const zoneId = venue.cameras.some((c) => c.zoneId === params.zone) ? params.zone! : null;

  return (
    <SiteMapView
      venueName={venue.venueName}
      statuses={statuses}
      incidents={visible}
      zones={countByZone(visible, venue.cameras)}
      rejectedCount={incidents.length - visible.length}
      initialZoneId={zoneId}
      initialIncidentId={params.incident?.trim() || null}
    />
  );
}
