/**
 * Phase 1 smoke test: put/get/delete round-trip from Squire's S3 client
 * against MinIO. Reads connection config from Squire's config module so
 * we exercise the real env-loading path, not a separate config.
 *
 * Run on the VPS (where MinIO listens on 127.0.0.1:9000):
 *   cd /opt/squire-staging && npx tsx scripts/smoke-test-minio.ts
 *
 * Exits 0 on success, 1 on any failure. Logs each stage so a failure
 * tells you exactly which probe missed (connect / put / get / delete).
 */

import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { config } from '../src/config/index.js';

async function streamToString(stream: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  const readable = stream as AsyncIterable<Buffer>;
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main(): Promise<void> {
  const { s3Endpoint, s3Bucket, s3Region, s3AccessKey, s3SecretKey, s3ForcePathStyle } =
    config.media;

  if (!s3AccessKey || !s3SecretKey) {
    console.error('FAIL: S3_ACCESS_KEY / S3_SECRET_KEY not set in env');
    process.exit(1);
  }

  console.log('[stage 0] config loaded');
  console.log(`  endpoint=${s3Endpoint} bucket=${s3Bucket} region=${s3Region} pathStyle=${s3ForcePathStyle}`);

  const client = new S3Client({
    endpoint: s3Endpoint,
    region: s3Region,
    credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey },
    forcePathStyle: s3ForcePathStyle,
  });

  const key = `_probes/p1-sdk-${Date.now()}.txt`;
  const body = `phase-1 sdk smoke ${new Date().toISOString()}\n`;

  try {
    console.log('[stage 1] HEAD bucket');
    await client.send(new HeadBucketCommand({ Bucket: s3Bucket }));
    console.log('  ok');

    console.log(`[stage 2] PUT ${key}`);
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: 'text/plain',
      })
    );
    console.log('  ok');

    console.log(`[stage 3] GET ${key}`);
    const got = await client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
    const roundtrip = await streamToString(got.Body);
    if (roundtrip !== body) {
      console.error(`  FAIL: round-trip mismatch.\n    sent: ${JSON.stringify(body)}\n    got:  ${JSON.stringify(roundtrip)}`);
      process.exit(1);
    }
    console.log(`  ok (${roundtrip.length} bytes match)`);

    console.log(`[stage 4] DELETE ${key}`);
    await client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
    console.log('  ok');

    console.log('\nALL STAGES PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\nFAIL:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
