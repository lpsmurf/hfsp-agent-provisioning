/**
 * NOWPayments API client
 * Docs: https://documenter.getpostman.com/view/7907941/2s93JtP3F6
 */
import { createHmac } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

function loadSecret(filename: string): string {
  const p = path.join(process.env.HOME ?? '/home/hfsp', '.openclaw/secrets', filename);
  if (!existsSync(p)) throw new Error(`Secret not found: ${filename}`);
  return readFileSync(p, 'utf8').trim();
}

const BASE = 'https://api.nowpayments.io/v1';

function apiKey(): string { return loadSecret('nowpayments.key'); }
function ipnSecret(): string { return loadSecret('nowpayments_ipn.secret'); }

async function request<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(`NOWPayments ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

export interface NpPayment {
  payment_id: string;
  payment_status: string;   // waiting | confirming | confirmed | sending | finished | failed | expired
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  expiration_estimate_date: string;
  created_at: string;
}

export interface NpIpnPayload {
  payment_id: number;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  actually_paid: number;
  order_id: string;
  order_description: string;
  outcome_amount?: number;
}

/** Create a payment invoice */
export async function createInvoice(opts: {
  priceUsd: number;
  payCurrency: string;
  orderId: string;
  description: string;
  callbackUrl: string;
}): Promise<NpPayment> {
  return request<NpPayment>('POST', '/payment', {
    price_amount: opts.priceUsd,
    price_currency: 'usd',
    pay_currency: opts.payCurrency,
    order_id: opts.orderId,
    order_description: opts.description,
    ipn_callback_url: opts.callbackUrl,
    is_fixed_rate: false,
    is_fee_paid_by_user: false,
  });
}

/** Get payment status */
export async function getPayment(paymentId: string): Promise<NpPayment> {
  return request<NpPayment>('GET', `/payment/${paymentId}`);
}

/** Get minimum payment amount for a currency */
export async function getMinAmount(currency: string): Promise<number> {
  const data = await request<{ min_amount: number }>('GET', `/min-amount?currency_from=${currency}&currency_to=usd&fiat_equivalent=usd`);
  return data.min_amount;
}

/** Get estimated price in crypto for a USD amount */
export async function getEstimatedPrice(amountUsd: number, currency: string): Promise<number> {
  const data = await request<{ estimated_amount: number }>('GET', `/estimate?amount=${amountUsd}&currency_from=usd&currency_to=${currency}`);
  return data.estimated_amount;
}

/**
 * Verify IPN webhook signature.
 * NOWPayments signs with HMAC-SHA512 of the JSON payload sorted by keys.
 */
export function verifyIpnSignature(rawBody: string, signature: string): boolean {
  try {
    const secret = ipnSecret();
    const sorted = JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(rawBody)).sort(([a], [b]) => a.localeCompare(b)))
    );
    const expected = createHmac('sha512', secret).update(sorted).digest('hex');
    return expected === signature;
  } catch {
    return false;
  }
}

/** Check if a payment status counts as confirmed/paid */
export function isConfirmed(status: string): boolean {
  return ['confirmed', 'finished'].includes(status);
}

export function isFailed(status: string): boolean {
  return ['failed', 'expired', 'refunded'].includes(status);
}
