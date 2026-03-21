import 'dotenv/config';
import { seedTestData } from '../src/services/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Seed Script
//
// Creates a test account and API key in the local Supabase database.
// Run with: npm run seed
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nHekkova MCP Server — Seed Script');
  console.log('─────────────────────────────────────────');
  console.log('Seeding test data into Supabase...\n');

  try {
    await seedTestData();

    console.log('\nNext steps:');
    console.log('  1. Copy .env.example to .env and fill in your Supabase credentials');
    console.log('  2. Run: npm run dev');
    console.log('  3. In another terminal: npm run test-client');
    console.log('  4. Or connect via Claude Desktop using the config snippet above\n');
  } catch (err) {
    const e = err as Error;
    console.error('\nSeed failed:', e.message);
    console.error('\nMake sure your Supabase credentials are set in .env');
    console.error('and that the following tables exist:');
    console.error('  - accounts');
    console.error('  - api_keys');
    console.error('  - moments\n');
    process.exit(1);
  }
}

main();
