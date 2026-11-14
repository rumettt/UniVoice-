import { StorageAdapter } from './StorageAdapter';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import { env } from '../../config/env';

/**
 * Returns the appropriate StorageAdapter singleton based on the runtime environment.
 *
 * - 'local'  → LocalStorageAdapter (development, test)
 * - Future:  → S3StorageAdapter (production, when AWS credentials are available)
 *
 * To add S3 support: implement S3StorageAdapter matching the StorageAdapter interface,
 * add `STORAGE_BACKEND=s3` to env config, and add the branch here.
 */
function createStorageAdapter(): StorageAdapter {
  // In test environment, use a temp-based local adapter to avoid polluting the dev upload dir
  if (env.NODE_ENV === 'test') {
    return new LocalStorageAdapter('./uploads/test');
  }
  // Default: local filesystem (development + any environment without object storage configured)
  return new LocalStorageAdapter();
}

export const storageAdapter: StorageAdapter = createStorageAdapter();
export { StorageAdapter } from './StorageAdapter';
export { LocalStorageAdapter } from './LocalStorageAdapter';
