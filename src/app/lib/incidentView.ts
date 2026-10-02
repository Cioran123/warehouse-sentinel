import { promises as fs } from "node:fs";
import path from "node:path";
import { PIPELINE_DIR } from "@/app/lib/storage";
import { LIVE_CAMERA_ID, type Camera, type Incident, type TrackFrame } from "@/app/lib/types";
import { getIncident, listIncidents, loadLiveCamera, loadTracks, loadVenue } from "@/app/lib/venue";

/** Everything the incident viewer needs, shared by the incident page and the command-center drawer. */
export interface IncidentView {
  incident: Incident;
  camera: Camera;
  venueName: string;
  cameraIncidents: Incident[];
  tracks: TrackFrame[];
  syntheticTracks: boolean;
  live: boolean;
}

async function tracksAreSynthetic(cameraId: string): Promise<boolean> {
  try {
    const head = (await fs.readFile(path.join(PIPELINE_DIR, `${cameraId}.tracks.json`), "utf8")).slice(-200);
    return head.includes('"synthetic": true');
  } catch {
    return false;
  }
}

export async function loadIncidentView(id: string): Promise<IncidentView | null> {
  const incident = await getIncident(id);
  if (!incident) return null;
  const venue = await loadVenue();
  if (incident.cameraId === LIVE_CAMERA_ID) {
    return {
      incident,
      camera: await loadLiveCamera(),
      venueName: venue.venueName,
      cameraIncidents: [incident],
      tracks: [],
      syntheticTracks: false,
      live: true,
    };
  }
  const camera = venue.cameras.find((c) => c.id === incident.cameraId);
  if (!camera) return null;

  const [all, tracks, synthetic] = await Promise.all([
    listIncidents(),
    loadTracks(camera.id, Math.max(0, incident.startSec - 15), incident.endSec + 15),
    tracksAreSynthetic(camera.id),
  ]);
  return {
    incident,
    camera,
    venueName: venue.venueName,
    cameraIncidents: all.filter((i) => i.cameraId === camera.id),
    tracks,
    syntheticTracks: synthetic,
    live: false,
  };
}
