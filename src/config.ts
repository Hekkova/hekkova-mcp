import 'dotenv/config';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Centralised Configuration
// ─────────────────────────────────────────────────────────────────────────────

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.warn(`[config] Warning: environment variable ${key} is not set.`);
    return '';
  }
  return value;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  // ── Server ────────────────────────────────────────────────────────────────
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // ── Supabase ──────────────────────────────────────────────────────────────
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),

  // ── Thirdweb / Polygon ────────────────────────────────────────────────────
  thirdwebClientId: required('THIRDWEB_CLIENT_ID'),
  thirdwebSecretKey: required('THIRDWEB_SECRET_KEY'),
  serverWalletPrivateKey: required('SERVER_WALLET_PRIVATE_KEY'),
  hekkovaContractAddress: required('HEKKOVA_CONTRACT_ADDRESS'),
  polygonRpcUrl: optional('POLYGON_RPC_URL', 'https://polygon.llamarpc.com'),

  // ── Pinata (IPFS) ─────────────────────────────────────────────────────────
  pinataJwt: required('PINATA_JWT'),
  pinataGateway: optional('PINATA_GATEWAY', 'https://gateway.pinata.cloud'),

  // ── Lit Protocol ─────────────────────────────────────────────────────────
  litNetwork: optional('LIT_NETWORK', 'cayenne'),

  // ── Stripe ───────────────────────────────────────────────────────────────
  stripeSecretKey: required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: required('STRIPE_WEBHOOK_SECRET'),

  // ── Static URLs ───────────────────────────────────────────────────────────
  purchaseUrl: 'https://hekkova.com/dashboard/billing',
  dashboardKeysUrl: 'https://hekkova.com/dashboard/keys',
} as const;

export type Config = typeof config;
