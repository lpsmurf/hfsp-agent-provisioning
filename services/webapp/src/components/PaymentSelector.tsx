import React, { useState } from 'react';
import { Button } from './shared';

export interface PaymentMethod {
  id: 'ton' | 'nowpayments' | 'manual' | 'trial-code';
  name: string;
  icon: string;
  description: string;
  recommended?: boolean;
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'ton',
    name: '⚡ TON Pay',
    icon: '⚡',
    description: 'Fast & instant via TON blockchain',
    recommended: true,
  },
  {
    id: 'nowpayments',
    name: '💳 Crypto (NOWPayments)',
    icon: '💳',
    description: 'BTC, ETH, SOL, USDC & 100+ more',
  },
  {
    id: 'manual',
    name: '📮 Manual Transfer',
    icon: '📮',
    description: 'Send directly to wallet address',
  },
  {
    id: 'trial-code',
    name: '🎁 Trial Code',
    icon: '🎁',
    description: 'Use a trial/promotional code',
  },
];

interface PaymentSelectorProps {
  onSelect: (method: 'ton' | 'nowpayments' | 'manual' | 'trial-code') => void;
  disabled?: boolean;
}

export const PaymentSelector: React.FC<PaymentSelectorProps> = ({ onSelect, disabled }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (method: PaymentMethod) => {
    setSelected(method.id);
    onSelect(method.id as any);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
        Choose Payment Method
      </div>
      
      <div className="grid gap-2">
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method.id}
            onClick={() => handleSelect(method)}
            disabled={disabled}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              selected === method.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-gray-900 flex items-center gap-2">
                  <span>{method.icon}</span>
                  {method.name}
                </div>
                <div className="text-xs text-gray-600 mt-1">{method.description}</div>
              </div>
              {method.recommended && (
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">
                  ⭐ Recommended
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
