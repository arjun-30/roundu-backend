// TECH LEAD — AWS S3Client
import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

/**
 * S3-COMPATIBLE STORAGE CLIENT
 *
 * Works with ANY S3-compatible provider. Just change env vars:
 *
 * DigitalOcean Spaces → S3_ENDPOINT=https://blr1.digitaloceanspaces.com  S3_REGION=blr1
 * Cloudflare R2       → S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  S3_REGION=auto
 * Backblaze B2        → S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com  S3_REGION=us-west-004
 * MinIO (self-hosted) → S3_ENDPOINT=http://localhost:9000  S3_REGION=us-east-1
 * Wasabi              → S3_ENDPOINT=https://s3.ap-south-1.wasabisys.com  S3_REGION=ap-south-1
 * Hetzner             → S3_ENDPOINT=https://fsn1.your-objectstorage.com  S3_REGION=fsn1
 * AWS S3              → S3_ENDPOINT=(leave empty)  S3_REGION=ap-south-1
 */

const s3Config: ConstructorParameters<typeof S3Client>[0] = {
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
};

// Custom endpoint for non-AWS providers
if (env.S3_ENDPOINT) {
  s3Config.endpoint = env.S3_ENDPOINT;
  s3Config.forcePathStyle = true;
}

export const s3Client = new S3Client(s3Config);
export const S3_BUCKET = env.S3_BUCKET;
export const S3_PUBLIC_URL = env.S3_PUBLIC_URL || `${env.S3_ENDPOINT}/${env.S3_BUCKET}`;

// Allowed folders, sizes, types
export const ALLOWED_FOLDERS = ['avatars', 'bookings', 'documents', 'portfolios', 'videos'] as const;
export type UploadFolder = (typeof ALLOWED_FOLDERS)[number];

export const MAX_FILE_SIZES: Record<UploadFolder, number> = {
  avatars: 5 * 1024 * 1024, bookings: 10 * 1024 * 1024, documents: 10 * 1024 * 1024,
  portfolios: 15 * 1024 * 1024, videos: 100 * 1024 * 1024,
};

export const ALLOWED_TYPES: Record<UploadFolder, string[]> = {
  avatars: ['image/jpeg', 'image/png', 'image/webp'],
  bookings: ['image/jpeg', 'image/png', 'image/webp'],
  documents: ['image/jpeg', 'image/png', 'application/pdf'],
  portfolios: ['image/jpeg', 'image/png', 'image/webp'],
  videos: ['video/mp4', 'video/quicktime', 'video/webm'],
};
