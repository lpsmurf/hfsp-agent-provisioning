/**
 * Phantom Wallet Integration for Telegram Mini App
 * Supports direct SOL payments within the webapp
 */

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: any;
  isConnected: boolean;
  connect(): Promise<{ publicKey: any }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(transaction: any): Promise<{ signature: string }>;
  signTransaction?(transaction: any): Promise<any>;
  signAllTransactions?(transactions: any[]): Promise<any[]>;
  signMessage?(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array; publicKey: any }>;
}

export interface TransactionResult {
  signature: string;
  success: boolean;
}

/**
 * Get Phantom provider from window
 */
export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;

  const provider = (window as any).phantom?.solana;
  if (provider?.isPhantom) {
    return provider;
  }
  return null;
}

/**
 * Check if Phantom wallet is installed
 */
export function isPhantomInstalled(): boolean {
  return getPhantomProvider() !== null;
}

/**
 * Connect to Phantom wallet
 */
export async function connectPhantomWallet(): Promise<string | null> {
  const provider = getPhantomProvider();
  if (!provider) {
    throw new Error('Phantom wallet not installed. Download from https://phantom.app');
  }

  try {
    const response = await provider.connect();
    return response.publicKey.toString();
  } catch (err: any) {
    if (err.code === 4001) {
      throw new Error('User rejected wallet connection');
    }
    throw new Error(`Failed to connect: ${err.message}`);
  }
}

/**
 * Disconnect Phantom wallet
 */
export async function disconnectPhantomWallet(): Promise<void> {
  const provider = getPhantomProvider();
  if (provider && provider.isConnected) {
    await provider.disconnect();
  }
}

/**
 * Check Phantom connection status
 */
export function isPhantomConnected(): boolean {
  const provider = getPhantomProvider();
  return provider?.isConnected ?? false;
}

/**
 * Get connected wallet address
 */
export function getPhantomWalletAddress(): string | null {
  const provider = getPhantomProvider();
  return provider?.publicKey?.toString() ?? null;
}

/**
 * Sign a message with Phantom
 */
export async function signMessageWithPhantom(message: string): Promise<Uint8Array> {
  const provider = getPhantomProvider();
  if (!provider || !provider.isConnected) {
    throw new Error('Phantom wallet not connected');
  }

  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);

  const result = await provider.signMessage?.(messageBytes, 'utf8');
  if (!result) {
    throw new Error('Failed to sign message');
  }

  return result.signature;
}

/**
 * Send SOL payment via Phantom
 * Returns transaction signature for verification
 */
export async function sendSolPaymentWithPhantom(opts: {
  recipient: string;
  amount: number; // in lamports (1 SOL = 1e9 lamports)
  memo?: string;
}): Promise<string> {
  const provider = getPhantomProvider();
  if (!provider || !provider.isConnected) {
    throw new Error('Phantom wallet not connected');
  }

  try {
    // This is a simplified example - actual implementation requires:
    // 1. Creating a transaction using Solana Web3.js
    // 2. Signing with Phantom
    // 3. Sending to RPC

    // For now, return a placeholder
    throw new Error('SOL payment requires Solana Web3.js integration');
  } catch (err: any) {
    throw new Error(`Payment failed: ${err.message}`);
  }
}

/**
 * Deep link to Phantom pay (if supported)
 * Format: solana:<recipient>?amount=<lamports>&label=<label>&message=<message>
 */
export function generatePhantomPayLink(opts: {
  recipient: string;
  amount: number;
  label?: string;
  message?: string;
}): string {
  const params = new URLSearchParams({
    amount: opts.amount.toString(),
  });
  if (opts.label) params.append('label', opts.label);
  if (opts.message) params.append('message', opts.message);

  return `solana:${opts.recipient}?${params.toString()}`;
}

/**
 * Poll for payment confirmation (placeholder)
 * In production, use WebSocket or polling for transaction confirmation
 */
export async function pollPaymentConfirmation(
  signature: string,
  maxAttempts: number = 30
): Promise<boolean> {
  // TODO: Use Solana RPC to check transaction status
  // https://docs.solana.com/developing/clients/jsonrpc-api#getSignatureStatuses

  for (let i = 0; i < maxAttempts; i++) {
    // Check if transaction is confirmed
    // const confirmed = await checkTransactionStatus(signature);
    // if (confirmed) return true;

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return false;
}
