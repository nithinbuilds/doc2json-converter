#!/usr/bin/env node
/**
 * Standalone worker so Next.js API routes don't manage Chrome directly.
 * Usage: node scripts/chat-carousel-worker.mjs '{"prompts":["..."],"limit":8}'
 */
import { fetchProductsViaChatBatch } from '../src/utils/plush-chat-fetch.js';

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Missing JSON payload');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON payload');
    process.exit(1);
  }

  const prompts = payload.prompts || (payload.query ? [payload.query] : []);
  const limit = payload.limit || 8;

  try {
    const byQuery = await fetchProductsViaChatBatch(prompts, { limit });
    process.stdout.write(JSON.stringify({ ok: true, byQuery }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: error.message || String(error) })
    );
    process.exit(1);
  }
}

main();
