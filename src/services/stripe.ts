import Stripe from 'stripe';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mint pack definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface MintPack {
  id: string;
  name: string;
  description: string;
  priceId: string;
  mintsAdded: number;
  isLegacyPlan: boolean;
}

export const MINT_PACKS: Record<string, MintPack> = {
  first_light_pack: {
    id: 'first_light_pack',
    name: 'First Light Pack',
    description: '5 mint credits — start building your Arc.',
    priceId: 'price_1TIZjHRwvO8flM8eo19Kg3tJ',
    mintsAdded: 5,
    isLegacyPlan: false,
  },
  arc_builder: {
    id: 'arc_builder',
    name: 'Arc Builder',
    description: '20 mint credits — for active memory keepers.',
    priceId: 'price_1TIZjzRwvO8flM8eCKaqVxDm',
    mintsAdded: 20,
    isLegacyPlan: false,
  },
  eternal_light: {
    id: 'eternal_light',
    name: 'Eternal Light',
    description: '50 mint credits — preserve everything that matters.',
    priceId: 'price_1TIZkaRwvO8flM8eVKZszX95',
    mintsAdded: 50,
    isLegacyPlan: false,
  },
  legacy_plan: {
    id: 'legacy_plan',
    name: 'Legacy Plan',
    description: 'Unlimited Phase Shifts, priority minting, and heir access designation. Coming soon: Eclipse time-locked moments, Filecoin-backed archival storage. Billed annually.',
    priceId: 'price_1TIZlSRwvO8flM8e7O54CFEX',
    mintsAdded: 0,
    isLegacyPlan: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Stripe client (lazy singleton)
// ─────────────────────────────────────────────────────────────────────────────

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(config.stripeSecretKey || 'sk_test_placeholder');
  }
  return _stripe;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a Stripe Checkout Session for a mint pack purchase
// ─────────────────────────────────────────────────────────────────────────────

export async function createCheckoutSession(
  pack: MintPack,
  accountId: string,
  successUrl: string,
  cancelUrl: string
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: pack.isLegacyPlan ? 'subscription' : 'payment',
    line_items: [{ price: pack.priceId, quantity: 1 }],
    client_reference_id: accountId,
    metadata: { pack_id: pack.id, account_id: accountId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  // Propagate account_id into the subscription's metadata so the
  // customer.subscription.deleted webhook can identify which account to downgrade.
  if (pack.isLegacyPlan) {
    params.subscription_data = { metadata: { account_id: accountId } };
  }

  return stripe.checkout.sessions.create(params);
}

// TODO [MEDIUM]: Track processed Stripe event IDs (e.g. in a DB table) to
//   prevent double-crediting if Stripe retries a webhook after a 5xx. Store
//   event.id and skip processing if already seen.

// ─────────────────────────────────────────────────────────────────────────────
// Verify and parse an incoming Stripe webhook event
// ─────────────────────────────────────────────────────────────────────────────

export function constructWebhookEvent(
  payload: Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}
