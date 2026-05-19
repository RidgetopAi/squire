/**
 * Common interface for object-storage backends (local fs, S3, ...).
 *
 * The objects service writes/reads/deletes through whichever backend matches
 * `objects.storage_type`. Each backend module exports functions matching this
 * shape — see local.ts and s3.ts.
 */

export interface BackendGetResult {
  body: Buffer;
  contentType: string;
  size: number;
}

export interface StorageBackend {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<BackendGetResult | null>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}
