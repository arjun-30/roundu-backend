// Owner: Lead
// Purpose: Role-gate middleware --- use after authenticate
// Usage: router.delete("/admin/users/:id", authenticate, requireRole("admin"), handler)

import { Request, Response, NextFunction } from "express";
import { Errors } from "./errorHandler";
import type { UserRole } from "../models/user.model";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(Errors.unauthorized());
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return next(
        Errors.forbidden(
          `Access restricted to: ${roles.join(", ")}`
        )
      );
    }

    next();
  };
}
