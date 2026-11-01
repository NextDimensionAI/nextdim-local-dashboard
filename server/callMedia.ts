import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { GoogleAuth } from "google-auth-library";
import type { Plugin } from "vite";

const ROUTE = /^\/media\/(recording|log)\/([^/?]+)(?:\?(.*))?$/;
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_only"] });

type Kind = "recording" | "log";

interface Lookup {
  configuratorUrl: string;
  apiKey: string;
  conversationId: string;
  tenant: string;
}

// The configurator's signed-URL routes need a signing identity this machine lacks, so call media
// is streamed here with your ADC. Only URIs the configurator stores for the call are ever read.
export function callMedia(configuratorUrl: string, apiKey: string): Plugin {
  return {
    name: "call-media",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(ROUTE);
        if (!match || req.method !== "GET") return next();
        const kind = match[1] as Kind;
        const tenant = new URLSearchParams(match[3] ?? "").get("tenant") || "nyga";
        const lookup = { configuratorUrl, apiKey, conversationId: decodeURIComponent(match[2]), tenant };
        stream(req, res, kind, lookup).catch((error) => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end(`${kind} stream failed: ${String(error)}`);
          } else {
            res.destroy();
          }
        });
      });
    },
  };
}

async function stream(req: IncomingMessage, res: ServerResponse, kind: Kind, lookup: Lookup): Promise<void> {
  const located = kind === "recording" ? await recordingLink(lookup) : await logLink(lookup);
  if ("failed" in located) {
    res.statusCode = located.status;
    res.end(located.message);
    return;
  }
  const object = parseGcsLink(located.link);
  if (!object) {
    res.statusCode = 404;
    res.end(`no ${kind} for this call`);
    return;
  }

  const token = await auth.getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (req.headers.range) headers.Range = req.headers.range;
  const gcs = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(object.bucket)}/o/${encodeURIComponent(object.name)}?alt=media`,
    { headers },
  );
  res.statusCode = gcs.status;
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = gcs.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (!gcs.headers.get("accept-ranges")) res.setHeader("accept-ranges", "bytes");
  if (!gcs.body) {
    res.end();
    return;
  }
  Readable.fromWeb(gcs.body as never).pipe(res);
}

interface Failure {
  failed: true;
  status: number;
  message: string;
}

type Located = { link: string | null | undefined } | Failure;

async function configurator<T>(path: string, { configuratorUrl, apiKey, tenant }: Lookup): Promise<T | Failure> {
  const res = await fetch(`${configuratorUrl}${path}`, { headers: { "X-API-Key": apiKey, "X-Tenant-Id": tenant } });
  if (!res.ok) return { failed: true, status: res.status, message: `configurator lookup failed: ${res.status}` };
  return (await res.json()) as T;
}

async function recordingLink(lookup: Lookup): Promise<Located> {
  const conv = await configurator<{ recording_link?: string | null }>(
    `/v1/conversations/${encodeURIComponent(lookup.conversationId)}`,
    lookup,
  );
  if ("failed" in conv) return conv;
  return { link: conv.recording_link };
}

// The conversation doc's log_url isn't in the API response; the call's "ended" event carries it.
async function logLink(lookup: Lookup): Promise<Located> {
  const events = await configurator<{ items: { category: string; data?: { log_url?: string | null } }[] }>(
    `/v1/conversations/${encodeURIComponent(lookup.conversationId)}/events?limit=1000`,
    lookup,
  );
  if ("failed" in events) return events;
  return { link: events.items.find((e) => e.category === "conversation" && e.data?.log_url)?.data?.log_url };
}

function parseGcsLink(link: string | null | undefined): { bucket: string; name: string } | null {
  if (!link) return null;
  const gs = link.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (gs) return { bucket: gs[1], name: gs[2] };
  const https = link.match(/^https:\/\/storage\.(?:googleapis|cloud\.google)\.com\/([^/]+)\/([^?]+)/);
  if (https) return { bucket: https[1], name: decodeURIComponent(https[2]) };
  return null;
}
