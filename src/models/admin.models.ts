import { queryOne, queryMany, execute } from '../config/database';

// ── Dashboard Stats ─────────────────────────────────────────────────────────
export interface DashboardStats {
  totalUsers: number;
  totalProviders: number;
  totalBookings: number;
  activeBookings: number;
  totalRevenue: number;        // paise
  todayBookings: number;
  todayRevenue: number;        // paise
  pendingApprovals: number;
  pendingDocuments: number;
}

// ── Platform Setting ────────────────────────────────────────────────────────
export interface PlatformSetting {
  key: string;
  value: string;
  description: string;
  updatedAt: string;
}

export const AdminModel = {

  async getDashboardStats(): Promise<DashboardStats> {
    const [users, providers, bookings, active, revenue, today, todayRev, pendingApproval, pendingDocs] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM providers WHERE is_approved = true'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM bookings'),
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM bookings WHERE status IN ('pending','accepted','confirmed','on_the_way','arrived','in_progress')",
      ),
      queryOne<{ total: string }>(
        "SELECT COALESCE(SUM(platform_fee), 0) as total FROM bookings WHERE payment_status = 'paid'",
      ),
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM bookings WHERE created_at >= CURRENT_DATE",
      ),
      queryOne<{ total: string }>(
        "SELECT COALESCE(SUM(platform_fee), 0) as total FROM bookings WHERE payment_status = 'paid' AND created_at >= CURRENT_DATE",
      ),
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM providers WHERE is_approved = false",
      ),
      queryOne<{ count: string }>(
        "SELECT COUNT(*) as count FROM provider_documents WHERE status = 'pending'",
      ),
    ]);

    return {
      totalUsers: parseInt(users?.count ?? '0', 10),
      totalProviders: parseInt(providers?.count ?? '0', 10),
      totalBookings: parseInt(bookings?.count ?? '0', 10),
      activeBookings: parseInt(active?.count ?? '0', 10),
      totalRevenue: parseInt(revenue?.total ?? '0', 10),
      todayBookings: parseInt(today?.count ?? '0', 10),
      todayRevenue: parseInt(todayRev?.total ?? '0', 10),
      pendingApprovals: parseInt(pendingApproval?.count ?? '0', 10),
      pendingDocuments: parseInt(pendingDocs?.count ?? '0', 10),
    };
  },

  // ── Platform Settings ──

  async getAllSettings(): Promise<PlatformSetting[]> {
    const rows = await queryMany<{ key: string; value: string; description: string; updated_at: Date }>(
      'SELECT * FROM platform_settings ORDER BY key',
    );
    return rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updated_at.toISOString() }));
  },

  async getSetting(key: string): Promise<string | null> {
    const row = await queryOne<{ value: string }>('SELECT value FROM platform_settings WHERE key = $1', [key]);
    return row?.value ?? null;
  },

  async updateSetting(key: string, value: string): Promise<void> {
    await execute(
      'UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [value, key],
    );
  },

  // ── Revenue report ──

  async revenueReport(startDate: string, endDate: string): Promise<{ date: string; bookings: number; revenue: number; fees: number }[]> {
    const rows = await queryMany<{ date: string; bookings: string; revenue: string; fees: string }>(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as bookings,
        COALESCE(SUM(total_amount), 0) as revenue,
        COALESCE(SUM(platform_fee), 0) as fees
      FROM bookings
      WHERE payment_status = 'paid'
        AND created_at >= $1
        AND created_at < $2
      GROUP BY DATE(created_at)
      ORDER BY date DESC`,
      [startDate, endDate],
    );
    return rows.map((r) => ({
      date: r.date,
      bookings: parseInt(r.bookings, 10),
      revenue: parseInt(r.revenue, 10),
      fees: parseInt(r.fees, 10),
    }));
  },
};
