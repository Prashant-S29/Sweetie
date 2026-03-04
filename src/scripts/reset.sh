#!/bin/bash
# Reset DB for a clean demo run
# Run from project root: bash scripts/reset.sh

set -e

echo "⚠ Resetting database (memories, messages, threads)..."

npx tsx -e "
import * as dotenv from 'dotenv';
dotenv.config();
import { db } from './src/db/client';
import { memories, messages, threads } from './src/db/schema';

async function reset() {
  await db.delete(memories);
  await db.delete(messages);
  await db.delete(threads);
  console.log('✓ Database reset complete');
  process.exit(0);
}
reset().catch(e => { console.error(e); process.exit(1); });
"
