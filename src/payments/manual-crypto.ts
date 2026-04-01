/**
 * Manual Crypto Payment System
 * Display wallet addresses for direct crypto transfers
 * Supports: BTC, ETH, SOL, TON, USDC
 */

export interface CryptoAddress {
  currency: 'BTC' | 'ETH' | 'SOL' | 'TON' | 'USDC';
  address: string;
  qrCode?: string;  // Data URL
  network?: string; // e.g. "Ethereum Mainnet", "Solana Mainnet"
}

export interface ManualPaymentInvoice {
  id: string;
  orderId: string;
  priceUsd: number;
  acceptedCurrencies: CryptoAddress[];
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'received' | 'expired';
  instructionText: string;
}

/**
 * Load wallet addresses from environment or secure storage
 */
export function loadCryptoAddresses(): CryptoAddress[] {
  return [
    {
      currency: 'BTC',
      address: process.env.BTC_WALLET_ADDRESS || '1A1z7agoat2x...',
      network: 'Bitcoin Mainnet'
    },
    {
      currency: 'ETH',
      address: process.env.ETH_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f...',
      network: 'Ethereum Mainnet'
    },
    {
      currency: 'SOL',
      address: process.env.SOL_WALLET_ADDRESS || '4K3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX...',
      network: 'Solana Mainnet'
    },
    {
      currency: 'TON',
      address: process.env.TON_WALLET_ADDRESS || 'UQAohzcqe8...',
      network: 'TON Mainnet'
    },
    {
      currency: 'USDC',
      address: process.env.USDC_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f...',
      network: 'Ethereum/Polygon'
    }
  ].filter(addr => addr.address !== '' && !addr.address.includes('...'));
}

/**
 * Create a manual payment invoice
 */
export function createManualPaymentInvoice(opts: {
  priceUsd: number;
  orderId: string;
  description?: string;
}): ManualPaymentInvoice {
  const addresses = loadCryptoAddresses();
  
  return {
    id: `manual_${opts.orderId}_${Date.now()}`,
    orderId: opts.orderId,
    priceUsd: opts.priceUsd,
    acceptedCurrencies: addresses,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
    status: 'pending',
    instructionText: `Send **$${opts.priceUsd} USD equivalent** to any address below. Reference: ${opts.orderId}\n\n⏱ This invoice expires in 1 hour.`
  };
}

/**
 * Convert USD to crypto amount (placeholder - use real price feed)
 */
export function usdToCrypto(priceUsd: number, currency: 'BTC' | 'ETH' | 'SOL' | 'TON'): string {
  const rates: Record<string, number> = {
    BTC: 42000,   // 1 BTC = $42,000
    ETH: 2500,    // 1 ETH = $2,500
    SOL: 140,     // 1 SOL = $140
    TON: 5.5      // 1 TON = $5.50
  };
  
  const rate = rates[currency] || 1;
  const amount = priceUsd / rate;
  return amount.toFixed(currency === 'BTC' ? 6 : 2);
}

/**
 * Format crypto amounts for display
 */
export function formatCrypto(amount: string | number, currency: string): string {
  return `${amount} ${currency}`;
}

/**
 * Generate QR code data URL (placeholder)
 * In production, use qrcode.js or similar
 */
export function generateQrCode(data: string): string {
  // Placeholder: https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=...
  const encoded = encodeURIComponent(data);
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`;
}

/**
 * Create a payment with instructions and QR codes
 */
export function createPaymentDisplay(opts: {
  priceUsd: number;
  orderId: string;
  currency: 'BTC' | 'ETH' | 'SOL' | 'TON';
}) {
  const addresses = loadCryptoAddresses();
  const addr = addresses.find(a => a.currency === opts.currency);
  
  if (!addr) {
    throw new Error(`Currency ${opts.currency} not configured`);
  }
  
  const amount = usdToCrypto(opts.priceUsd, opts.currency);
  const qrData = `${addr.currency.toLowerCase()}:${addr.address}?amount=${amount}`;
  
  return {
    currency: opts.currency,
    address: addr.address,
    amount: amount,
    priceUsd: opts.priceUsd,
    network: addr.network,
    qrCode: generateQrCode(qrData),
    instruction: `Send exactly **${formatCrypto(amount, opts.currency)}** to:\n\n\`${addr.address}\`\n\nReference: ${opts.orderId}`,
  };
}

/**
 * Check for manual payment (placeholder - would check blockchain)
 */
export async function verifyManualPayment(
  address: string,
  currency: string,
  minAmount: number,
  orderId: string
): Promise<{ confirmed: boolean; txHash?: string }> {
  // TODO: Integrate with blockchain RPC
  // For each currency:
  // - BTC: Use blockchain.com or similar API
  // - ETH: Use Etherscan API or eth_getLogs
  // - SOL: Use Solana RPC
  // - TON: Use TON RPC or explorer API
  
  console.log(`TODO: Verify ${currency} payment to ${address} for $${minAmount}`);
  return { confirmed: false };
}
