import { fetchProductsViaChat } from './plush-chat-fetch.js';

const SEARCH_PATH_RE = /plush\.shop\/(chat|edits|results)\//;

export function isPlushSearchUrl(url) {
  return Boolean(url && SEARCH_PATH_RE.test(url));
}

export function isPlushProductUrl(url) {
  return Boolean(url && url.includes('plush.shop/product/'));
}

/** Encode query the same way Plush builds /edits/ URLs. */
export function encodePlushQuery(query) {
  return encodeURIComponent(query).replace(/%20/g, '+');
}

export function decodePlushQuery(raw) {
  if (!raw) return '';
  let value = String(raw).replace(/\+/g, ' ');
  // Google Docs often double-encodes path segments (%252C → %2C → ,)
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value.replace(/\+/g, ' ').trim();
}

/**
 * Extract the search query from a Plush URL.
 * Chat IDs change every session — only `?query=` (or the edits/results path) is stable.
 */
export function extractQueryFromPlushUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.pathname.includes('/chat/')) {
      const q = u.searchParams.get('query');
      return q ? decodePlushQuery(q) : null;
    }
    const match = u.pathname.match(/\/(?:edits|results)\/(.+)/);
    if (match) return decodePlushQuery(match[1]);
  } catch {
    const chatMatch = url.match(/[?&]query=([^&]+)/);
    if (chatMatch) return decodePlushQuery(chatMatch[1]);
    const pathMatch = url.match(/\/(?:edits|results)\/([^?#]+)/);
    if (pathMatch) return decodePlushQuery(pathMatch[1]);
  }
  return null;
}

/**
 * Pull the search string out of a "Prompt: ..." text block.
 * Ignores hyperlinks — uses the visible prompt copy.
 */
export function extractPromptQuery(text) {
  if (!text) return null;
  const normalized = String(text).replace(/\u00a0/g, ' ').trim();
  const match = normalized.match(
    /prompt\s*:\s*[""'\u201c\u201d]?([\s\S]*?)[""'\u201c\u201d]?\s*$/i
  );
  if (!match) return null;
  return match[1]
    .replace(/^[""'\u201c\u201d]+|[""'\u201c\u201d]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editsUrlForQuery(query) {
  return `https://www.plush.shop/edits/${encodePlushQuery(query)}?type=ITEM`;
}

/** Resolve any search URL to query + edits URL (legacy helper). */
export function resolveSearchFetchUrl(url) {
  const query = extractQueryFromPlushUrl(url);
  if (!query) return null;
  return { query, fetchUrl: editsUrlForQuery(query) };
}

/**
 * Fetch carousel products for a natural-language prompt via Plush chat.
 * createChat → sendChatMessage → getResultBySearchId
 */
export async function fetchCarouselFromQuery(query, { limit = 8 } = {}) {
  const cleaned = String(query || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    throw new Error('Search query is required');
  }

  return fetchProductsViaChat(cleaned, { limit });
}

/**
 * Fetch carousel products for a Plush chat / edits / results URL.
 * Extracts the stable query string — chat IDs are not reusable.
 */
export async function fetchCarouselFromUrl(url, { limit = 8 } = {}) {
  if (!isPlushSearchUrl(url)) {
    throw new Error('Invalid plush.shop search URL (expected /chat/, /edits/, or /results/)');
  }

  const query = extractQueryFromPlushUrl(url);
  if (!query) {
    throw new Error('Could not extract search query from URL');
  }

  return fetchCarouselFromQuery(query, { limit });
}
