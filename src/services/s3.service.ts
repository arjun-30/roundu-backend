// EXISTING — generatePresignedUrl, deleteFile
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { s3Client, S3_BUCKET, S3_PUBLIC_URL, ALLOWED_FOLDERS, ALLOWED_TYPES, MAX_FILE_SIZES, UploadFolder } from '../config/s3';
import { BadRequestError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

// ── Types ───────────────────────────────────────────────────────────────────
export interface PresignedUrlResult {
  uploadUrl: string;   // PUT this URL with the file bytes
  fileUrl: string;     // Public URL after upload (store this in DB)
  key: string;         // S3 object key (for deletion later)
  expiresIn: number;   // URL valid for N seconds
}

// ── Service ─────────────────────────────────────────────────────────────────
export const S3Service = {

  /**
   * Generate a presigned PUT URL for the client to upload directly to storage.
   * Validates folder, file type, and file name.
   * Returns { uploadUrl, fileUrl, key, expiresIn }.
   */
  async generatePresignedUrl(
    folder: string,
    fileName: string,
    fileType: string,
  ): Promise<PresignedUrlResult> {
    // Validate folder
    if (!ALLOWED_FOLDERS.includes(folder as UploadFolder)) {
      throw new BadRequestError(`Invalid folder. Allowed: ${ALLOWED_FOLDERS.join(', ')}`);
    }

    const typedFolder = folder as UploadFolder;

    // Validate file type
    if (!ALLOWED_TYPES[typedFolder].includes(fileType)) {
      throw new BadRequestError(
        `Invalid file type "${fileType}" for ${folder}. Allowed: ${ALLOWED_TYPES[typedFolder].join(', ')}`,
      );
    }

    // Generate unique key: folder/uuid-originalname
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    const key = `${folder}/${uuid()}-${sanitizedName}`;

    // Create presigned PUT URL (expires in 10 minutes)
    const expiresIn = 600;
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    // Public URL for the uploaded file
    const fileUrl = `${S3_PUBLIC_URL}/${key}`;

    logger.debug('Presigned URL generated', { folder, key, fileType });

    return { uploadUrl, fileUrl, key, expiresIn };
  },

  /**
   * Delete a file from storage by its key.
   * Silently succeeds if the file doesn't exist (S3 returns 204 either way).
   */
  async deleteFile(key: string): Promise<void> {
    // Prevent path traversal
    if (key.includes('..') || key.startsWith('/')) {
      throw new BadRequestError('Invalid file key.');
    }

    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }));
      logger.debug('File deleted from storage', { key });
    } catch (error: any) {
      logger.error('Failed to delete file from storage', { key, error: error.message });
      // Don't throw — file might already be deleted, or storage might be down
      // The caller should not fail because of a storage cleanup issue
    }
  },

  /**
   * Extract the S3 key from a full file URL.
   * e.g., "https://roundu.blr1.digitaloceanspaces.com/avatars/abc.jpg" → "avatars/abc.jpg"
   */
  extractKeyFromUrl(url: string): string | null {
    try {
      const publicUrlPrefix = S3_PUBLIC_URL.endsWith('/') ? S3_PUBLIC_URL : `${S3_PUBLIC_URL}/`;
      if (url.startsWith(publicUrlPrefix)) {
        return url.substring(publicUrlPrefix.length);
      }
      // Fallback: try to extract from URL path
      const parsed = new URL(url);
      return parsed.pathname.startsWith('/') ? parsed.pathname.substring(1) : parsed.pathname;
    } catch {
      return null;
    }
  },
};
