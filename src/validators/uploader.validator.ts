import { z } from 'zod';

export const presignedUrlSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255, 'File name too long'),
  fileType: z.string().min(1, 'File type is required'),
  folder: z.string().min(1, 'Folder is required'),
});

export const deleteFileSchema = z.object({
  key: z.string().min(1, 'File key is required'),
});
