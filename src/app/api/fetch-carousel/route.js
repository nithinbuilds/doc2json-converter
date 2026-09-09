import { NextResponse } from 'next/server';
import {
  fetchCarouselFromUrl,
  fetchCarouselFromQuery,
  isPlushSearchUrl,
} from '@/utils/plush-carousel';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req) {
  try {
    const body = await req.json();
    const { url, query } = body || {};

    if (query && String(query).trim()) {
      const result = await fetchCarouselFromQuery(String(query).trim());
      return NextResponse.json(result);
    }

    if (url && isPlushSearchUrl(url)) {
      const result = await fetchCarouselFromUrl(url);
      return NextResponse.json(result);
    }

    if (url && String(url).trim() && !String(url).includes('://')) {
      const result = await fetchCarouselFromQuery(String(url).trim());
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: 'Provide a search prompt or a plush.shop chat/edits/results URL' },
      { status: 400 }
    );
  } catch (error) {
    console.error('fetch-carousel error:', error);
    const status =
      error.status ||
      (error.message?.includes('Invalid') ||
      error.message?.includes('required') ||
      error.message?.includes('extract')
        ? 400
        : 500);
    return NextResponse.json({ error: error.message }, { status });
  }
}
