import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url || !url.includes('plush.shop/results/')) {
      return NextResponse.json({ error: 'Invalid plush.shop results URL' }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch page (HTTP ${response.status})` },
        { status: response.status }
      );
    }

    const html = await response.text();
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Parse the Next.js Apollo state to get name and image details for OID mapping
    let apolloState = {};
    const matchData = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (matchData) {
      try {
        const nextData = JSON.parse(matchData[1]);
        apolloState = nextData.props?.pageProps?.__APOLLO_STATE__ || {};
      } catch (e) {}
    }

    const productsByName = {};
    Object.values(apolloState).forEach(item => {
      if (item.__typename === 'Item' && item.name) {
        productsByName[item.name.trim()] = item;
      }
    });

    const oids = [];
    const seenMap = new Set();
    $('.product-list .product_listing_item').each((i, el) => {
      if (oids.length >= 8) return;
      
      const nameStr = $(el).find('.goods-name-text').text().trim();
      const brandStr = $(el).find('.brand-price').text().trim();
      const imgStr = $(el).find('.item_img_over img').first().attr('src');
      
      if (nameStr) {
        const itemInfo = productsByName[nameStr];
        if (itemInfo && !seenMap.has(itemInfo.id)) {
          seenMap.add(itemInfo.id);
          oids.push({
            $oid: itemInfo.id,
            imageUrl: itemInfo.thumbnailImage || imgStr,
            name: brandStr || nameStr
          });
        }
      }
    });

    // Decode the query from the URL path
    const rawQuery = url.split('/results/')[1] || '';
    const query = decodeURIComponent(rawQuery).replace(/\+/g, ' ');

    return NextResponse.json({ oids, query, found: oids.length });
  } catch (error) {
    console.error('fetch-carousel error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
