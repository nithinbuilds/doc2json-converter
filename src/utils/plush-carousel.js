import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';

const SEARCH_PATH_RE = /plush\.shop\/(chat|edits|results)\//;
const PLUSH_GRAPHQL = process.env.PLUSH_API_ENDPOINT
  ? `${process.env.PLUSH_API_ENDPOINT.replace(/\/$/, '')}/query`
  : 'https://api.plush.shop/query';

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

/** Resolve any search URL to the edits page that still SSR-embeds product data. */
export function resolveSearchFetchUrl(url) {
  const query = extractQueryFromPlushUrl(url);
  if (!query) return null;
  return { query, fetchUrl: editsUrlForQuery(query) };
}

function parseJsonObjectAt(html, start) {
  const chunk = html.slice(start, start + 2500);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(chunk.slice(0, end));
  } catch {
    return null;
  }
}

function toOidEntry(item, fallbackName, fallbackImage) {
  return {
    $oid: item.id,
    imageUrl: item.thumbnailImage || fallbackImage || null,
    name: item.itemBrand?.name || fallbackName || item.name,
  };
}

/** Primary path for edits pages: search results live in ItemEdge nodes (DOM cards are often CSR). */
function extractFromItemEdges(html, { limit = 8 } = {}) {
  const oids = [];
  const seen = new Set();
  const edgeRe = /\{"__typename":"ItemEdge","node":\{/g;
  let edgeMatch;
  while ((edgeMatch = edgeRe.exec(html)) !== null) {
    if (oids.length >= limit) break;
    const slice = html.slice(edgeMatch.index, edgeMatch.index + 200);
    const itemMatch = slice.match(/\{"__typename":"Item","id":"[a-f0-9]{24}"/);
    if (!itemMatch) continue;
    const item = parseJsonObjectAt(html, edgeMatch.index + itemMatch.index);
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    oids.push(toOidEntry(item));
  }
  return oids;
}

function parseApolloItems(html) {
  const productsByName = {};
  const matchData = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!matchData) return productsByName;
  try {
    const nextData = JSON.parse(matchData[1]);
    const apolloState = nextData.props?.pageProps?.__APOLLO_STATE__ || {};
    Object.values(apolloState).forEach((item) => {
      if (item?.__typename === 'Item' && item.name) {
        productsByName[item.name.trim()] = item;
      }
    });
  } catch {
    // ignore malformed Next data
  }
  return productsByName;
}

/** Pull Item objects embedded in RSC / serialized page payloads. */
function parseEmbeddedItems(html) {
  const productsByName = {};
  const seen = new Set();
  const re = /\{"__typename":"Item","id":"([a-f0-9]{24})"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const item = parseJsonObjectAt(html, match.index);
    if (!item?.id || !item?.name || seen.has(item.id)) continue;
    seen.add(item.id);
    productsByName[item.name.trim()] = item;
  }
  return productsByName;
}

function extractFromDomListing(html, productsByName, { limit = 8 } = {}) {
  const $ = cheerio.load(html);
  const oids = [];
  const seen = new Set();

  $('.product-list .product_listing_item').each((_, el) => {
    if (oids.length >= limit) return false;

    const nameStr = $(el).find('.goods-name-text').text().trim();
    const brandStr = $(el).find('.brand-price').first().text().trim();
    const imgStr = $(el).find('.item_img_over img').first().attr('src');

    if (!nameStr) return;
    const itemInfo = productsByName[nameStr];
    if (!itemInfo || seen.has(itemInfo.id)) return;

    seen.add(itemInfo.id);
    oids.push(toOidEntry(itemInfo, brandStr || nameStr, imgStr));
  });

  return oids;
}

export function extractOidsFromHtml(html, { limit = 8 } = {}) {
  // Soft 404 pages still return HTTP 200
  if (/404\s*-\s*Page Not Found/i.test(html) && !/"__typename":"ItemEdge"/.test(html)) {
    return [];
  }

  const fromEdges = extractFromItemEdges(html, { limit });
  if (fromEdges.length > 0) return fromEdges;

  const productsByName = {
    ...parseApolloItems(html),
    ...parseEmbeddedItems(html),
  };
  const fromDom = extractFromDomListing(html, productsByName, { limit });
  if (fromDom.length > 0) return fromDom;

  const oids = [];
  const seen = new Set();
  for (const item of Object.values(productsByName)) {
    if (oids.length >= limit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    oids.push(toOidEntry(item));
  }
  return oids;
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const SEARCH_QUERY = `
  query SearchItem($query: String!, $first: Int!, $skipPersonalization: Boolean, $type: Search_Type) {
    search(query: $query, first: $first, skipPersonalization: $skipPersonalization, type: $type) {
      items {
        edges {
          node {
            id
            name
            thumbnailImage
            itemBrand { name }
          }
        }
      }
    }
  }
`;

async function fetchOidsViaGraphQL(query, { limit = 8 } = {}) {
  const response = await fetch(PLUSH_GRAPHQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: 'https://www.plush.shop',
      referer: 'https://www.plush.shop/',
      'user-agent': FETCH_HEADERS['User-Agent'],
      'x-device-id': randomUUID(),
    },
    body: JSON.stringify({
      operationName: 'SearchItem',
      query: SEARCH_QUERY,
      variables: {
        query,
        first: limit,
        skipPersonalization: true,
        type: 'ITEM',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const msg = payload.errors.map((e) => e.message).join('; ');
    const err = new Error(msg);
    err.code = payload.errors[0]?.extensions?.code;
    throw err;
  }

  const edges = payload.data?.search?.items?.edges || [];
  return edges
    .map((edge) => edge?.node)
    .filter((node) => node?.id)
    .slice(0, limit)
    .map((node) => toOidEntry(node));
}

async function fetchOidsViaEditsPage(query, { limit = 8 } = {}) {
  const response = await fetch(editsUrlForQuery(query), {
    headers: FETCH_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    const err = new Error(`Failed to fetch page (HTTP ${response.status})`);
    err.status = response.status;
    throw err;
  }

  const html = await response.text();
  return extractOidsFromHtml(html, { limit });
}

/**
 * Fetch carousel products for a natural-language prompt / search query.
 * Prefers the same GraphQL search chat uses; falls back to scraping /edits.
 */
export async function fetchCarouselFromQuery(query, { limit = 8 } = {}) {
  const cleaned = String(query || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    throw new Error('Search query is required');
  }

  try {
    const oids = await fetchOidsViaGraphQL(cleaned, { limit });
    if (oids.length) return { oids, query: cleaned, found: oids.length, source: 'graphql' };
  } catch (e) {
    console.warn('GraphQL carousel fetch failed:', e.message);
  }

  const oids = await fetchOidsViaEditsPage(cleaned, { limit });
  return { oids, query: cleaned, found: oids.length, source: 'edits' };
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
