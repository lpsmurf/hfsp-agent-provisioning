/** ClawDrop pricing plans */

export type Tier = 'starter' | 'operator' | 'node';
export type Billing = 'monthly' | 'yearly';

export interface Plan {
  id: string;
  name: string;
  tier: Tier;
  billing: Billing;
  priceUsd: number;
  maxAgents: number;
  modelAccess: 'fast' | 'any';
  description: string;
  emoji: string;
}

export const PLANS: Record<string, Plan> = {
  starter_monthly:  { id: 'starter_monthly',  name: 'Starter',  tier: 'starter',  billing: 'monthly', priceUsd: 19,  maxAgents: 1,  modelAccess: 'fast', emoji: '🌱', description: '1 agent · Fast models · Monthly' },
  starter_yearly:   { id: 'starter_yearly',   name: 'Starter',  tier: 'starter',  billing: 'yearly',  priceUsd: 179, maxAgents: 1,  modelAccess: 'fast', emoji: '🌱', description: '1 agent · Fast models · Yearly (save 21%)' },
  operator_monthly: { id: 'operator_monthly', name: 'Operator', tier: 'operator', billing: 'monthly', priceUsd: 49,  maxAgents: 3,  modelAccess: 'any',  emoji: '⚡', description: '3 agents · Any model · Monthly' },
  operator_yearly:  { id: 'operator_yearly',  name: 'Operator', tier: 'operator', billing: 'yearly',  priceUsd: 469, maxAgents: 3,  modelAccess: 'any',  emoji: '⚡', description: '3 agents · Any model · Yearly (save 20%)' },
  node_monthly:     { id: 'node_monthly',     name: 'Node',     tier: 'node',     billing: 'monthly', priceUsd: 99,  maxAgents: 10, modelAccess: 'any',  emoji: '🔮', description: '10 agents · Any model · Priority · Monthly' },
  node_yearly:      { id: 'node_yearly',      name: 'Node',     tier: 'node',     billing: 'yearly',  priceUsd: 949, maxAgents: 10, modelAccess: 'any',  emoji: '🔮', description: '10 agents · Any model · Priority · Yearly (save 20%)' },
};

export const CURRENCIES = [
  { code: 'btc',  label: 'Bitcoin',   emoji: '₿' },
  { code: 'eth',  label: 'Ethereum',  emoji: 'Ξ' },
  { code: 'sol',  label: 'Solana',    emoji: '◎' },
  { code: 'usdc', label: 'USDC',      emoji: '💵' },
];

export function getPlan(id: string): Plan {
  const p = PLANS[id];
  if (!p) throw new Error(`Unknown plan: ${id}`);
  return p;
}

export function plansByTier(tier: Tier): Plan[] {
  return Object.values(PLANS).filter(p => p.tier === tier);
}

export function billingDays(billing: Billing): number {
  return billing === 'yearly' ? 365 : 30;
}

export function formatPlanCard(plan: Plan): string {
  const save = plan.billing === 'yearly'
    ? ` _(save ~20%)_`
    : '';
  return `${plan.emoji} *${plan.name}* — $${plan.priceUsd}/${plan.billing === 'monthly' ? 'mo' : 'yr'}${save}\n` +
    `  • ${plan.maxAgents} agent${plan.maxAgents > 1 ? 's' : ''}\n` +
    `  • ${plan.modelAccess === 'any' ? 'Any model (GPT-4o, Claude Opus, etc.)' : 'Fast models (GPT-4o-mini, Haiku)'}\n` +
    (plan.tier === 'node' ? '  • Priority support\n' : '');
}
