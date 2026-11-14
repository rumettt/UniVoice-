import multer from 'multer';
import { env } from '../config/env';

/**
 * Memory-storage multer instance for attachment uploads.
 * Files are held in memory as Buffer objects and passed to StorageAdapter
 * for persistence — no temporary disk files are created by multer.
 *
 * Limits:
 *  - fileSize: controlled by STORAGE_MAX_FILE_SIZE_BYTES (default 10 MB)
 *  - files: 1 per request (single-file upload)
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.STORAGE_MAX_FILE_SIZE_BYTES,
    files: 1,
  },
});
