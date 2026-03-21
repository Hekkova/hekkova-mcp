import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  const { data: a } = await sb.from('accounts').select('*').limit(1);
  console.log('accounts columns:', a && a[0] ? Object.keys(a[0]) : '(empty table — insert a dummy to inspect)');
  const { data: k } = await sb.from('api_keys').select('*').limit(1);
  console.log('api_keys columns:', k && k[0] ? Object.keys(k[0]) : '(empty table)');

  // Try inserting with just id to see what's required
  const { error } = await sb.from('accounts').insert({}).select().single();
  console.log('empty insert error:', error?.message);
}
main().catch(console.error);
