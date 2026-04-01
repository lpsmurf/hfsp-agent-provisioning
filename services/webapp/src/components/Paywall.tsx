import React, { useState } from 'react';
import { Button } from './shared';
import { PaymentSelector } from './PaymentSelector';

export interface PricingTier {
  id: string;
  name: string;
  emoji: string;
  price: number;
  billing: 'monthly' | 'yearly';
  maxAgents: number;
  features: string[];
  popular?: boolean;
}

const TIERS: PricingTier[] = [
  {
    id: 'starter_monthly',
    name: 'Starter',
    emoji: '🌱',
    price: 19,
    billing: 'monthly',
    maxAgents: 1,
    features: ['1 Agent', 'Fast Models', 'Community Support'],
  },
  {
    id: 'operator_monthly',
    name: 'Operator',
    emoji: '⚡',
    price: 49,
    billing: 'monthly',
    maxAgents: 3,
    features: ['3 Agents', 'All Models', 'Email Support'],
    popular: true,
  },
  {
    id: 'node_monthly',
    name: 'Node',
    emoji: '🔮',
    price: 99,
    billing: 'monthly',
    maxAgents: 10,
    features: ['10 Agents', 'All Models', 'Priority Support'],
  },
];

interface PaywallProps {
  userTrial?: { isActive: boolean; daysRemaining?: number };
  onUpgrade: (tierId: string, paymentMethod: string) => void;
  loading?: boolean;
}

export const Paywall: React.FC<PaywallProps> = ({ userTrial, onUpgrade, loading = false }) => {
  const [selectedTier, setSelectedTier] = useState<string>('operator_monthly');
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const tier = TIERS.find(t => t.id === selectedTier);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 flex flex-col">
      {/* Header */}
      <div className="text-center mb-8 mt-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Upgrade Your Plan
        </h1>
        <p className="text-gray-600">
          {userTrial?.isActive
            ? `🎁 Trial active for ${userTrial.daysRemaining} days`
            : 'Choose a plan to deploy unlimited agents'}
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="grid gap-4 mb-8 flex-1">
        {TIERS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setSelectedTier(t.id);
              setShowPayment(false);
            }}
            className={`p-5 rounded-xl border-2 transition-all text-left ${
              selectedTier === t.id
                ? 'border-blue-500 bg-white shadow-lg'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-2xl">{t.emoji}</div>
                <h3 className="font-bold text-gray-900 mt-1">{t.name}</h3>
              </div>
              {t.popular && (
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">
                  POPULAR
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-2xl font-bold text-gray-900">${t.price}</span>
              <span className="text-gray-600">/mo</span>
            </div>
            <ul className="space-y-2">
              {t.features.map((f) => (
                <li key={f} className="text-sm text-gray-700 flex items-center gap-2">
                  <span>✓</span> {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {/* Payment Selection */}
      {!showPayment ? (
        <Button
          onClick={() => setShowPayment(true)}
          disabled={loading}
          className="w-full"
        >
          {loading ? '⏳ Processing...' : `Continue - $${tier?.price}/month`}
        </Button>
      ) : (
        <div className="space-y-4">
          <PaymentSelector onSelect={setSelectedPayment as any} disabled={loading} />
          <Button
            onClick={() => {
              if (selectedPayment) {
                onUpgrade(selectedTier, selectedPayment);
              }
            }}
            disabled={!selectedPayment || loading}
            className="w-full"
          >
            {loading ? '⏳ Processing...' : 'Pay Now'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowPayment(false)}
            className="w-full"
          >
            Back
          </Button>
        </div>
      )}
    </div>
  );
};
