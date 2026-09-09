import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
  isPlushProductUrl,
  isPlushSearchUrl,
  fetchCarouselFromUrl,
} from '@/utils/plush-carousel';

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url || (!isPlushProductUrl(url) && !isPlushSearchUrl(url))) {
      return NextResponse.json(
        { error: 'Invalid plush.shop product or search URL' },
        { status: 400 }
      );
    }

    // Search URLs (chat / edits / results): return the first carousel product
    if (isPlushSearchUrl(url) && !isPlushProductUrl(url)) {
      const { oids } = await fetchCarouselFromUrl(url, { limit: 1 });
      if (!oids.length) {
        return NextResponse.json({ error: 'Could not identify product OID' }, { status: 404 });
      }
      return NextResponse.json(oids[0]);
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch product (HTTP ${response.status})` },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Parse the Next.js Apollo state to get name and image details
    let apolloState = {};
    const matchData = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (matchData) {
      try {
        const nextData = JSON.parse(matchData[1]);
        apolloState = nextData.props?.pageProps?.__APOLLO_STATE__ || {};
      } catch (e) {}
    }

    // Find the item in the Apollo state
    const item = Object.values(apolloState).find((v) => v.__typename === 'Item');

    if (!item) {
      // Fallback: try embedded Item JSON, then OID in URL
      const embedded = html.match(/\{"__typename":"Item","id":"([a-f0-9]{24})"/);
      const oidMatch = url.match(/\/([a-f0-9]{24})/);
      const oid = embedded?.[1] || (oidMatch ? oidMatch[1] : null);
      if (!oid) return NextResponse.json({ error: 'Could not identify product OID' }, { status: 404 });

      return NextResponse.json({
        $oid: oid,
        name: 'Product',
        imageUrl: null,
      });
    }

    return NextResponse.json({
      $oid: item.id,
      name: item.brand || item.name,
      imageUrl: item.thumbnailImage,
    });
  } catch (error) {
    console.error('fetch-product error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
