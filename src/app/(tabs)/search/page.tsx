import { redirect } from "next/navigation";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q?.trim();
  redirect(q ? `/overview?q=${encodeURIComponent(q)}` : "/overview");
}
