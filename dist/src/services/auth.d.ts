import type { AccountContext } from '../types/index.js';
/** SHA-256 hex hash of an API key string. */
export declare function hashApiKey(key: string): string;
/**
 * Validates the Authorization header, hashes the key, and looks up the
 * associated account in the database.
 *
 * @throws Error with code UNAUTHORIZED if the header is missing, malformed,
 *   or the key cannot be found / has been revoked.
 */
export declare function validateApiKey(authHeader: string | undefined): Promise<AccountContext>;
//# sourceMappingURL=auth.d.ts.map