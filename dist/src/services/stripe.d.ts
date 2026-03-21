import Stripe from 'stripe';
export interface MintPack {
    id: string;
    name: string;
    description: string;
    priceInCents: number;
    mintsAdded: number;
    isLegacyPlan: boolean;
}
export declare const MINT_PACKS: Record<string, MintPack>;
export declare function createCheckoutSession(pack: MintPack, accountId: string, successUrl: string, cancelUrl: string): Promise<Stripe.Checkout.Session>;
export declare function constructWebhookEvent(payload: Buffer, signature: string, secret: string): Stripe.Event;
//# sourceMappingURL=stripe.d.ts.map