import 'dotenv/config';
export declare const config: {
    readonly port: number;
    readonly nodeEnv: string;
    readonly supabaseUrl: string;
    readonly supabaseAnonKey: string;
    readonly supabaseServiceKey: string;
    readonly thirdwebClientId: string;
    readonly thirdwebSecretKey: string;
    readonly hekkovaContractAddress: string;
    readonly polygonRpcUrl: string;
    readonly pinataJwt: string;
    readonly pinataGateway: string;
    readonly litNetwork: string;
    readonly stripeSecretKey: string;
    readonly stripeWebhookSecret: string;
    readonly purchaseUrl: "https://hekkova.com/dashboard/billing";
    readonly dashboardKeysUrl: "https://hekkova.com/dashboard/keys";
};
export type Config = typeof config;
//# sourceMappingURL=config.d.ts.map