import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { config } from '../config.js';
import type { Account, AccountContext, ApiKey, Category, Moment, Phase } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client (service role — full access, used server-side only)
// ─────────────────────────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(config.supabaseUrl || 'http://localhost:54321', config.supabaseServiceKey || 'service_role_placeholder');
  }
  return _supabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: SHA-256 hex hash
// ─────────────────────────────────────────────────────────────────────────────

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth lookup
// ─────────────────────────────────────────────────────────────────────────────

export async function getAccountByKeyHash(
  keyHash: string
): Promise<{ account: Account; apiKey: ApiKey } | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('api_keys')
    .select(
      `
      id,
      account_id,
      key_hash,
      key_prefix,
      environment,
      created_at,
      revoked_at,
      accounts (
        id,
        display_name,
        light_id,
        wallet_address,
        mints_remaining,
        total_minted,
        default_phase,
        legacy_plan,
        created_at
      )
    `
    )
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) return null;

  const raw = data as {
    id: string;
    account_id: string;
    key_hash: string;
    key_prefix: string;
    environment: 'live' | 'test';
    created_at: string;
    revoked_at: string | null;
    accounts: Account | Account[] | null;
  };

  const accountRaw = raw.accounts;
  if (!accountRaw) return null;

  const account: Account = Array.isArray(accountRaw) ? accountRaw[0] : accountRaw;

  const apiKey: ApiKey = {
    id: raw.id,
    account_id: raw.account_id,
    key_hash: raw.key_hash,
    key_prefix: raw.key_prefix,
    environment: raw.environment,
    created_at: raw.created_at,
    revoked_at: raw.revoked_at,
  };

  return { account, apiKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Moment queries
// ─────────────────────────────────────────────────────────────────────────────

export async function getMomentByBlockId(
  blockId: string,
  accountId: string
): Promise<Moment | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('moments')
    .select('*')
    .eq('block_id', blockId)
    .eq('account_id', accountId)
    .single();

  if (error || !data) return null;
  return data as Moment;
}

export async function listMoments(
  accountId: string,
  opts: {
    limit: number;
    offset: number;
    phase?: Phase;
    category?: Category;
    search?: string;
    sort: 'newest' | 'oldest';
  }
): Promise<{ moments: Moment[]; total: number }> {
  const supabase = getSupabase();

  let query = supabase
    .from('moments')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId);

  if (opts.phase) query = query.eq('phase', opts.phase);
  if (opts.category) query = query.eq('category', opts.category);
  if (opts.search) {
    query = query.or(
      `title.ilike.%${opts.search}%,description.ilike.%${opts.search}%`
    );
  }

  const order = opts.sort === 'oldest' ? 'asc' : 'desc';
  query = query
    .order('timestamp', { ascending: order === 'asc' })
    .range(opts.offset, opts.offset + opts.limit - 1);

  const { data, error, count } = await query;

  if (error) throw new Error(`Database error listing moments: ${error.message}`);

  return {
    moments: (data ?? []) as Moment[],
    total: count ?? 0,
  };
}

export async function insertMoment(
  moment: Omit<Moment, 'id' | 'created_at'>
): Promise<Moment> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('moments')
    .insert(moment)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to insert moment: ${error?.message}`);
  return data as Moment;
}

export async function updateMomentPhase(
  blockId: string,
  accountId: string,
  newPhase: Phase
): Promise<Moment> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('moments')
    .update({ phase: newPhase, encrypted: newPhase !== 'full_moon' })
    .eq('block_id', blockId)
    .eq('account_id', accountId)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to update moment phase: ${error?.message}`);
  return data as Moment;
}

export async function decrementMints(accountId: string): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.rpc('decrement_mints', { account_id: accountId });
  if (error) {
    // Fallback: manual decrement
    const { data: acc } = await supabase
      .from('accounts')
      .select('mints_remaining')
      .eq('id', accountId)
      .single();
    if (acc) {
      await supabase
        .from('accounts')
        .update({ mints_remaining: Math.max(0, (acc as { mints_remaining: number }).mints_remaining - 1) })
        .eq('id', accountId);
    }
  }
}

export async function incrementTotalMinted(accountId: string): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.rpc('increment_total_minted', { account_id: accountId });
  if (error) {
    // Fallback: manual increment
    const { data: acc } = await supabase
      .from('accounts')
      .select('total_minted')
      .eq('id', accountId)
      .single();
    if (acc) {
      await supabase
        .from('accounts')
        .update({ total_minted: (acc as { total_minted: number }).total_minted + 1 })
        .eq('id', accountId);
    }
  }
}

export async function getAllMoments(accountId: string): Promise<Moment[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('moments')
    .select('*')
    .eq('account_id', accountId)
    .order('timestamp', { ascending: false });

  if (error) throw new Error(`Failed to get all moments: ${error.message}`);
  return (data ?? []) as Moment[];
}

export async function getAccount(accountId: string): Promise<Account | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (error || !data) return null;
  return data as Account;
}

export async function updateAccount(
  accountId: string,
  fields: { display_name?: string; default_phase?: string }
): Promise<Account> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('accounts')
    .update(fields)
    .eq('id', accountId)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to update account: ${error?.message}`);
  return data as Account;
}

export async function addMintsToAccount(
  accountId: string,
  amount: number
): Promise<{ previousBalance: number | null; newBalance: number | null; error: string | null }> {
  const supabase = getSupabase();

  const { data: acc, error: fetchError } = await supabase
    .from('accounts')
    .select('mints_remaining')
    .eq('id', accountId)
    .single();

  if (fetchError || !acc) {
    return { previousBalance: null, newBalance: null, error: fetchError?.message ?? 'Account not found' };
  }

  const previous = (acc as { mints_remaining: number }).mints_remaining;
  const next = previous + amount;

  const { error: updateError } = await supabase
    .from('accounts')
    .update({ mints_remaining: next })
    .eq('id', accountId);

  if (updateError) {
    return { previousBalance: previous, newBalance: null, error: updateError.message };
  }

  return { previousBalance: previous, newBalance: next, error: null };
}

export async function setLegacyPlan(accountId: string, enabled: boolean): Promise<void> {
  const supabase = getSupabase();

  await supabase
    .from('accounts')
    .update({ legacy_plan: enabled })
    .eq('id', accountId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase JWT verification (for dashboard endpoints)
// ─────────────────────────────────────────────────────────────────────────────

export async function verifySupabaseToken(token: string): Promise<{ id: string; email: string | undefined }> {
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error('Invalid or expired authentication token');
  }
  return { id: user.id, email: user.email };
}

export async function insertAccount(id: string, displayName: string): Promise<Account> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      id,
      display_name: displayName,
      mints_remaining: 0,
      total_minted: 0,
      default_phase: 'new_moon',
      legacy_plan: false,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create account: ${error?.message}`);
  return data as Account;
}

// ─────────────────────────────────────────────────────────────────────────────
// API key management (dashboard endpoints)
// ─────────────────────────────────────────────────────────────────────────────

export async function createApiKey(
  accountId: string,
  keyHash: string,
  keyPrefix: string
): Promise<ApiKey> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      account_id: accountId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      environment: 'live',
      revoked_at: null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create API key: ${error?.message}`);
  return data as ApiKey;
}

export async function listApiKeys(accountId: string): Promise<ApiKey[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, account_id, key_prefix, created_at, revoked_at')
    .eq('account_id', accountId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list API keys: ${error.message}`);
  return (data ?? []) as ApiKey[];
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId);

  if (error) throw new Error(`Failed to revoke API key: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed (development only)
// ─────────────────────────────────────────────────────────────────────────────

export async function seedTestData(): Promise<void> {
  const supabase = getSupabase();

  const TEST_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
  const TEST_API_KEY = 'hk_test_local_dev_key_12345678';
  const KEY_HASH = hashKey(TEST_API_KEY);
  const KEY_PREFIX = TEST_API_KEY.slice(0, 12);

  // Upsert account
  const { error: accError } = await supabase.from('accounts').upsert(
    {
      id: TEST_ACCOUNT_ID,
      display_name: 'Test User',
      light_id: null,
      wallet_address: null,
      mints_remaining: 10,
      total_minted: 0,
      default_phase: 'new_moon',
      legacy_plan: false,
    },
    { onConflict: 'id' }
  );

  if (accError) {
    throw new Error(`Failed to seed account: ${accError.message}`);
  }

  // Upsert API key
  const { error: keyError } = await supabase.from('api_keys').upsert(
    {
      account_id: TEST_ACCOUNT_ID,
      key_hash: KEY_HASH,
      key_prefix: KEY_PREFIX,
      environment: 'test',
      revoked_at: null,
    },
    { onConflict: 'key_hash' }
  );

  if (keyError) {
    throw new Error(`Failed to seed API key: ${keyError.message}`);
  }

  console.log('\n✅ Test data seeded successfully.');
  console.log('─────────────────────────────────────────');
  console.log(`Test API Key:  ${TEST_API_KEY}`);
  console.log(`Key Hash:      ${KEY_HASH}`);
  console.log(`Account ID:    ${TEST_ACCOUNT_ID}`);
  console.log('─────────────────────────────────────────');
  console.log('\nAdd to your Claude Desktop config (~/.config/claude/claude_desktop_config.json):');
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          hekkova: {
            type: 'url',
            url: 'http://localhost:3000/mcp',
            headers: {
              Authorization: `Bearer ${TEST_API_KEY}`,
            },
          },
        },
      },
      null,
      2
    )
  );
  console.log('');
}
