import Stripe from 'stripe';
import { config } from '../config.js';
export const MINT_PACKS = {
    single_light: {
        id: 'single_light',
        name: 'Single Light',
        description: '1 mint credit — permanently preserve one moment on the blockchain.',
        priceInCents: 99,
        mintsAdded: 1,
        isLegacyPlan: false,
    },
    first_light_pack: {
        id: 'first_light_pack',
        name: 'First Light Pack',
        description: '3 mint credits — start building your Arc.',
        priceInCents: 150,
        mintsAdded: 3,
        isLegacyPlan: false,
    },
    arc_builder: {
        id: 'arc_builder',
        name: 'Arc Builder',
        description: '10 mint credits — for active memory keepers.',
        priceInCents: 450,
        mintsAdded: 10,
        isLegacyPlan: false,
    },
    eternal_light: {
        id: 'eternal_light',
        name: 'Eternal Light',
        description: '50 mint credits — preserve everything that matters.',
        priceInCents: 2000,
        mintsAdded: 50,
        isLegacyPlan: false,
    },
    legacy_plan: {
        id: 'legacy_plan',
        name: 'Legacy Plan',
        description: 'Unlimited Phase Shifts, priority minting, and heir access designation. Coming soon: Eclipse time-locked moments, Filecoin-backed archival storage. Billed annually.',
        priceInCents: 4900,
        mintsAdded: 0,
        isLegacyPlan: true,
    },
};
// ─────────────────────────────────────────────────────────────────────────────
// Stripe client (lazy singleton)
// ─────────────────────────────────────────────────────────────────────────────
let _stripe = null;
function getStripe() {
    if (!_stripe) {
        _stripe = new Stripe(config.stripeSecretKey || 'sk_test_placeholder');
    }
    return _stripe;
}
// ─────────────────────────────────────────────────────────────────────────────
// Create a Stripe Checkout Session for a mint pack purchase
// ─────────────────────────────────────────────────────────────────────────────
export async function createCheckoutSession(pack, accountId, successUrl, cancelUrl) {
    const stripe = getStripe();
    const priceData = pack.isLegacyPlan
        ? {
            currency: 'usd',
            product_data: { name: pack.name, description: pack.description },
            unit_amount: pack.priceInCents,
            recurring: { interval: 'year' },
        }
        : {
            currency: 'usd',
            product_data: { name: pack.name, description: pack.description },
            unit_amount: pack.priceInCents,
        };
    return stripe.checkout.sessions.create({
        mode: pack.isLegacyPlan ? 'subscription' : 'payment',
        line_items: [{ price_data: priceData, quantity: 1 }],
        client_reference_id: accountId,
        metadata: { pack_id: pack.id, account_id: accountId },
        success_url: successUrl,
        cancel_url: cancelUrl,
    });
}
// TODO [MEDIUM]: Track processed Stripe event IDs (e.g. in a DB table) to
//   prevent double-crediting if Stripe retries a webhook after a 5xx. Store
//   event.id and skip processing if already seen.
// ─────────────────────────────────────────────────────────────────────────────
// Verify and parse an incoming Stripe webhook event
// ─────────────────────────────────────────────────────────────────────────────
export function constructWebhookEvent(payload, signature, secret) {
    return getStripe().webhooks.constructEvent(payload, signature, secret);
}
//# sourceMappingURL=stripe.js.map