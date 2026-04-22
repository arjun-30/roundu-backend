// src/middleware/validate.ts
// Owner: Lead
// Zod schema middleware — validates req.body / req.params / req.query and
// writes any transformed values (trim, toUpperCase, defaults, etc.) back onto
// the request so downstream handlers see the canonicalized data.

import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";
import { Errors } from "./errorHandler";

export function validate(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = (await schema.parseAsync({
        body:   req.body,
        params: req.params,
        query:  req.query,
      })) as { body?: unknown; params?: unknown; query?: unknown };

      if (parsed.body !== undefined) {
        req.body = parsed.body;
      }
      if (parsed.params !== undefined) {
        req.params = parsed.params as Request["params"];
      }
      if (parsed.query !== undefined) {
        // Express 5 makes req.query a getter — defineProperty works around it.
        Object.defineProperty(req, "query", { value: parsed.query, writable: true });
      }

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = Object.fromEntries(
          err.issues.map((i) => [i.path.slice(1).join("."), i.message])
        );
        return next(Errors.badRequest("Validation failed", details));
      }
      next(err);
    }
  };
}
