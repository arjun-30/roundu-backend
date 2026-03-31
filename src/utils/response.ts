// src/utils/response.ts
// Owner: Lead
// Thin wrappers so every controller returns the same envelope shape

import { Response } from "express";

export function ok(res: Response, data: unknown = null, message = "Success") {
  return res.status(200).json({ success: true, data, message, error: null });
}

export function created(res: Response, data: unknown = null, message = "Created") {
  return res.status(201).json({ success: true, data, message, error: null });
}

export function noContent(res: Response) {
  return res.status(204).send();
}import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message: string;
  error: string | null;
}

export function success<T>(res: Response, data: T, message = 'Success'): Response {
  return res.status(200).json({ success: true, data, message, error: null });
}

export function created<T>(res: Response, data: T, message = 'Created'): Response {
  return res.status(201).json({ success: true, data, message, error: null });
}

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
  const totalPages = Math.ceil(totalCount / limit);
  return {
    currentPage: page,
    totalPages,
    totalCount,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
