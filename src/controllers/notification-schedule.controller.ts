// DEV 2 — getSchedule(bookingId), triggerManualCall(admin)
// Owner: Dev 2 — Subscriptions + Notifications
import { Request, Response, NextFunction } from 'express';
import { ScheduledNotification } from '../models/scheduled-notification.model';
import { Notification } from '../models/notification.model';
import { success } from '../utils/response';
import { Op } from 'sequelize';

// GET /api/notifications
export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const { read, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { userId: req.user!.id };
    if (read !== undefined) where.isRead = read === 'true';

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, parseInt(limit));

    const { rows, count } = await Notification.findAndCountAll({
      where,
      order:  [['createdAt', 'DESC']],
      limit:  limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    res.json(success({ data: rows, total: count, page: pageNum, limit: limitNum }));
  } catch (err) { next(err); }
}

// PATCH /api/notifications/:id/read
export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const notif = await Notification.findOne({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!notif) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Notification not found' } });

    await notif.update({ isRead: true, readAt: new Date() });
    res.json(success(notif));
  } catch (err) { next(err); }
}

// POST /api/notifications/schedule  (admin only)
export async function scheduleNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, title, body, scheduledAt } = req.body;
    const sn = await ScheduledNotification.create({
      userId,
      title,
      body,
      scheduledAt: new Date(scheduledAt),
      createdBy:   req.user!.id,
    });
    res.status(201).json(success(sn));
  } catch (err) { next(err); }
}
