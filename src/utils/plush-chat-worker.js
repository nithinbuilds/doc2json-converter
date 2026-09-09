import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchProductsViaChat, fetchProductsViaChatBatch } from './plush-chat-fetch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, '../../scripts/chat-carousel-worker.mjs');

/**
 * Run chat fetch in a child Node process so Chrome isn't tied to the Next.js request lifecycle.
 */
function runWorker(payload, { timeoutMs = 280_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(payload)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      reject(new Error(`Chat carousel worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stderr.trim()) {
        console.error('[chat-carousel-worker stderr]', stderr.slice(0, 2000));
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout || '{}');
      } catch {
        reject(
          new Error(
            `Chat worker returned invalid JSON (code ${code}): ${stdout.slice(0, 400) || stderr.slice(0, 400)}`
          )
        );
        return;
      }
      if (!parsed.ok) {
        reject(new Error(parsed.error || `Chat worker failed with code ${code}`));
        return;
      }
      resolve(parsed.byQuery || {});
    });
  });
}

/** Prefer worker when available; fall back to in-process for direct CLI use. */
async function viaWorkerOrLocal(prompts, limit) {
  try {
    return await runWorker({ prompts, limit });
  } catch (err) {
    // If worker path is missing in a weird deploy, fall back in-process
    if (err.code === 'ENOENT') {
      return fetchProductsViaChatBatch(prompts, { limit });
    }
    throw err;
  }
}

export async function fetchCarouselFromQuery(query, { limit = 8 } = {}) {
  const cleaned = String(query || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('Search query is required');

  // Direct CLI / unit use can call in-process; API uses worker via batch wrapper below
  if (process.env.PLUSH_CHAT_INPROCESS === '1') {
    return fetchProductsViaChat(cleaned, { limit });
  }

  const byQuery = await viaWorkerOrLocal([cleaned], limit);
  const result = byQuery[cleaned];
  if (!result) throw new Error('Chat fetch returned no result');
  if (result.error && !result.found) throw new Error(result.error);
  return result;
}

export async function fetchCarouselFromQueries(queries, { limit = 8 } = {}) {
  const cleaned = [...new Set(
    (queries || []).map((q) => String(q || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  )];
  if (!cleaned.length) return {};

  if (process.env.PLUSH_CHAT_INPROCESS === '1') {
    return fetchProductsViaChatBatch(cleaned, { limit });
  }

  return viaWorkerOrLocal(cleaned, limit);
}
