/**
 * Small text objects in the lake's object store — read one, write one.
 *
 * Think of it as: the clipboard for the lake's paperwork. The dashboard reads
 * the lake through DuckDB, and DuckDB can COPY a query result to an object,
 * but it cannot append a line to a manifest or fetch one JSON receipt. Those
 * two things are an HTTP GET and PUT against AIStor's S3 API, signed with
 * SigV4 the way every other lake client signs — no SDK, no extra dependency.
 *
 * Only the ingest manifests and receipts go through here. Row data is written
 * by DuckDB (`COPY ... TO 's3://...'`) and read the same way.
 */
import crypto from 'node:crypto';

const S3_ENDPOINT = process.env.LAKE_S3_ENDPOINT || 'http://127.0.0.1:9100';
const ACCESS_KEY = process.env.MINIO_USER || 'lakeadmin';
const SECRET_KEY = process.env.MINIO_PASSWORD || 'lakeadmin-dev';
const REGION = process.env.LAKE_REGION || 'us-east-1';

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();

/** `s3://bucket/key` → `{ bucket, key }`. */
export function splitObjectPath(objectPath: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(objectPath);
  if (!match) throw new Error(`Not an object path: ${objectPath}`);
  return { bucket: match[1]!, key: match[2]! };
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** SigV4 headers for one S3 request (path-style, service `s3`). */
function signedHeaders(method: string, url: URL, payload: string | Buffer, contentType?: string): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedNames.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date), REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const out: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
      `SignedHeaders=${signedNames.join(';')}, Signature=${signature}`,
  };
  if (contentType) out['Content-Type'] = contentType;
  return out;
}

/** The object's text, or null when it does not exist. */
export async function getObjectText(objectPath: string): Promise<string | null> {
  const { bucket, key } = splitObjectPath(objectPath);
  const url = new URL(`${S3_ENDPOINT}/${bucket}/${encodeKey(key)}`);
  const response = await fetch(url, { method: 'GET', headers: signedHeaders('GET', url, '') });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${objectPath} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return response.text();
}

/** Write (or overwrite) a text object. */
export async function putObjectText(objectPath: string, text: string, contentType = 'application/json'): Promise<void> {
  const { bucket, key } = splitObjectPath(objectPath);
  const url = new URL(`${S3_ENDPOINT}/${bucket}/${encodeKey(key)}`);
  const response = await fetch(url, {
    method: 'PUT',
    headers: signedHeaders('PUT', url, text, contentType),
    body: text,
  });
  if (!response.ok) throw new Error(`PUT ${objectPath} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}

/**
 * Append one JSON line to a `.jsonl` manifest. Object storage has no append,
 * so this is read-modify-write; two writers landing in the same second could
 * drop each other's line, which is why every landing also has its SQLite row
 * and the lifecycle never trusts the manifest alone.
 */
export async function appendJsonLine(objectPath: string, line: Record<string, unknown>): Promise<void> {
  const existing = (await getObjectText(objectPath)) ?? '';
  const body = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
  await putObjectText(objectPath, `${body}${JSON.stringify(line)}\n`, 'application/x-ndjson');
}

/** Every parsed line of a `.jsonl` manifest; an absent object is an empty list. */
export async function readJsonLines<T = Record<string, unknown>>(objectPath: string): Promise<T[]> {
  const text = await getObjectText(objectPath);
  if (!text) return [];
  const out: T[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A truncated last line from an interrupted write is skipped, not fatal.
    }
  }
  return out;
}
