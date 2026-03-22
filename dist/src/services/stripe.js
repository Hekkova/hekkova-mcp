"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINT_PACKS = void 0;
exports.createCheckoutSession = createCheckoutSession;
exports.constructWebhookEvent = constructWebhookEvent;
const stripe_1 = __importDefault(require("stripe"));
const config_js_1 = require("../config.js");
exports.MINT_PACKS = {
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
        _stripe = new stripe_1.default(config_js_1.config.stripeSecretKey || 'sk_test_placeholder');
    }
    return _stripe;
}
// ─────────────────────────────────────────────────────────────────────────────
// Create a Stripe Checkout Session for a mint pack purchase
// ─────────────────────────────────────────────────────────────────────────────
async function createCheckoutSession(pack, accountId, successUrl, cancelUrl) {
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
// ─────────────────────────────────────────────────────────────────────────────
// Verify and parse an incoming Stripe webhook event
// ─────────────────────────────────────────────────────────────────────────────
function constructWebhookEvent(payload, signature, secret) {
    return getStripe().webhooks.constructEvent(payload, signature, secret);
}
//# sourceMappingURL=stripe.js.map