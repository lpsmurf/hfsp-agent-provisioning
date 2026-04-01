import React, { useState } from 'react';
import { Button } from './shared/Button';
import { Input } from './shared/Input';

interface TrialCodeInputProps {
  onApply: (code: string) => Promise<{ success: boolean; message: string; expiryDate?: string }>;
  onSuccess?: (expiryDate?: string) => void;
  loading?: boolean;
}

export const TrialCodeInput: React.FC<TrialCodeInputProps> = ({
  onApply,
  onSuccess,
  loading = false,
}) => {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setIsLoading(true);
    setMessage('');
    
    try {
      const result = await onApply(code.trim().toUpperCase());
      setIsError(!result.success);
      setMessage(result.message);
      
      if (result.success) {
        setCode('');
        onSuccess?.(result.expiryDate);
      }
    } catch (err) {
      setIsError(true);
      setMessage((err as Error).message || 'Failed to apply code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Have a trial code?
        </label>
        <p className="text-xs text-gray-600 mb-3">
          Enter your promotional or trial code to unlock free access.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          placeholder="e.g. TRIAL-ABC123"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          disabled={isLoading}
          maxLength={20}
        />

        <Button
          type="submit"
          disabled={!code.trim() || isLoading}
          className="w-full"
        >
          {isLoading ? '⏳ Validating...' : '🎁 Redeem Code'}
        </Button>
      </form>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            isError
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }`}
        >
          {isError ? '❌' : '✅'} {message}
        </div>
      )}

      <div className="pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-600 text-center">
          Don't have a code? <a href="#newsletter" className="text-blue-600 hover:underline font-semibold">Subscribe to our newsletter</a> to get one!
        </p>
      </div>
    </div>
  );
};
