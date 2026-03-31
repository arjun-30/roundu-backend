// EXISTING — presignedUrl, deleteFile
import { Request, Response, NextFunction } from 'express';
import { S3Service } from '../services/s3.service';
import { success } from '../utils/response';
import { UnauthorizedError } from '../middleware/errorHandler';

/**
 * POST /uploads/presigned-url
 * Auth required
 * Body: { fileName: "photo.jpg", fileType: "image/jpeg", folder: "avatars" }
 * Returns: { uploadUrl, fileUrl, key, expiresIn }
 *
 * The client uses uploadUrl to PUT the file directly to storage.
 * Then stores fileUrl in the database (e.g., as avatarUrl, photoUrl, etc).
 */
export async function getPresignedUrl(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new UnauthorizedError();

    const { fileName, fileType, folder } = req.body;

    const result = await S3Service.generatePresignedUrl(folder, fileName, fileType);

    return success(res, result, 'Upload URL generated. PUT your file to uploadUrl within 10 minutes.');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /uploads/:key
 * Auth required (admin or file owner — simplified: just auth for now)
 * Deletes file from storage
 */
export async function deleteFile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new UnauthorizedError();

    const { key } = req.params;

    await S3Service.deleteFile(key);

    return success(res, null, 'File deleted.');
  } catch (err) {
    next(err);
  }
}
