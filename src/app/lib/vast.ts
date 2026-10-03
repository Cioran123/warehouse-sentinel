/**
 * VAST Data for the app: VAST S3 media and the VAST DataBase-backed incident index.
 *
 * pipeline/vast_sync.py uploads every camera video and evidence clip to the media bucket and
 * writes `cameras`, `incidents`, and `detections` tables to VAST DataBase (schema
 * `warehouse_sentinel`). Here the app streams media straight from VAST S3 (presigned GETs) and,
 * through pipeline/vast_search.py, runs incident search against VAST DataBase.
 *
 * Settings mirror pipeline/vast.py: VAST_* names first, then the Builders Challenge names from
 * /config/<team>.config (S3_ENDPOINT, ACCESS_KEY, SECRET_KEY, VASTDB_BUCKET). When the cluster is
 * not configured or does not answer, callers fall back to the local files.
 */

import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface VastConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  mediaBucket: string;
  dbBucket: string;
  schema: string;
}

export interface VastStatus {
  configured: boolean;
  reachable: boolean;
  mediaBucket?: string;
  schema?: string;
  /** Where incident search runs: VAST DataBase via vast_search.py, or the local ledger. */
  index: "vast" | "local";
}

const REACH_TTL_MS = 60_000;
const OBJECT_TTL_MS = 5 * 60_000;
const URL_TTL_SEC = 3600;

const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find((v) => v) ?? "";

export function vastConfig(): VastConfig | null {
  const endpoint = env("VAST_S3_ENDPOINT", "S3_ENDPOINT");
  const accessKey = env("VAST_ACCESS_KEY", "ACCESS_KEY");
  const secretKey = env("VAST_SECRET_KEY", "SECRET_KEY");
  if (!endpoint || !accessKey || !secretKey) return null;
  return {
    endpoint,
    accessKey,
    secretKey,
    mediaBucket: env("VAST_MEDIA_BUCKET") || "warehouse-sentinel-media",
    dbBucket: env("VAST_DB_BUCKET", "VASTDB_BUCKET") || "sentinel-db",
    schema: env("VAST_DB_SCHEMA") || "warehouse_sentinel",
  };
}

/** Incident search uses VAST DataBase when asked to, or by default whenever VAST is configured. */
export function indexBackend(): "vast" | "local" {
  const choice = process.env.INDEX_BACKEND?.trim();
  if (choice === "vast" || choice === "local") return choice;
  return vastConfig() ? "vast" : "local";
}

const g = globalThis as unknown as {
  __vastS3?: S3Client;
  __vastReach?: { ok: boolean; at: number };
  __vastObjects?: Map<string, { ok: boolean; at: number }>;
};

function client(cfg: VastConfig): S3Client {
  g.__vastS3 ??= new S3Client({
    endpoint: cfg.endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    // One fast attempt: a cluster that is down must not stall a page or a video request.
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 1500, requestTimeout: 4000 },
  });
  return g.__vastS3;
}

/** Whether the VAST S3 media bucket answers, cached for a minute either way. */
export async function vastReachable(): Promise<boolean> {
  const cfg = vastConfig();
  if (!cfg) return false;
  const hit = g.__vastReach;
  if (hit && Date.now() - hit.at < REACH_TTL_MS) return hit.ok;
  let ok = false;
  try {
    await client(cfg).send(new HeadBucketCommand({ Bucket: cfg.mediaBucket }));
    ok = true;
  } catch {
    ok = false;
  }
  g.__vastReach = { ok, at: Date.now() };
  return ok;
}

export async function vastStatus(): Promise<VastStatus> {
  const cfg = vastConfig();
  if (!cfg) return { configured: false, reachable: false, index: indexBackend() };
  return {
    configured: true,
    reachable: await vastReachable(),
    mediaBucket: cfg.mediaBucket,
    schema: `${cfg.dbBucket}/${cfg.schema}`,
    index: indexBackend(),
  };
}

/** Object keys, matching pipeline/vast.py. */
export const videoKey = (videoFile: string) => `videos/${videoFile}`;
export const clipKey = (incidentId: string) => `clips/${incidentId}.mp4`;

/**
 * A presigned VAST S3 URL for `key`, or null when VAST is off, unreachable, or lacks the object.
 * The browser plays it directly, so media never passes through this server.
 */
export async function vastMediaUrl(key: string): Promise<string | null> {
  const cfg = vastConfig();
  if (!cfg || !(await vastReachable())) return null;
  const objects = (g.__vastObjects ??= new Map());
  const known = objects.get(key);
  if (!known || Date.now() - known.at > OBJECT_TTL_MS) {
    let ok = false;
    try {
      await client(cfg).send(new HeadObjectCommand({ Bucket: cfg.mediaBucket, Key: key }));
      ok = true;
    } catch {
      ok = false;
    }
    objects.set(key, { ok, at: Date.now() });
    if (!ok) return null;
  } else if (!known.ok) {
    return null;
  }
  return getSignedUrl(client(cfg), new GetObjectCommand({ Bucket: cfg.mediaBucket, Key: key }), {
    expiresIn: URL_TTL_SEC,
  });
}
