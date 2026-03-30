// src/middleware/validate.ts
// Owner: Lead
// Zod schema middleware — validates req.body / req.params / req.query

import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";
import { Errors } from "./errorHandler";

export function validate(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body:   req.body,
        params: req.params,
        query:  req.query,
      });
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