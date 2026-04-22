// TECH LEAD — Check provider isApproved + isOnline
import { Request, Response, NextFunction } from 'express';

export const requireProvider = (req: Request, res: Response, next: NextFunction) => {
  // Assuming your auth middleware attaches the verified user to req.user
  const user = req.user;

  if (!user || user.role !== 'provider') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'This action requires provider privileges.',
        details: {}
      }
    });
  }

  next();
};
