const OPENVERSE = 'https://api.openverse.org/v1/images/';
const MAX_RESULTS = 6;
const SEARCH_DEADLINE_MS = 20_000;

export type FoundImage = { url: string; width: number; height: number; title: string; source: string };

type OpenverseResult = {
  url?: string;
  width?: number | null;
  height?: number | null;
  title?: string | null;
  source?: string;
  license?: string;
  mature?: boolean;
};

async function search(query: string, source: string | null, orientation: string | null): Promise<FoundImage[]> {
  const params = new URLSearchParams({ q: query, license: 'cc0', page_size: '20', mature: 'false' });
  if (source) params.set('source', source);
  if (orientation === 'landscape') params.set('aspect_ratio', 'wide');
  if (orientation === 'portrait') params.set('aspect_ratio', 'tall');
  if (orientation === 'square') params.set('aspect_ratio', 'square');

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(`${OPENVERSE}?${params}`, {
      headers: { 'User-Agent': 'inkling-image-search' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok || ![429, 502, 503].includes(response.status)) break;
    await Bun.sleep(1200 * (attempt + 1));
  }
  if (!response?.ok) throw new Error(`image search failed: ${response?.status}`);

  const data = (await response.json()) as { results?: OpenverseResult[] };
  return (data.results ?? [])
    .filter((item) => item.url && item.license === 'cc0' && !item.mature)
    .filter((item) => (item.width ?? 0) >= 800 && (item.height ?? 0) >= 500)
    .filter((item) => /^https:\/\//.test(item.url!) && !/\.(svg|gif)(\?|$)/i.test(item.url!))
    .map((item) => ({
      url: item.url!,
      width: item.width ?? 0,
      height: item.height ?? 0,
      title: (item.title ?? '').slice(0, 80),
      source: item.source ?? 'openverse',
    }));
}

const ARCHIVAL_TITLE = /\b(plate|dpla|illustration|engraving|lithograph|diagram|map|chart|manuscript|page|scan|book|catalog|catalogue|poster|drawing|painting|coat of arms|logo|\d{4}s?)\b/i;

async function searchCommons(query: string, orientation: string | null): Promise<FoundImage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata|mime',
    iiurlwidth: '1600',
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'InklingImageSearch/1.0 (https://github.com/deepanshuliv/my-lovable)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`commons search failed: ${response.status}`);
  type Info = { url?: string; thumburl?: string; width?: number; height?: number; mime?: string; extmetadata?: Record<string, { value?: string }> };
  const data = (await response.json()) as { query?: { pages?: Record<string, { title?: string; index?: number; imageinfo?: Info[] }> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .map((page) => ({ page, info: page.imageinfo?.[0] }))
    .filter(({ info }) => {
      if (!info || !/jpeg|png|webp/.test(info.mime ?? '')) return false;
      const license = `${info.extmetadata?.LicenseShortName?.value ?? ''} ${info.extmetadata?.License?.value ?? ''}`.toLowerCase();
      return /cc0|public domain|\bpd\b|pdm/.test(license);
    })
    .filter(({ info }) => (info!.width ?? 0) >= 800 && (info!.height ?? 0) >= 500)
    .filter(({ page }) => !ARCHIVAL_TITLE.test(page.title ?? ''))
    .filter(({ info }) => {
      const ratio = (info!.width ?? 1) / (info!.height ?? 1);
      if (orientation === 'landscape') return ratio > 1.15;
      if (orientation === 'portrait') return ratio < 0.9;
      if (orientation === 'square') return ratio > 0.8 && ratio < 1.25;
      return true;
    })
    .map(({ page, info }) => ({
      url: info!.thumburl ?? info!.url!,
      width: info!.width ?? 0,
      height: info!.height ?? 0,
      title: (page.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '').slice(0, 80),
      source: 'wikimedia',
    }));
}

async function searchAll(query: string, shape: string | null): Promise<FoundImage[]> {
  const settled = await Promise.allSettled([
    search(query, 'rawpixel', shape),
    search(query, null, shape),
    searchCommons(query, shape),
  ]);
  const found: FoundImage[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      found.push(item);
    }
  }
  return found.slice(0, MAX_RESULTS);
}

const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 60 * 60 * 1000;

export async function findImagesBatch(queries: string[], orientation?: string): Promise<string> {
  const unique = [...new Set(queries.map((query) => String(query ?? '').trim()).filter(Boolean))].slice(0, 6);
  if (unique.length === 0) return 'ERROR: queries cannot be empty. Describe each photo subject, like "yoga class outdoors".';
  const results = await Promise.all(
    unique.map((query) =>
      Promise.race([
        findImages(query, orientation),
        Bun.sleep(SEARCH_DEADLINE_MS).then(
          () => `No photos found in time for "${query}". Use https://picsum.photos/seed/${encodeURIComponent(query.replace(/\s+/g, '-'))}/1200/800 instead.`,
        ),
      ]),
    ),
  );
  return results.join('\n\n');
}

export async function findImages(query: string, orientation?: string): Promise<string> {
  const key = `${String(query ?? '').trim().toLowerCase()}|${orientation ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  const text = await findImagesUncached(query, orientation);
  if (!text.startsWith('ERROR')) cache.set(key, { at: Date.now(), text });
  return text;
}

async function findImagesUncached(query: string, orientation?: string): Promise<string> {
  const cleaned = String(query ?? '').trim().slice(0, 80);
  if (!cleaned) return 'ERROR: query cannot be empty. Describe the photo subject, like "yoga class outdoors".';
  const shape = orientation && ['landscape', 'portrait', 'square'].includes(orientation) ? orientation : null;

  try {
    let found = await searchAll(cleaned, shape);
    const words = cleaned.split(/\s+/);
    if (found.length === 0 && words.length > 1) found = await searchAll(words.slice(-2).join(' '), shape);
    if (found.length === 0 && words.length > 2) found = await searchAll(words[words.length - 1]!, shape);

    if (found.length === 0) {
      return `No public-domain photos found for "${cleaned}". Try a simpler subject (one or two words), or fall back to https://picsum.photos/seed/<keyword>/1200/800.`;
    }

    return [
      `Public-domain or CC0 photos for "${cleaned}". Free to use, no copyright, no attribution needed. Use these exact URLs in plain <img> tags:`,
      ...found.map((item, index) => `${index + 1}. ${item.url}  (${item.width}x${item.height}${item.title ? `, "${item.title}"` : ''})`),
    ].join('\n');
  } catch (error) {
    return `ERROR: image search is unavailable right now (${String((error as Error).message).slice(0, 120)}). Fall back to https://picsum.photos/seed/<keyword>/1200/800.`;
  }
}
