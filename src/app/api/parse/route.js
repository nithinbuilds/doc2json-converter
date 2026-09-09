import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
  isPlushSearchUrl,
  extractQueryFromPlushUrl,
  fetchCarouselFromUrl,
} from '@/utils/plush-carousel';

function extractGoogleDocId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Parse Google Docs exported CSS to build a class → style feature map.
 * Google Docs uses classes like .c3 { font-weight:700 } instead of <b> tags.
 */
function buildCssClassMap(html) {
  const classMap = {};
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return classMap;

  const css = styleMatch[1];

  // Match each rule block, e.g.: .c3{font-weight:700;font-style:italic}
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  while ((match = ruleRegex.exec(css)) !== null) {
    const selectors = match[1].trim();
    const declarations = match[2].trim();

    const isBold =
      /font-weight\s*:\s*700/.test(declarations) ||
      /font-weight\s*:\s*bold/.test(declarations);
    const isItalic = /font-style\s*:\s*italic/.test(declarations);
    const isLineThrough = /text-decoration\s*:\s*line-through/.test(declarations);
    const isUnderline = /text-decoration\s*:\s*underline/.test(declarations);

    selectors.split(',').forEach((sel) => {
      sel = sel.trim();
      // Match class-only selectors like .c3 or compound like .c3.c5
      const classMatches = sel.match(/\.([a-zA-Z0-9_-]+)/g);
      if (classMatches) {
        // Use the last class name if compound
        const className = classMatches[classMatches.length - 1].substring(1);
        if (!classMap[className]) classMap[className] = {};
        if (isBold) classMap[className].bold = true;
        if (isItalic) classMap[className].italic = true;
        if (isLineThrough) classMap[className].lineThrough = true;
      }
    });
  }

  return classMap;
}

/**
 * Resolve formatting from an element's class list using the CSS map.
 */
function getFormattingFromClasses($el, classMap) {
  const fmt = {};
  const classes = ($el.attr('class') || '').split(/\s+/);
  for (const cls of classes) {
    if (classMap[cls]) {
      if (classMap[cls].bold) fmt.bold = true;
      if (classMap[cls].italic) fmt.italic = true;
      if (classMap[cls].lineThrough) fmt.lineThrough = true;
    }
  }
  return fmt;
}

/**
 * Recursively parse an element's children into rich text segments.
 * Merges adjacent segments with the same formatting.
 */
function parseSegments($, el, classMap, inheritedFmt = {}) {
  const segments = [];

  $(el)
    .contents()
    .each((_, node) => {
      if (node.type === 'text') {
        const text = node.data;
        if (!text || !text.trim()) return;
        segments.push({ content: text, ...inheritedFmt });
      } else if (node.type === 'tag') {
        const tag = node.name;
        const $node = $(node);
        let fmt = { ...inheritedFmt };

        // Explicit HTML semantic tags
        if (tag === 'b' || tag === 'strong') fmt.bold = true;
        if (tag === 'i' || tag === 'em') fmt.italic = true;
        if (tag === 's' || tag === 'strike') fmt.lineThrough = true;

        // CSS class-based formatting (Google Docs style)
        const classFmt = getFormattingFromClasses($node, classMap);
        Object.assign(fmt, classFmt);

        if (tag === 'a') {
          let href = $node.attr('href') || '';
          // Google Docs wraps links with redirect URLs — extract the real URL
          if (href.includes('google.com/url?')) {
            try {
              href = new URL(href).searchParams.get('q') || href;
            } catch (_) {}
          }
          fmt.link = href;
        }

        if (tag === 'img') {
          // Images are handled at the block level, skip them here
          return;
        }

        // Recurse into children
        const childSegments = parseSegments($, node, classMap, fmt);
        segments.push(...childSegments);
      }
    });

  // Merge adjacent segments with identical formatting
  const merged = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    const { content, ...rest } = seg;
    if (
      last &&
      JSON.stringify({ ...last, content: undefined }) ===
        JSON.stringify({ ...seg, content: undefined })
    ) {
      last.content += content;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.filter((s) => s.content && s.content.trim());
}

/**
 * Core processor: converts the fetched HTML into our target JSON structure.
 */
function processHtmlToJSON(html, docId, blogNo) {
  const $ = cheerio.load(html);
  const classMap = buildCssClassMap(html);

  // -- Extract Title --
  // Google Docs uses <p class="title"> or the <title> HTML tag
  let title = '';
  const $titleEl = $('p.title').first();
  if ($titleEl.length) {
    title = $titleEl.text().trim();
  }
  if (!title) {
    const $h1 = $('h1').first();
    if ($h1.length) title = $h1.text().trim();
  }
  if (!title) {
    // Fallback: strip "- Google Docs" from HTML title
    const htmlTitle = $('title').text().trim();
    title = htmlTitle.replace(/\s*-\s*Google Docs\s*$/i, '').trim();
  }

  const customJson = {
    _id: { $oid: 'CUSTOM_ID' },
    title,
    author: 'Plush',
    date: { $date: { $numberLong: 'CUSTOM_DATE' } },
    summary: '',
    image: '',
    content: [],
    seo_url: 'auto-generated-url',
  };

  let summarySet = false;
  let imageCounter = 0;

  // Helper: generate image name
  const getImageName = () => {
    imageCounter++;
    return blogNo ? `From drive: plush-blog-${blogNo}-${imageCounter}` : '';
  };

  // -- Walk all top-level blocks --
  // Google Docs wraps everything in a single <div> body, so we
  // select all meaningful block-level elements globally.
  const blockSelector = 'h1, h2, h3, h4, h5, h6, p, ul, ol, table, img';

  $(blockSelector)
    .filter((_, el) => {
      // Skip elements nested inside other block elements we already handle
      return (
        $(el).parents('p, ul, ol, table, h1, h2, h3, h4, h5, h6').length === 0
      );
    })
    .each((_, el) => {
      const tag = el.name;
      const $el = $(el);

      // -- Standalone img tags --
      if (tag === 'img') {
        const src = $el.attr('src') || '';
        if (src) {
          const name = getImageName();
          const isFirst = imageCounter === 1;
          if (isFirst) customJson.image = name || src;
          // Don't add first image to content (it's already in image field)
          if (!isFirst) {
            customJson.content.push({ type: 'Image', url: name || src, altText: $el.attr('alt') || '' });
          }
        }
        return;
      }

      // -- <img> tags nested inside paragraphs/divs --
      const nestedImgs = $el.find('img');
      nestedImgs.each((_, imgEl) => {
        const src = $(imgEl).attr('src') || '';
        if (src) {
          const name = getImageName();
          const isFirst = imageCounter === 1;
          if (isFirst) customJson.image = name || src;
          if (!isFirst) {
            customJson.content.push({ type: 'Image', url: name || src, altText: $(imgEl).attr('alt') || '' });
          }
        }
      });

      const rawText = $el.text().trim();
      if (!rawText && nestedImgs.length === 0) return;
      if (!rawText) return;

      // -- Skip the title paragraph itself (already captured above) --
      if ($el.hasClass('title')) return;

      // -- Heading blocks → Subtitle --
      if (['h1', 'h2'].includes(tag)) {
        // Skip H1 if it is the document title (already stored in customJson.title)
        if (tag === 'h1' && rawText === customJson.title) return;
        customJson.content.push({ type: 'Subtitle', content: rawText });
        return;
      }

      // -- H3+ blocks → Bold Paragraph --
      if (['h3', 'h4', 'h5', 'h6'].includes(tag)) {
        const segments = parseSegments($, $el[0], classMap);
        segments.forEach(s => s.bold = true); // Force bold as requested
        if (segments.length > 0) {
          customJson.content.push({ type: 'Paragraph', isHeading: true, segments });
        }
        return;
      }

      // -- Google Docs "subtitle" class --
      if ($el.hasClass('subtitle')) {
        if (!summarySet) {
          customJson.summary = rawText.replace(/^Summary:\s*/i, '').trim();
          summarySet = true;
          // Don't push to content — already captured in summary field
          return;
        }
        customJson.content.push({ type: 'Subtitle', content: rawText });
        return;
      }

      // -- List blocks --
      if (tag === 'ul' || tag === 'ol') {
        const listItems = [];
        $el.find('> li, li').each((_, li) => {
          const segments = parseSegments($, li, classMap);
          if (segments.length > 0) listItems.push({ segments });
        });
        if (listItems.length > 0) {
          customJson.content.push({ type: 'List', items: listItems });
        }
        return;
      }

      // -- Table blocks --
      // User explicitly requested to omit tables entirely
      if (tag === 'table') {
        return;
      }

      // -- Paragraph blocks --
      if (tag === 'p') {
        const segments = parseSegments($, el, classMap);
        if (segments.length === 0) return;

        // Parse Google Docs image caption blocks: "Image: [url]"
        if (/^Image:\s*/i.test(rawText)) {
          // Mark flag so next line can apply alt text
          return;
        }

        // "Alt Text:" / "Alt text:" line — apply to the last Image block in content
        if (/^Alt[\s_-]?[Tt]ext:\s*/i.test(rawText)) {
          const altText = rawText.replace(/^Alt[\s_-]?[Tt]ext:\s*/i, '').trim();
          for (let i = customJson.content.length - 1; i >= 0; i--) {
            if (customJson.content[i].type === 'Image') {
              customJson.content[i].altText = altText;
              break;
            }
          }
          // Also try to apply to the customJson.image (first image)
          if (customJson._firstImageNeedsAlt) {
            customJson._firstImageAlt = altText;
            customJson._firstImageNeedsAlt = false;
          }
          return;
        }

        // First non-empty paragraph becomes the summary if not already set
        if (!summarySet) {
          customJson.summary = rawText.replace(/^Summary:\s*/i, '').trim();
          summarySet = true;
          // Don't push to content — already captured in summary field
          return;
        }

        customJson.content.push({ type: 'Paragraph', segments });
      }
    });


  // -- Post-process: merge consecutive Paragraph and List blocks into one --
  const merged = [];
  for (const block of customJson.content) {
    const last = merged[merged.length - 1];
    
    if (block.type === 'Paragraph') {
      if (last && last.type === 'Paragraph') {
        // Separator between merged paragraphs (only if the previous block didn't end with a List)
        const lastSeg = last.segments[last.segments.length - 1];
        if (!lastSeg || lastSeg.type !== 'List') {
          last.segments.push({ content: last.isHeading ? '\n' : '\n\n' });
        }
        last.segments.push(...block.segments);
        last.isHeading = block.isHeading;
      } else {
        merged.push(block);
      }
    } else if (block.type === 'List') {
      if (last && last.type === 'Paragraph') {
        // Nest list inside the preceding paragraph
        last.segments.push(block);
      } else {
        // If there's no preceding paragraph, wrap the list inside a new paragraph
        merged.push({ type: 'Paragraph', segments: [block] });
      }
    } else {
      merged.push(block);
    }
  }
  
  // Cleanup internal flags
  for (const block of merged) {
    if (block.type === 'Paragraph') delete block.isHeading;
  }
  
  customJson.content = merged;

  // -- Add trailing metadata requested by user --
  customJson.seo_url = customJson.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  customJson.staging_only = true;

  return customJson;
}

// Split a merged paragraph's segments into prompt-based sections
function splitIntoPromptSections(allSegments) {
  const isPlush = (s) => isPlushSearchUrl(s.link);

  // Split at \n\n into groups  
  const groups = [];
  let curr = [];
  for (const seg of allSegments) {
    if (seg.content === '\n\n') {
      if (curr.length > 0) groups.push([...curr]);
      curr = [];
    } else {
      curr.push(seg);
    }
  }
  if (curr.length > 0) groups.push(curr);

  // A section is only a prompt if it actually contains a bolded Prompt keyword.
  const hasPromptKeyword = (g) => g.some(s => s.bold === true && s.content.trim().toLowerCase().includes('prompt'));
  const hasRefineKeyword = (g) => g.some(s => s.content.trim().toLowerCase().startsWith('refine'));

  if (!groups.some(g => hasPromptKeyword(g))) return null;

  // Categorize each group strictly
  const cats = groups.map((g, i) => {
    if (hasPromptKeyword(g)) return 'prompt';
    if (hasRefineKeyword(g)) return 'refine';
    if (i + 1 < groups.length && hasPromptKeyword(groups[i + 1])) return 'header';
    return 'intro';
  });

  const introSegs = [];
  const sections = [];

  for (let i = 0; i < groups.length; i++) {
    const cat = cats[i];
    const segs = groups[i];
    if (cat === 'intro') {
      if (introSegs.length > 0) introSegs.push({ content: '\n\n' });
      introSegs.push(...segs);
    } else if (cat === 'header') {
      sections.push({ headerSegs: segs, promptSegs: null, refineSegs: null, url: null });
    } else if (cat === 'prompt') {
      const url = segs.find(isPlush)?.link || null;
      const last = sections[sections.length - 1];
      if (last && !last.promptSegs) {
        last.promptSegs = segs;
        last.url = url;
      } else {
        sections.push({ headerSegs: null, promptSegs: segs, refineSegs: null, url });
      }
    } else if (cat === 'refine') {
      if (sections.length > 0) sections[sections.length - 1].refineSegs = segs;
    }
  }

  return { introSegs: introSegs.length > 0 ? introSegs : null, sections };
}

async function fetchOids(url) {
  try {
    const { oids } = await fetchCarouselFromUrl(url);
    return oids;
  } catch (e) {
    console.error('fetchOids failed for', url, e.message);
    return [];
  }
}

async function autoInjectCarousels(parsedJson) {
  // Collect all unique plush search URLs (chat / edits / results)
  const urlSet = new Set();
  for (const block of parsedJson.content) {
    if (block.type === 'Paragraph') {
      block.segments?.forEach((s) => {
        if (isPlushSearchUrl(s.link)) urlSet.add(s.link);
      });
    }
  }

  // Fetch all OIDs in parallel
  const oidCache = {};
  await Promise.all(
    [...urlSet].map(async (url) => {
      oidCache[url] = await fetchOids(url);
    })
  );

  const output = [];
  for (const block of parsedJson.content) {
    if (block.type !== 'Paragraph' || !block.segments?.some((s) => isPlushSearchUrl(s.link))) {
      output.push(block);
      continue;
    }

    const split = splitIntoPromptSections(block.segments);
    if (!split) {
      output.push(block);
      continue;
    }

    for (let i = 0; i < split.sections.length; i++) {
      const sec = split.sections[i];
      // Prompt paragraph (intro + header + prompt + refine merged)
      const promptSegs = [];

      // Inject the intro blocks natively at the very top of the first section
      if (i === 0 && split.introSegs?.length) {
        promptSegs.push(...split.introSegs);
        promptSegs.push({ content: '\n\n' });
      }

      if (sec.headerSegs?.length) {
        promptSegs.push(...sec.headerSegs);
        promptSegs.push({ content: '\n\n' });
      }
      if (sec.promptSegs?.length) promptSegs.push(...sec.promptSegs);

      // Merge refine paragraph seamlessly into the same block
      if (sec.refineSegs?.length) {
        if (promptSegs.length) promptSegs.push({ content: '\n\n' });
        promptSegs.push(...sec.refineSegs);
      }

      if (promptSegs.length) output.push({ type: 'Paragraph', segments: promptSegs });

      // Carousel — query comes from ?query= (chat) or path (edits/results)
      if (sec.url && oidCache[sec.url]?.length) {
        const query = extractQueryFromPlushUrl(sec.url) || '';
        output.push({ type: 'PlushSearchCarousel', query, items: oidCache[sec.url] });
      }
    }
  }

  parsedJson.content = output;
}

export async function POST(req) {
  try {
    const { url, blogNo } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const docId = extractGoogleDocId(url);
    if (!docId) {
      return NextResponse.json({ error: 'Invalid Google Docs URL' }, { status: 400 });
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;

    const response = await fetch(exportUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Doc2JSON/1.0)' },
      redirect: 'follow',
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 403) {
        return NextResponse.json(
          {
            error:
              'Document is private. Set the Google Doc sharing to "Anyone with the link can view" and try again.',
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: `Failed to fetch document (HTTP ${status})` },
        { status }
      );
    }

    const html = await response.text();
    const parsedJson = processHtmlToJSON(html, docId, blogNo);
    await autoInjectCarousels(parsedJson);

    return NextResponse.json({
      success: true,
      original: parsedJson.title,
      json: parsedJson,
    });
  } catch (error) {
    console.error('Error parsing Google Doc:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
