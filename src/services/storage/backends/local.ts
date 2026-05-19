/**
 * Local filesystem storage backend. Files live under SQUIRE_STORAGE_PATH
 * (default ./storage/objects); keys are paths relative to that root.
 *
 * Matches the shape of the s3 backend so the objects service can dispatch
 * on `storage_type` without caring which one it has.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { BackendGetResult } from './types.js';

const STORAGE_BASE = process.env['SQUIRE_STORAGE_PATH'] || './storage/objects';

function fullPath(key: string): string {
  return path.join(STORAGE_BASE, key);
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function put(key: string, body: Buffer, _contentType: string): Promise<void> {
  const p = fullPath(key);
  await ensureDir(p);
  await fs.writeFile(p, body);
}

export async function get(key: string): Promise<BackendGetResult | null> {
  try {
    const body = await fs.readFile(fullPath(key));
    // Local fs has no native MIME — caller knows the type from the DB row.
    return { body, contentType: 'application/octet-stream', size: body.length };
  } catch {
    return null;
  }
}

export async function exists(key: string): Promise<boolean> {
  try {
    await fs.access(fullPath(key));
    return true;
  } catch {
    return false;
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await fs.unlink(fullPath(key));
  } catch (err) {
    // Idempotent: missing file is not an error.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}
