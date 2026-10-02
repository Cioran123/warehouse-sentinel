import { redirect } from "next/navigation";

export default async function VenuePage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string }>;
}) {
  const zone = (await searchParams).zone?.trim();
  redirect(zone ? `/overview?zone=${encodeURIComponent(zone)}` : "/overview");
}
