# Payment System Integration Guide

## Database Tables Required

Add these to storefront-bot initialization:

```sql
CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ton', 'nowpayments', 'manual', 'phantom')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirming', 'confirmed', 'failed', 'expired')),
  price_usd REAL NOT NULL,
  currency TEXT NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  reference TEXT,  -- JSON: invoice details
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id),
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
);

CREATE INDEX idx_payments_user ON payments(telegram_user_id);
CREATE INDEX idx_subscriptions_user ON subscriptions(telegram_user_id);
```

## Environment Variables

Add to `.env` or deployment config:

```bash
# TON Wallet
TON_WALLET_ADDRESS=UQAohzcqe8ov...

# Crypto Wallets (for manual payments)
BTC_WALLET_ADDRESS=1A1z7agoat2x...
ETH_WALLET_ADDRESS=0x742d35Cc6634...
SOL_WALLET_ADDRESS=4K3Dyjzvzp8e...
USDC_WALLET_ADDRESS=0x742d35Cc6634...

# Phantom Wallet (optional - client-side only)
# No server-side config needed for Phantom

# NOWPayments (already configured)
# nowpayments.key secret
# nowpayments_ipn.secret file
```

## API Routes Overview

### Trial Codes

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/payments/trial-code/apply` | POST | ✅ User | Redeem a trial code |
| `/api/payments/trial-code/status` | GET | ✅ User | Check user's trial status |
| `/api/payments/trial-code/generate` | POST | ⚠️ Admin | Generate codes in bulk |
| `/api/payments/trial-code/list` | GET | ⚠️ Admin | View all codes + stats |

### Newsletter

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/payments/newsletter/subscribe` | POST | ❌ None | Email signup → auto-issue code |
| `/api/payments/newsletter/stats` | GET | ⚠️ Admin | Subscriber metrics |

### Payments

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/payments/ton/invoice` | POST | ✅ User | Create TON payment invoice |
| `/api/payments/manual/invoice` | POST | ✅ User | Create manual crypto invoice |
| `/api/payments/nowpayments/invoice` | POST | ✅ User | Create NOWPayments invoice |
| `/api/payments/verify/:paymentId` | POST | ✅ User | Check status + activate subscription |

Legend: ✅ = Requires user auth | ⚠️ = Admin only | ❌ = Public

## Implementation Checklist

- [ ] Add database tables (payments, subscriptions)
- [ ] Add environment variables for wallets
- [ ] Import payment system modules
- [ ] Add trial code routes
- [ ] Add newsletter routes  
- [ ] Add payment invoice routes
- [ ] Add payment verification routes
- [ ] Test trial code flow (end-to-end)
- [ ] Test TON invoice generation
- [ ] Test NOWPayments integration
- [ ] Test manual crypto display
- [ ] Add email sending for newsletter (optional)
- [ ] Add Telegram notifications on payment
- [ ] Create admin dashboard for codes + subscriptions
- [ ] Add subscription expiry checks to agent creation

## Mini App Integration

The Paywall component calls these endpoints:

```typescript
// Trial code redemption
POST /api/payments/trial-code/apply { code: "TRIAL-ABC123" }

// Newsletter signup
POST /api/payments/newsletter/subscribe { email: "user@example.com" }

// Create payment
POST /api/payments/{ton,manual,nowpayments}/invoice { 
  priceUsd: 49, 
  planId: "operator_monthly" 
}

// Check payment status
POST /api/payments/verify/:paymentId
```

## User Flow

1. **Free Trial Path**
   - User enters app
   - No subscription? Show Paywall
   - User enters trial code → Validated
   - 15 days of access granted
   - Database tracks expiry

2. **Newsletter Path**
   - User clicks "Subscribe to newsletter"
   - Enters email
   - Auto-issued 14-day trial code
   - Can immediately redeem code

3. **Payment Path**
   - User chooses plan (Starter/$9, Operator/$29, Node/$59)
   - Selects payment method (TON / NOWPayments / Manual)
   - Receives invoice or deep link
   - Payment confirmed → Subscription created
   - 30-day access + more agents

## Testing

```bash
# Generate trial codes for testing
curl -X POST 'http://localhost:3000/api/payments/trial-code/generate?count=10&durationDays=15'

# View generated codes
curl 'http://localhost:3000/api/payments/trial-code/list'

# View newsletter stats
curl 'http://localhost:3000/api/payments/newsletter/stats'
```

## Webhook Handlers (To Implement)

### NOWPayments IPN
```
POST /api/payments/nowpayments/callback
- Signature verification
- Update payment status
- Activate subscription if confirmed
```

### TON Explorer (polling-based)
```
POST /api/payments/verify/:paymentId
- Check blockchain for tx
- Update status
- Activate subscription
```

## Next Steps

1. Add routes to storefront-bot/src/index.ts (see /tmp/payment-routes.ts)
2. Create payments + subscriptions tables
3. Test trial code flow
4. Deploy to production
5. Monitor payment confirmations
6. Add email notifications
