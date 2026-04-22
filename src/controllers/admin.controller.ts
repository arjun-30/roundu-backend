// EXISTING — dashboard, providers, users, bookings, payments, reports, settings
import { Request, Response, NextFunction } from 'express';
import { AdminModel } from '../models/admin.model';
import { UserModel } from '../models/user.model';
import { success, paginated, buildPaginationMeta } from '../utils/response';
import { NotFoundError, BadRequestError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { execute, queryOne, queryMany } from '../config/database';

// ═══════════════════════════════════════════════════════════════════════════════
// GET /admin/dashboard
// Admin only — returns all platform stats
// ═══════════════════════════════════════════════════════════════════════════════
export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await AdminModel.getDashboardStats();
    return success(res, stats, 'Dashboard stats retrieved.');
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /admin/users?page=1&limit=20&search=arjun&role=customer
// Admin only — paginated user list with search
// ═══════════════════════════════════════════════════════════════════════════════
export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, search, role } = req.query as any;
    const p = parseInt(page, 10) || 1;
    const l = Math.min(parseInt(limit, 10) || 20, 100);

    const [users, total] = await Promise.all([
      UserModel.findAll(p, l, { search, role }),
      UserModel.countAll({ search, role }),
    ]);

    return paginated(res, users, buildPaginationMeta(p, l, total), 'Users retrieved.');
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /admin/users/:id/ban
// Admin only — ban or unban a user
// Body: { banned: true, reason?: "spamming" }
// ═══════════════════════════════════════════════════════════════════════════════
export async function banUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { banned, reason } = req.body;

    const user = await UserModel.findById(id);
    if (!user) throw new NotFoundError('User not found.');

    await UserModel.update(id, { isActive: !banned });

    logger.info(`User ${banned ? 'banned' : 'unbanned'}`, { userId: id, adminId: req.user!.userId, reason });

    return success(res, null, `User ${banned ? 'banned' : 'unbanned'} successfully.`);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /admin/providers?page=1&status=pending
// Admin only — list providers with approval status filter
// ═══════════════════════════════════════════════════════════════════════════════
export async function listProviders(req: Request, res: Response, next: NextFunction) {
  try {
    const p = parseInt(req.query.page as string, 10) || 1;
    const l = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const status = req.query.status as string | undefined;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (status === 'pending') { where += ` AND p.is_approved = false`; }
    else if (status === 'approved') { where += ` AND p.is_approved = true`; }

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM providers p ${where}`, params,
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await queryMany(
      `SELECT p.*, u.phone, u.name, u.avatar_url
       FROM providers p
       JOIN users u ON p.user_id = u.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, l, (p - 1) * l],
    );

    return paginated(res, rows, buildPaginationMeta(p, l, total), 'Providers retrieved.');
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /admin/providers/:id/approve
// Admin only — approve or reject a provider
// Body: { approved: true, reason?: "" }
// ═══════════════════════════════════════════════════════════════════════════════
export async function approveProvider(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { approved, reason } = req.body;

    const provider = await queryOne('SELECT * FROM providers WHERE id = $1', [id]);
    if (!provider) throw new NotFoundError('Provider not found.');

    await execute(
      'UPDATE providers SET is_approved = $1, reviewed_at = NOW(), reviewed_by = $2 WHERE id = $3',
      [approved, req.user!.userId, id],
    );

    // Also mark user as provider if approved
    if (approved) {
      await execute('UPDATE users SET is_provider = true WHERE id = $1', [(provider as any).user_id]);
    }

    logger.info(`Provider ${approved ? 'approved' : 'rejected'}`, { providerId: id, adminId: req.user!.userId, reason });

    return success(res, null, `Provider ${approved ? 'approved' : 'rejected'}.`);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /admin/documents/:id/review
// Admin only — approve or reject a KYC document
// Body: { status: "approved" | "rejected", notes?: "" }
// ═══════════════════════════════════════════════════════════════════════════════
export async function reviewDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const doc = await queryOne('SELECT * FROM provider_documents WHERE id = $1', [id]);
    if (!doc) throw new NotFoundError('Document not found.');

    await execute(
      'UPDATE provider_documents SET status = $1, notes = $2, reviewed_at = NOW(), reviewed_by = $3 WHERE id = $4',
      [status, notes ?? null, req.user!.userId, id],
    );

    logger.info(`Document ${status}`, { documentId: id, adminId: req.user!.userId });

    return success(res, null, `Document ${status}.`);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /admin/settings
// Admin only — list all platform settings
// ═══════════════════════════════════════════════════════════════════════════════
export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await AdminModel.getAllSettings();
    return success(res, settings, 'Settings retrieved.');
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /admin/settings/:key
// Admin only — update a platform setting
// Body: { value: "15" }
// ═══════════════════════════════════════════════════════════════════════════════
export async function updateSetting(req: Request, res: Response, next: NextFunction) {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const existing = await AdminModel.getSetting(key);
    if (existing === null) throw new NotFoundError(`Setting "${key}" not found.`);

    await AdminModel.updateSetting(key, value);

    logger.info('Platform setting updated', { key, value, adminId: req.user!.userId });

    return success(res, { key, value }, 'Setting updated.');
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /admin/reports/revenue?startDate=2026-01-01&endDate=2026-04-01
// Admin only — revenue report by date
// ═══════════════════════════════════════════════════════════════════════════════
export async function revenueReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { startDate, endDate } = req.query as { startDate: string; endDate: string };

    if (!startDate || !endDate) throw new BadRequestError('startDate and endDate required.');

    const report = await AdminModel.revenueReport(startDate, endDate);

    const totals = report.reduce(
      (acc, r) => ({ bookings: acc.bookings + r.bookings, revenue: acc.revenue + r.revenue, fees: acc.fees + r.fees }),
      { bookings: 0, revenue: 0, fees: 0 },
    );

    return success(res, { daily: report, totals }, 'Revenue report generated.');
  } catch (err) {
    next(err);
  }
}
