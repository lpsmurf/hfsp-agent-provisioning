/**
 * $GRID token tier checker
 * Mint address and tier thresholds are configured via env / secrets.
 * Placeholders are used until they are set.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// ── Config ────────────────────────────────────────────────────────────────────
// Set GRID_TOKEN_MINT in environment or update here once known.
const GRID_MINT = process.env.GRID_TOKEN_MINT ?? '';

// Tier thresholds (raw token amount, accounting for decimals)
// Fill in once $GRID decimals and amounts are confirmed.
export const GRID_TIERS = [
  { tier: 'node',     minBalance: 10_000, label: 'Node',     emoji: '🔮', maxAgents: 10 },
  { tier: 'operator', minBalance:  1_000, label: 'Operator', emoji: '⚡', maxAgents:  3 },
  { tier: 'starter',  minBalance:      1, label: 'Starter',  emoji: '🌱', maxAgents:  1 },
  { tier: 'none',     minBalance:      0, label: 'Free',     emoji: '👀', maxAgents:  0 },
] as const;

export type GridTier = typeof GRID_TIERS[number]['tier'];

// ── RPC ───────────────────────────────────────────────────────────────────────
function getRpc(): string {
  // Prefer Helius if key is set, fall back to public mainnet
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  return 'https://api.mainnet-beta.solana.com';
}

export interface GridTierResult {
  wallet: string;
  balance: number;       // raw balance (adjusted for decimals)
  tier: GridTier;
  label: string;
  emoji: string;
  maxAgents: number;
  mintConfigured: boolean;
}

/** Get $GRID balance and tier for a Solana wallet */
export async function getGridTier(walletAddress: string): Promise<GridTierResult> {
  const base: GridTierResult = {
    wallet: walletAddress,
    balance: 0,
    tier: 'none',
    label: 'Free',
    emoji: '👀',
    maxAgents: 0,
    mintConfigured: false,
  };

  if (!GRID_MINT) return base;
  base.mintConfigured = true;

  try {
    const conn = new Connection(getRpc(), 'confirmed');
    const owner = new PublicKey(walletAddress);
    const mint = new PublicKey(GRID_MINT);
    const ata = getAssociatedTokenAddressSync(mint, owner);

    const account = await getAccount(conn, ata, 'confirmed', TOKEN_PROGRAM_ID);
    // Assume 6 decimals; override with GRID_TOKEN_DECIMALS if different
    const decimals = Number(process.env.GRID_TOKEN_DECIMALS ?? '6');
    const balance = Number(account.amount) / Math.pow(10, decimals);
    base.balance = balance;

    for (const t of GRID_TIERS) {
      if (balance >= t.minBalance) {
        base.tier = t.tier;
        base.label = t.label;
        base.emoji = t.emoji;
        base.maxAgents = t.maxAgents;
        break;
      }
    }
  } catch (err: any) {
    // Token account doesn't exist = zero balance → stays 'none' tier
    if (!err?.message?.includes('could not find account')) {
      console.warn('[grid-tier] RPC error:', err?.message);
    }
  }

  return base;
}

/** Human-readable tier summary */
export function formatTierSummary(result: GridTierResult): string {
  if (!result.mintConfigured) {
    return '⚙️ $GRID tier checking not yet configured.';
  }
  const lines = [
    `${result.emoji} *${result.label} tier*`,
    `Balance: \`${result.balance.toLocaleString()} $GRID\``,
  ];
  if (result.tier !== 'none') {
    lines.push(`Unlocks: ${result.maxAgents} agent${result.maxAgents > 1 ? 's' : ''}`);
  }
  return lines.join('\n');
}
