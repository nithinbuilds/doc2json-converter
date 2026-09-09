import { NextResponse } from 'next/server';
import { fetchCarouselFromUrl } from '@/utils/plush-carousel';

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const { oids, query, found } = await fetchCarouselFromUrl(url);
    return NextResponse.json({ oids, query, found });
  } catch (error) {
    console.error('fetch-carousel error:', error);
    const status = error.status || (error.message?.includes('Invalid') || error.message?.includes('extract') ? 400 : 500);
    return NextResponse.json({ error: error.message }, { status });
  }
}
