/**
 * The VAST Video Search & Summary (VSS) archive: the team's pre-ingested footage, segmented by
 * VAST DataEngine, captioned by Cosmos3-Reason, embedded with Cosmos-Embed1, and indexed in
 * VAST DataBase (`vss-collection`).
 *
 * Warehouse Sentinel queries it to put each incident next to similar moments elsewhere in the
 * archive ("forklift close to a person", "worker without a hard hat"), and plays those segments
 * back through /api/vss/stream so the JWT never reaches the browser.
 *
 * Settings come from /config/<team>.config on the Builders Challenge VM: INGRESS_URL plus the
 * team USERNAME / PASSWORD (VSS_URL / VSS_USERNAME / VSS_PASSWORD take precedence).
 */

export interface ArchiveHit {
  /** Segment S3 URI (s3://<segments bucket>/...), playable through /api/vss/stream. */
  source: string;
  originalVideo?: string;
  similarity: number;
  caption: string;
  startSec?: number;
  endSec?: number;
  cameraId?: string;
  location?: string;
}

export interface ArchiveResult {
  configured: boolean;
  hits: ArchiveHit[];
  /** VSS's own LLM synthesis over the top segments, when it returned one. */
  summary?: string;
  error?: string;
}

const TOKEN_TTL_MS = 25 * 60_000;

const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find((v) => v) ?? "";

function settings(): { url: string; username: string; password: string } | null {
  const url = env("VSS_URL", "INGRESS_URL").replace(/\/+$/, "");
  const username = env("VSS_USERNAME", "VAST_USERNAME") || (url ? env("USERNAME") : "");
  const password = env("VSS_PASSWORD", "VAST_PASSWORD") || (url ? env("PASSWORD") : "");
  return url && username && password ? { url, username, password } : null;
}

export const vssConfigured = (): boolean => settings() !== null;

const g = globalThis as unknown as { __vssToken?: { token: string; at: number } };

async function token(force = false): Promise<{ url: string; token: string }> {
  const s = settings();
  if (!s) throw new Error("VSS is not configured");
  const cached = g.__vssToken;
  if (!force && cached && Date.now() - cached.at < TOKEN_TTL_MS) return { url: s.url, token: cached.token };
  const res = await fetch(`${s.url}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: s.username, password: s.password }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`VSS login ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("VSS login returned no token");
  g.__vssToken = { token: body.access_token, at: Date.now() };
  return { url: s.url, token: body.access_token };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** Accepts the segment rows VSS returns, whose metadata may sit at the top level or nested. */
function toHit(raw: Record<string, unknown>): ArchiveHit | null {
  const meta = (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as Record<string, unknown>;
  const source = str(raw.source) ?? str(raw.preview_source);
  if (!source) return null;
  return {
    source,
    originalVideo: str(raw.original_video),
    similarity: num(raw.similarity_score) ?? num(raw.similarity) ?? num(raw.score) ?? 0,
    caption: (str(raw.reasoning_content) ?? str(raw.caption) ?? "").slice(0, 400),
    startSec: num(raw.start_time) ?? num(raw.segment_start) ?? num(raw.best_match_start_sec),
    endSec: num(raw.end_time) ?? num(raw.segment_end) ?? num(raw.best_match_end_sec),
    cameraId: str(raw.camera_id) ?? str(meta.camera_id),
    location: str(raw.location) ?? str(meta.location),
  };
}

/** Hybrid (caption + visual embedding) search over the VSS archive. */
export async function searchArchive(
  query: string,
  opts: { topK?: number; minSimilarity?: number; tags?: string[] } = {},
): Promise<ArchiveResult> {
  if (!vssConfigured()) return { configured: false, hits: [] };
  const body = JSON.stringify({
    query,
    top_k: opts.topK ?? 6,
    llm_top_n: 3,
    min_similarity: opts.minSimilarity ?? 0.3,
    tags: opts.tags ?? [],
    include_public: true,
  });
  try {
    let auth = await token();
    const call = () =>
      fetch(`${auth.url}/api/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body,
        signal: AbortSignal.timeout(15000),
      });
    let res = await call();
    if (res.status === 401) {
      auth = await token(true);
      res = await call();
    }
    if (!res.ok) return { configured: true, hits: [], error: `VSS search ${res.status}` };
    const data = (await res.json()) as {
      results?: Record<string, unknown>[];
      llm_synthesis?: { response?: string };
    };
    const hits = (data.results ?? []).map(toHit).filter((h): h is ArchiveHit => h !== null);
    return { configured: true, hits, summary: str(data.llm_synthesis?.response) };
  } catch (err) {
    return { configured: true, hits: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Proxies a VSS segment stream (Range requests included) with the server-side token. */
export async function streamArchiveSegment(source: string, range: string | null): Promise<Response> {
  const auth = await token();
  const url = `${auth.url}/api/v1/videos/stream?source=${encodeURIComponent(source)}&token=${encodeURIComponent(auth.token)}`;
  const upstream = await fetch(url, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(20000) });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
