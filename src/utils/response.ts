// src/utils/response.ts
// Owner: Lead
// Thin wrappers so every controller returns the same envelope shape.

import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message: string;
  error: string | null;
}

// ── 2xx helpers ──────────────────────────────────────────────────────────────

export function ok<T = unknown>(res: Response, data: T = null as T, message = 'Success'): Response {
  return res.status(200).json({ success: true, data, message, error: null });
}

export function created<T = unknown>(res: Response, data: T = null as T, message = 'Created'): Response {
  return res.status(201).json({ success: true, data, message, error: null });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

// ── Alias for controllers that were written against `sendSuccess` ────────────
// Several controllers (referral, tracking, etc.) import `sendSuccess`; keep the
// alias so existing code keeps working.
export const sendSuccess = ok;
export const success = ok;

// ── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function paginated<T>(res: Response, data: T[], meta: PaginationMeta, message = 'Success'): Response {
  return res.status(200).json({ success: true, data, meta, message, error: null });
}

export function buildPaginationMeta(page: number, limit: number, totalCount: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(totalCount / limit) : 0;
  return {
    currentPage: page,
    totalPages,
    totalCount,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
