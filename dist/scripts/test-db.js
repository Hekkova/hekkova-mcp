import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TEST_KEY = 'hk_test_local_dev_key_12345678';
function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}
async function main() {
    console.log('=== Supabase DB Test ===\n');
    // 1. Check tables exist
    const tables = ['accounts', 'api_keys', 'moments'];
    for (const table of tables) {
        const { error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.error(`✗ Table "${table}": ${error.message}`);
        }
        else {
            console.log(`✓ Table "${table}" exists`);
        }
    }
    console.log();
    // 2. Clean up any previous test run
    await supabase.from('api_keys').delete().eq('key_hash', hashKey(TEST_KEY));
    const { data: existing } = await supabase
        .from('accounts')
        .select('id')
        .eq('display_name', 'Test Dev Account')
        .limit(1)
        .maybeSingle();
    if (existing) {
        await supabase.from('api_keys').delete().eq('account_id', existing.id);
        await supabase.from('accounts').delete().eq('id', existing.id);
        console.log('(cleaned up previous test account)\n');
    }
    // 3. Create test account with 10 mint credits
    const { data: account, error: accountErr } = await supabase
        .from('accounts')
        .insert({
        display_name: 'Test Dev Account',
        light_id: 'test_dev_001',
        mints_remaining: 10,
    })
        .select()
        .single();
    if (accountErr) {
        console.error('✗ Create account:', accountErr.message);
        return;
    }
    console.log('✓ Created account:');
    console.log(`    id:              ${account.id}`);
    console.log(`    display_name:    ${account.display_name}`);
    console.log(`    mints_remaining: ${account.mints_remaining}`);
    console.log();
    // 4. Create test API key (hashed)
    const keyHash = hashKey(TEST_KEY);
    const keyPrefix = TEST_KEY.slice(0, 12); // "hk_test_loca"
    const { data: apiKey, error: keyErr } = await supabase
        .from('api_keys')
        .insert({
        account_id: account.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        environment: 'development',
    })
        .select()
        .single();
    if (keyErr) {
        console.error('✗ Create API key:', keyErr.message);
    }
    else {
        console.log('✓ Created API key:');
        console.log(`    id:          ${apiKey.id}`);
        console.log(`    key_prefix:  ${apiKey.key_prefix}`);
        console.log(`    key_hash:    ${apiKey.key_hash.slice(0, 16)}...`);
        console.log(`    environment: ${apiKey.environment}`);
        console.log(`    raw key:     ${TEST_KEY}  (not stored — hash only)`);
    }
    console.log();
    // 5. Verify by looking up the key hash (simulates auth flow)
    const { data: lookup, error: lookupErr } = await supabase
        .from('api_keys')
        .select('id, account_id, key_prefix, environment, accounts(display_name, mints_remaining)')
        .eq('key_hash', keyHash)
        .is('revoked_at', null)
        .single();
    if (lookupErr) {
        console.error('✗ Key lookup:', lookupErr.message);
    }
    else {
        const acc = lookup.accounts;
        console.log('✓ Key lookup (auth simulation) succeeded:');
        console.log(`    account:         ${acc.display_name}`);
        console.log(`    mints_remaining: ${acc.mints_remaining}`);
    }
    console.log('\n=== Done ===');
}
main().catch(console.error);
//# sourceMappingURL=test-db.js.map