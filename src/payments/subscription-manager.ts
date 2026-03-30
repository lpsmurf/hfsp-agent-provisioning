import Database from 'better-sqlite3';
import { billingDays, getPlan } from './plans';

export type SubStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'past_due';

export interface Subscription {
  id: string;
  telegram_user_id: number;
  plan_id: string;
  status: SubStatus;
  period_start: string | null;
  period_end: string | null;
  cancel_at_period_end: number;
  created_at: string;
  updated_at: string;
}

export class SubscriptionManager {
  constructor(private db: Database.Database) {}

  /** Get the current active subscription for a user, or null */
  getActive(telegramUserId: number): Subscription | null {
    return this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE telegram_user_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get(telegramUserId) as Subscription | null;
  }

  /** Get pending subscription (waiting for first payment) */
  getPending(telegramUserId: number): Subscription | null {
    return this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE telegram_user_id = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `).get(telegramUserId) as Subscription | null;
  }

  /** Create a new pending subscription */
  create(telegramUserId: number, planId: string): Subscription {
    const id = `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    this.db.prepare(`
      INSERT INTO subscriptions (id, telegram_user_id, plan_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, telegramUserId, planId);
    return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as Subscription;
  }

  /** Activate a subscription after successful payment */
  activate(subscriptionId: string): Subscription {
    const sub = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as Subscription;
    if (!sub) throw new Error(`Subscription not found: ${subscriptionId}`);
    const plan = getPlan(sub.plan_id);
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + billingDays(plan.billing));
    this.db.prepare(`
      UPDATE subscriptions
      SET status = 'active',
          period_start = ?,
          period_end = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(now.toISOString(), end.toISOString(), subscriptionId);
    return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as Subscription;
  }

  /** Renew an active subscription by extending period_end */
  renew(subscriptionId: string): Subscription {
    const sub = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as Subscription;
    if (!sub) throw new Error(`Subscription not found: ${subscriptionId}`);
    const plan = getPlan(sub.plan_id);
    const base = sub.period_end ? new Date(sub.period_end) : new Date();
    base.setDate(base.getDate() + billingDays(plan.billing));
    this.db.prepare(`
      UPDATE subscriptions
      SET status = 'active', period_end = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(base.toISOString(), subscriptionId);
    return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId) as Subscription;
  }

  /** Mark expired subscriptions (run periodically) */
  expireStale(): number {
    const result = this.db.prepare(`
      UPDATE subscriptions
      SET status = 'expired', updated_at = datetime('now')
      WHERE status = 'active'
        AND period_end < datetime('now')
    `).run();
    return result.changes;
  }

  /** Get subscriptions expiring within N days (for renewal reminders) */
  getExpiringSoon(days = 3): Subscription[] {
    return this.db.prepare(`
      SELECT * FROM subscriptions
      WHERE status = 'active'
        AND period_end <= datetime('now', '+${days} days')
        AND period_end > datetime('now')
    `).all() as Subscription[];
  }

  /** Check if user can provision (has active subscription with capacity) */
  canProvision(telegramUserId: number): { allowed: boolean; reason?: string; plan?: ReturnType<typeof getPlan> } {
    const sub = this.getActive(telegramUserId);
    if (!sub) return { allowed: false, reason: 'no_subscription' };
    const plan = getPlan(sub.plan_id);

    // Check how many active agents they have
    const activeAgents = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM tenants
      WHERE telegram_user_id = ? AND status IN ('active','provisioning') AND deleted_at IS NULL
    `).get(telegramUserId) as any).cnt ?? 0;

    if (activeAgents >= plan.maxAgents) {
      return { allowed: false, reason: 'agent_limit', plan };
    }
    return { allowed: true, plan };
  }
}
