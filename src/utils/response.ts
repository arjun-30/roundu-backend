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
}