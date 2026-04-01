import React, { useState } from 'react';
import { Button } from './shared/Button';
import { Input } from './shared/Input';

interface NewsletterSignupProps {
  onSubscribe: (email: string) => Promise<{ success: boolean; trialCode?: string; message?: string }>;
  onSuccess?: (trialCode: string) => void;
  loading?: boolean;
}

export const NewsletterSignup: React.FC<NewsletterSignupProps> = ({
  onSubscribe,
  onSuccess,
  loading = false,
}) => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [trialCode, setTrialCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setMessage('');
    setTrialCode('');

    try {
      const result = await onSubscribe(email.trim());
      setIsError(!result.success);
      setMessage(result.message || (result.success ? 'Welcome! Check your email for your trial code.' : 'Failed to subscribe'));

      if (result.success && result.trialCode) {
        setTrialCode(result.trialCode);
        onSuccess?.(result.trialCode);
      }
    } catch (err) {
      setIsError(true);
      setMessage((err as Error).message || 'Failed to subscribe');
    } finally {
      setIsLoading(false);
    }
  };

  if (trialCode) {
    return (
      <div className="space-y-4 bg-green-50 p-4 rounded-lg border border-green-200">
        <div className="text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="font-bold text-green-900 mb-2">Welcome to the community!</h3>
          <p className="text-sm text-green-700 mb-4">
            Your exclusive trial code is ready. Copy it and use it to unlock 14 days of free access.
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-green-300">
          <div className="text-xs text-gray-600 mb-1">Your Trial Code</div>
          <div className="flex items-center justify-between gap-2">
            <code className="font-mono font-bold text-lg text-green-700">{trialCode}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(trialCode);
              }}
              className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded hover:bg-green-200"
            >
              Copy
            </button>
          </div>
        </div>

        <Button onClick={() => window.location.href = '#redeem'} className="w-full">
          Use Code Now →
        </Button>

        <p className="text-xs text-gray-600 text-center">
          We'll send updates to {email}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" id="newsletter">
      <div>
        <h3 className="font-bold text-gray-900 mb-1">📧 Join Our Newsletter</h3>
        <p className="text-xs text-gray-600">
          Get exclusive updates and unlock a 14-day free trial code instantly.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          required
        />

        <Button
          type="submit"
          disabled={!email.trim() || isLoading}
          className="w-full"
        >
          {isLoading ? '⏳ Subscribing...' : '🎁 Get Trial Code'}
        </Button>
      </form>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            isError
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}
        >
          {isError ? '❌' : 'ℹ️'} {message}
        </div>
      )}

      <p className="text-xs text-gray-500 text-center">
        We respect your privacy. Unsubscribe anytime.
      </p>
    </div>
  );
};
