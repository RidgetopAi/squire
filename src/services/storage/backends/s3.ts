/**
 * S3 storage backend (MinIO in production, MinIO-in-docker for local dev).
 *
 * Speaks the S3 API via @aws-sdk/client-s3. The objects service dispatches
 * here when an object's storage_type is 's3'. Config comes from
 * config.media.* (see src/config/index.ts).
 *
 * Lazy-singleton client so a Squire boot without S3 credentials still works
 * for code paths that only touch local-storage objects.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
} from '@aws-sdk/client-s3';
import { config } from '../../../config/index.js';

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const { s3Endpoint, s3Region, s3AccessKey, s3SecretKey, s3ForcePathStyle } = config.media;
  if (!s3AccessKey || !s3SecretKey) {
    throw new Error(
      'S3 storage backend used but S3_ACCESS_KEY / S3_SECRET_KEY are not configured. ' +
        'Set them in .env (see .env.example) or switch STORAGE_BACKEND=local.'
    );
  }
  cachedClient = new S3Client({
    endpoint: s3Endpoint,
    region: s3Region,
    credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey },
    forcePathStyle: s3ForcePathStyle,
  });
  return cachedClient;
}

function bucket(): string {
  return config.media.s3Bucket;
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const readable = stream as AsyncIterable<Buffer | Uint8Array>;
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function put(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export interface S3GetResult {
  body: Buffer;
  contentType: string;
  size: number;
}

export async function get(key: string): Promise<S3GetResult | null> {
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const body = await streamToBuffer(res.Body);
    return {
      body,
      contentType: res.ContentType ?? 'application/octet-stream',
      size: body.length,
    };
  } catch (err) {
    if (err instanceof NoSuchKey || err instanceof NotFound) return null;
    throw err;
  }
}

export async function exists(key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    if (err instanceof NoSuchKey || err instanceof NotFound) return false;
    if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

export async function remove(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** For tests/debugging: reset the cached client so a config change is picked up. */
export function resetClient(): void {
  cachedClient = null;
}
