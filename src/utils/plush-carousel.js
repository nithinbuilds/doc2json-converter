import * as cheerio from 'cheerio';

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
  try {
    return decodeURIComponent(String(raw).replace(/\+/g, ' '));
  } catch {
    return String(raw).replace(/\+/g, ' ');
  }
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
    // Fallback for non-absolute URLs
    const chatMatch = url.match(/[?&]query=([^&]+)/);
    if (chatMatch) return decodePlushQuery(chatMatch[1]);
    const pathMatch = url.match(/\/(?:edits|results)\/([^?#]+)/);
    if (pathMatch) return decodePlushQuery(pathMatch[1]);
  }
  return null;
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
  // 1) Prefer search edges (stable on /edits SSR payloads)
  const fromEdges = extractFromItemEdges(html, { limit });
  if (fromEdges.length > 0) return fromEdges;

  // 2) Legacy results pages: Apollo/DOM name matching
  const productsByName = {
    ...parseApolloItems(html),
    ...parseEmbeddedItems(html),
  };
  const fromDom = extractFromDomListing(html, productsByName, { limit });
  if (fromDom.length > 0) return fromDom;

  // 3) Last resort: first embedded items
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

/**
 * Fetch carousel products for a Plush chat / edits / results URL.
 * Always loads the edits page for the query — chat pages are client-only shells
 * and chat IDs are not reusable.
 */
export async function fetchCarouselFromUrl(url, { limit = 8 } = {}) {
  if (!isPlushSearchUrl(url)) {
    throw new Error('Invalid plush.shop search URL (expected /chat/, /edits/, or /results/)');
  }

  const resolved = resolveSearchFetchUrl(url);
  if (!resolved?.query) {
    throw new Error('Could not extract search query from URL');
  }

  const response = await fetch(resolved.fetchUrl, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    const err = new Error(`Failed to fetch page (HTTP ${response.status})`);
    err.status = response.status;
    throw err;
  }

  const html = await response.text();
  const oids = extractOidsFromHtml(html, { limit });
  return { oids, query: resolved.query, found: oids.length };
}
