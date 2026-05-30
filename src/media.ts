import type { Attachment } from "chat";
import { type HostLookup, readBodyCapped, safeFetch } from "./safe-fetch.js";

/**
 * A file resolved into the shape Payload's Local API expects on
 * `create({ ..., file })` for an upload-enabled collection.
 */
export interface ResolvedFile {
  data: Buffer;
  mimetype: string;
  name: string;
  size: number;
}

/** Options for fetching a file from a URL. */
export interface FetchFileOptions {
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MIME = "application/octet-stream";
/** Cap on a URL-fetched file (chat platforms cap inbound media well below). */
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Abort a URL fetch that stalls, so a slow internal host can't hang a turn. */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;
const MIME_SUFFIX = /[;+]/;

// Magic-byte signatures for the common file types chat platforms send. Many
// (e.g. Telegram photos) arrive with no name or mime type, so we sniff.
const SIGNATURES: Array<{
  ext: string;
  matches: (bytes: Buffer) => boolean;
  mime: string;
}> = [
  { mime: "image/jpeg", ext: "jpg", matches: (b) => hex(b, 3) === "ffd8ff" },
  { mime: "image/png", ext: "png", matches: (b) => hex(b, 4) === "89504e47" },
  { mime: "image/gif", ext: "gif", matches: (b) => ascii(b, 0, 4) === "GIF8" },
  {
    mime: "image/webp",
    ext: "webp",
    matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    mime: "application/pdf",
    ext: "pdf",
    matches: (b) => ascii(b, 0, 4) === "%PDF",
  },
];

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "text/plain": "txt",
};

function hex(bytes: Buffer, end: number): string {
  return bytes.toString("hex", 0, end);
}

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.toString("ascii", start, end);
}

async function toBuffer(
  data: Buffer | Blob | undefined
): Promise<Buffer | null> {
  if (!data) {
    return null;
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  return Buffer.from(await data.arrayBuffer());
}

function extensionForMime(mimeType: string): string {
  const mapped = MIME_EXTENSIONS[mimeType];
  if (mapped) {
    return mapped;
  }
  const subtype = mimeType.split("/")[1] ?? "";
  return subtype.split(MIME_SUFFIX)[0] || "bin";
}

/**
 * Resolve the mime type and extension, preferring a specific platform-provided
 * type and otherwise sniffing the magic bytes -- so a Telegram photo with no
 * metadata still becomes image/jpeg rather than application/octet-stream.
 */
function detectType(
  providedMime: string | undefined,
  buffer: Buffer
): { ext: string; mimetype: string } {
  if (providedMime && providedMime !== DEFAULT_MIME) {
    return { mimetype: providedMime, ext: extensionForMime(providedMime) };
  }

  const sniffed = SIGNATURES.find((sig) => sig.matches(buffer));
  if (sniffed) {
    return { mimetype: sniffed.mime, ext: sniffed.ext };
  }

  const fallback = providedMime ?? DEFAULT_MIME;
  return { mimetype: fallback, ext: extensionForMime(fallback) };
}

function ensureName(name: string | undefined, ext: string): string {
  if (name && HAS_EXTENSION.test(name)) {
    return name;
  }
  if (name && name.length > 0) {
    return `${name}.${ext}`;
  }
  return `upload.${ext}`;
}

function nameFromUrl(url: string, ext: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return ensureName(last, ext);
  } catch {
    return ensureName(undefined, ext);
  }
}

/** Resolve an inbound chat attachment into an uploadable file. */
export async function fileFromAttachment(
  attachment: Attachment
): Promise<ResolvedFile> {
  const data = attachment.fetchData
    ? await attachment.fetchData()
    : await toBuffer(attachment.data);

  if (!data) {
    throw new Error("Attachment has no data to upload");
  }

  const { mimetype, ext } = detectType(attachment.mimeType, data);

  return {
    data,
    mimetype,
    name: ensureName(attachment.name, ext),
    size: attachment.size ?? data.length,
  };
}

/**
 * Fetch a URL and resolve it into an uploadable file. The request is restricted
 * to http(s) and publicly routable addresses (SSRF protection), bounded by a
 * timeout, and capped in size.
 */
export async function fileFromUrl(
  url: string,
  options: FetchFileOptions = {}
): Promise<ResolvedFile> {
  const {
    fetchImpl = fetch,
    lookup,
    maxBytes = DEFAULT_MAX_FILE_BYTES,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await safeFetch(url, {
      fetchImpl,
      lookup,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `File at ${url} is ${declared} bytes, over the ${maxBytes}-byte limit`
      );
    }

    const data = await readBodyCapped(response, maxBytes);
    const providedMime = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    const { mimetype, ext } = detectType(providedMime || undefined, data);

    return {
      data,
      mimetype,
      name: nameFromUrl(url, ext),
      size: data.length,
    };
  } finally {
    clearTimeout(timer);
  }
}
