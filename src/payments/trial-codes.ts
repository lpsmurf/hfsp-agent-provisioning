/**
 * Trial Code System
 * Generate promotional codes, track usage, manage newsletter signups
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

export interface TrialCode {
  code: string;
  durationDays: number;
  maxUses: number;
  currentUses: number;
  expiresAt: string;
  createdAt: string;
  usedBy?: number[];  // List of telegram_user_ids
  status: 'active' | 'expired' | 'maxed_out';
}

export interface TrialCodeUsage {
  code: string;
  telegramUserId: number;
  usedAt: string;
}

export interface NewsletterSubscriber {
  email: string;
  telegramUserId?: number;
  trialCodeIssued?: string;
  subscribedAt: string;
  active: boolean;
}

/**
 * Initialize trial codes and newsletter tables
 */
export function initTrialCodeTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trial_codes (
      code TEXT PRIMARY KEY,
      duration_days INTEGER NOT NULL DEFAULT 7,
      max_uses INTEGER NOT NULL DEFAULT 1000,
      current_uses INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'maxed_out'))
    );

    CREATE TABLE IF NOT EXISTS trial_code_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      used_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (code) REFERENCES trial_codes(code),
      UNIQUE (code, telegram_user_id)
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      email TEXT PRIMARY KEY,
      telegram_user_id INTEGER,
      trial_code_issued TEXT,
      subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (trial_code_issued) REFERENCES trial_codes(code)
    );

    CREATE TABLE IF NOT EXISTS trial_expiry (
      telegram_user_id INTEGER PRIMARY KEY,
      expires_at TEXT NOT NULL,
      code_used TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Generate a promotional trial code
 * Format: TRIAL-XXXXX (human-readable, easy to share)
 */
export function generateTrialCode(opts: {
  durationDays?: number;
  maxUses?: number;
  expiresAfterDays?: number;
}): string {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  return `TRIAL-${random}`;
}

/**
 * Create trial codes (admin function)
 */
export function createTrialCodes(
  db: Database.Database,
  count: number,
  opts: {
    durationDays?: number;
    maxUses?: number;
    expiresAfterDays?: number;
  } = {}
): string[] {
  const durationDays = opts.durationDays || 7;
  const maxUses = opts.maxUses || 1000;
  const expiresAfterDays = opts.expiresAfterDays || 30;
  
  const expiresAt = new Date(Date.now() + expiresAfterDays * 86400000).toISOString();
  const codes: string[] = [];
  
  const stmt = db.prepare(`
    INSERT INTO trial_codes (code, duration_days, max_uses, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  
  for (let i = 0; i < count; i++) {
    let code: string;
    let attempts = 0;
    
    // Ensure unique code
    do {
      code = generateTrialCode();
      attempts++;
    } while (db.prepare('SELECT 1 FROM trial_codes WHERE code = ?').get(code) && attempts < 100);
    
    if (attempts >= 100) throw new Error('Could not generate unique code');
    
    stmt.run(code, durationDays, maxUses, expiresAt);
    codes.push(code);
  }
  
  return codes;
}

/**
 * Validate and apply a trial code
 */
export function applyTrialCode(
  db: Database.Database,
  code: string,
  telegramUserId: number
): { success: boolean; message: string; expiryDate?: string } {
  // Check code exists and is active
  const codeRow = db.prepare(
    `SELECT * FROM trial_codes WHERE code = ? AND status = 'active' AND expires_at > datetime('now')`
  ).get(code) as any;
  
  if (!codeRow) {
    return { success: false, message: 'Invalid or expired trial code' };
  }
  
  // Check max uses
  if (codeRow.current_uses >= codeRow.max_uses) {
    db.prepare('UPDATE trial_codes SET status = ? WHERE code = ?').run('maxed_out', code);
    return { success: false, message: 'Trial code has reached max uses' };
  }
  
  // Check if user already used this code
  const existing = db.prepare(
    'SELECT 1 FROM trial_code_usage WHERE code = ? AND telegram_user_id = ?'
  ).get(code, telegramUserId);
  
  if (existing) {
    return { success: false, message: 'You already used this trial code' };
  }
  
  // Apply trial
  db.prepare(
    'INSERT INTO trial_code_usage (code, telegram_user_id) VALUES (?, ?)'
  ).run(code, telegramUserId);
  
  db.prepare(
    'UPDATE trial_codes SET current_uses = current_uses + 1 WHERE code = ?'
  ).run(code);
  
  // Set trial expiry
  const expiresAt = new Date(Date.now() + codeRow.duration_days * 86400000).toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO trial_expiry (telegram_user_id, expires_at, code_used)
    VALUES (?, ?, ?)
  `).run(telegramUserId, expiresAt, code);
  
  return {
    success: true,
    message: `Trial activated! Access for ${codeRow.duration_days} days`,
    expiryDate: expiresAt
  };
}

/**
 * Check if user has active trial
 */
export function getUserTrialStatus(db: Database.Database, telegramUserId: number): {
  isActive: boolean;
  expiresAt?: string;
  daysRemaining?: number;
} {
  const row = db.prepare(
    `SELECT expires_at FROM trial_expiry WHERE telegram_user_id = ? AND expires_at > datetime('now')`
  ).get(telegramUserId) as any;
  
  if (!row) {
    return { isActive: false };
  }
  
  const expiresAt = new Date(row.expires_at);
  const now = new Date();
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 86400));
  
  return {
    isActive: true,
    expiresAt: row.expires_at,
    daysRemaining
  };
}

/**
 * Newsletter signup - generate trial code
 */
export function subscribeToNewsletter(
  db: Database.Database,
  email: string,
  telegramUserId?: number
): { success: boolean; trialCode: string } {
  // Check if already subscribed
  const existing = db.prepare('SELECT 1 FROM newsletter_subscribers WHERE email = ?').get(email);
  
  if (existing) {
    return { success: false, trialCode: '' };
  }
  
  // Generate trial code
  const code = generateTrialCode();
  
  // Insert code
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare(`
    INSERT INTO trial_codes (code, duration_days, max_uses, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(code, 14, 1, expiresAt);
  
  // Subscribe
  db.prepare(`
    INSERT INTO newsletter_subscribers (email, telegram_user_id, trial_code_issued)
    VALUES (?, ?, ?)
  `).run(email, telegramUserId || null, code);
  
  return { success: true, trialCode: code };
}

/**
 * Get all trial codes (admin dashboard)
 */
export function getAllTrialCodes(db: Database.Database) {
  return db.prepare(`
    SELECT code, duration_days, max_uses, current_uses, expires_at, status, created_at
    FROM trial_codes
    ORDER BY created_at DESC
  `).all() as TrialCode[];
}

/**
 * Get newsletter stats
 */
export function getNewsletterStats(db: Database.Database) {
  const total = (db.prepare('SELECT COUNT(*) as count FROM newsletter_subscribers WHERE active = 1').get() as any).count;
  const redeemed = (db.prepare('SELECT COUNT(DISTINCT email) as count FROM newsletter_subscribers WHERE trial_code_issued IS NOT NULL').get() as any).count;
  
  return { total, redeemed, redemptionRate: total > 0 ? ((redeemed / total) * 100).toFixed(1) + '%' : '0%' };
}
