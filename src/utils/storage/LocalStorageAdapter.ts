import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { StorageAdapter, StoreParams, StoreResult } from './StorageAdapter';
import { env } from '../../config/env';

/**
 * Local filesystem storage adapter for development and testing.
 * Files are stored in the directory defined by the STORAGE_LOCAL_DIR environment variable.
 *
 * Security properties:
 * - Filenames are UUID-prefixed to prevent enumeration and collisions.
 * - Original filenames are sanitised before use (path traversal prevention).
 * - Directory creation is idempotent.
 * - Downloads require backend authorisation — this adapter never serves files directly.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? env.STORAGE_LOCAL_DIR;
  }

  private sanitiseFilename(original: string): string {
    // Strip any directory component and keep only the base name
    const base = path.basename(original);
    // Replace anything that isn't alphanumeric, dash, underscore, or dot
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async store(params: StoreParams): Promise<StoreResult> {
    await this.ensureDir();
    const safeName = this.sanitiseFilename(params.originalName);
    const storageKey = `${randomUUID()}-${safeName}`;
    const filePath = path.join(this.baseDir, storageKey);

    // Verify no path traversal escapes the base directory
    const resolvedBase = path.resolve(this.baseDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
      throw new Error('Path traversal detected: storage key resolves outside base directory');
    }

    await fs.writeFile(filePath, params.buffer);
    return { storageKey, backend: 'local' };
  }

  async getSignedUrl(storageKey: string, _backend: string): Promise<string> {
    // For local storage, return the absolute filesystem path.
    // The controller streams the file content after authorisation checks.
    const resolvedBase = path.resolve(this.baseDir);
    const resolvedFile = path.resolve(path.join(this.baseDir, storageKey));
    if (!resolvedFile.startsWith(resolvedBase + path.sep)) {
      throw new Error('Path traversal detected in getSignedUrl');
    }
    return resolvedFile;
  }

  async delete(storageKey: string, _backend: string): Promise<void> {
    const resolvedBase = path.resolve(this.baseDir);
    const resolvedFile = path.resolve(path.join(this.baseDir, storageKey));
    if (!resolvedFile.startsWith(resolvedBase + path.sep)) {
      throw new Error('Path traversal detected in delete');
    }
    try {
      await fs.unlink(resolvedFile);
    } catch (err: unknown) {
      // Tolerate already-deleted files; re-throw other errors
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }
}
