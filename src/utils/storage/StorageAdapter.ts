/**
 * Provider-independent storage adapter interface.
 * Implementations handle local filesystem (dev) and S3-compatible object storage (prod).
 * File contents are never stored in PostgreSQL — only metadata (storage_key, backend, mime_type, etc.).
 */
export interface StoreParams {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StoreResult {
  storageKey: string;
  backend: StorageBackend;
}

export type StorageBackend = 'local' | 's3' | 'gcs' | 'azure';

export interface StorageAdapter {
  /**
   * Persist a file buffer and return its storage key and backend identifier.
   * The caller is responsible for recording the metadata in PostgreSQL.
   */
  store(params: StoreParams): Promise<StoreResult>;

  /**
   * Resolve a short-lived URL (or local path) for authorised file access.
   * For local storage this returns a path string; in S3 this would be a presigned URL.
   * The TTL is implementation-defined (default: 15 minutes for S3-compatible).
   */
  getSignedUrl(storageKey: string, backend: StorageBackend): Promise<string>;

  /**
   * Remove the stored file permanently.
   * Database metadata must be soft-deleted (deleted_at) separately by the caller.
   */
  delete(storageKey: string, backend: StorageBackend): Promise<void>;
}
