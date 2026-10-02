import { notFound } from "next/navigation";
import IncidentViewer from "@/app/components/IncidentViewer";
import { loadIncidentView } from "@/app/lib/incidentView";

export const dynamic = "force-dynamic";

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await loadIncidentView(id);
  if (!view) notFound();
  return <IncidentViewer {...view} />;
}
