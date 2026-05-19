/**
 * Storage backend dispatcher.
 *
 * `backendFor(storageType)` returns the right backend for a stored object's
 * recorded type. `defaultBackendType()` decides where NEW objects go — env
 * var STORAGE_BACKEND (local|s3), default local. Existing rows always use
 * their own storage_type, so switching the default doesn't strand old data.
 */

import * as localBackend from './local.js';
import * as s3Backend from './s3.js';
import type { StorageBackend } from './types.js';

export type StorageBackendType = 'local' | 's3';

export type { BackendGetResult, StorageBackend } from './types.js';

function isStorageBackendType(value: string): value is StorageBackendType {
  return value === 'local' || value === 's3';
}

export function backendFor(storageType: string): StorageBackend {
  if (storageType === 'local') return localBackend;
  if (storageType === 's3') return s3Backend;
  throw new Error(`Unsupported storage backend: ${storageType}`);
}

export function defaultBackendType(): StorageBackendType {
  const raw = (process.env['STORAGE_BACKEND'] ?? 'local').toLowerCase();
  if (isStorageBackendType(raw)) return raw;
  console.warn(`[storage] STORAGE_BACKEND="${raw}" not recognized, falling back to local`);
  return 'local';
}
