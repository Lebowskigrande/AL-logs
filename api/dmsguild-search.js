export const config = { runtime: 'edge' };

const BASE_URL = 'https://www.dmsguild.com/';
const SEARCH_PATH = 'browse.php';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

const CACHE_HEADERS = {
  'cache-control': 'public, max-age=43200, s-maxage=43200, stale-while-revalidate=86400'
};

const HTML_ACCEPT_HEADER =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

const DEFAULT_USER_AGENT =
  'AL-Logs/1.0 (+https://github.com/Lebowskigrande/AL-logs)';

const respond = (body, { status = 200, headers = {}, json = true } = {}) => {
  const responseHeaders = { ...corsHeaders, ...headers };
  if (json) {
    if (!('content-type' in responseHeaders)) {
      responseHeaders['content-type'] = 'application/json; charset=utf-8';
    }
    return new Response(JSON.stringify(body), { status, headers: responseHeaders });
  }
  return new Response(body, { status, headers: responseHeaders });
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const decodeHtmlEntities = (value) => {
  if (!value) return '';
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  };
  return String(value)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      if (!entity) return match;
      if (entity[0] === '#') {
        const isHex = entity[1] === 'x' || entity[1] === 'X';
        const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        if (Number.isFinite(code)) {
          try {
            return String.fromCodePoint(code);
          } catch (err) {
            return match;
          }
        }
        return match;
      }
      const lower = entity.toLowerCase();
      if (lower in named) {
        return named[lower];
      }
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();
};

const stripTags = (html) => decodeHtmlEntities(String(html || '').replace(/<[^>]*>/g, ' '));

const normalizeLookupValue = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const normalizeUrl = (value, base = BASE_URL) => {
  try {
    if (!value) return null;
    return new URL(value, base).toString();
  } catch (err) {
    return null;
  }
};

const findMetaContent = (html, attr, value) => {
  if (!html) return null;
  const attrPattern = `${attr}=["']${escapeRegExp(value)}["']`;
  const regex = new RegExp(`<meta[^>]*${attrPattern}[^>]*>`, 'i');
  const match = regex.exec(html);
  if (!match) return null;
  const contentMatch = match[0].match(/content=["']([^"']+)["']/i);
  if (!contentMatch) return null;
  return decodeHtmlEntities(contentMatch[1]);
};

const extractJsonLdBlocks = (html) => {
  if (!html) return [];
  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = match[1] ? match[1].trim() : '';
    if (raw) {
      blocks.push(raw);
    }
  }
  return blocks;
};

const findProductNode = (data, seen = new Set()) => {
  if (!data || typeof data !== 'object') return null;
  if (seen.has(data)) return null;
  seen.add(data);
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findProductNode(item, seen);
      if (found) return found;
    }
    return null;
  }
  const typeRaw = data['@type'];
  if (typeRaw) {
    const types = Array.isArray(typeRaw) ? typeRaw : [typeRaw];
    if (types.some((type) => String(type).toLowerCase() === 'product')) {
      return data;
    }
  }
  if (data['@graph']) {
    const nested = findProductNode(data['@graph'], seen);
    if (nested) return nested;
  }
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') {
      const nested = findProductNode(value, seen);
      if (nested) return nested;
    }
  }
  return null;
};

const parseJsonLdProduct = (html) => {
  const blocks = extractJsonLdBlocks(html);
  for (const raw of blocks) {
    try {
      const parsed = JSON.parse(raw);
      const product = findProductNode(parsed);
      if (product) {
        return product;
      }
    } catch (err) {
      // ignore JSON parse errors
    }
  }
  return null;
};

const extractName = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = extractName(item);
      if (name) return name;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (value.name) {
      return String(value.name).trim();
    }
    if (value['@id']) {
      return String(value['@id']).trim();
    }
    return null;
  }
  return String(value || '').trim();
};

const parseProductMetadata = (html, productUrl) => {
  const meta = {
    title: null,
    author: null,
    publicationDate: null,
    rating: null,
    ratingCount: null,
    image: null,
    thumbnail: null,
    url: normalizeUrl(productUrl || BASE_URL)
  };

  const product = parseJsonLdProduct(html);
  if (product) {
    if (product.name) {
      meta.title = String(product.name).trim();
    }
    if (product.image) {
      const images = Array.isArray(product.image) ? product.image : [product.image];
      const primary = images.find((item) => typeof item === 'string');
      if (primary) {
        meta.image = normalizeUrl(primary, productUrl || BASE_URL);
      }
    }
    if (product.url) {
      const resolved = normalizeUrl(product.url, productUrl || BASE_URL);
      if (resolved) {
        meta.url = resolved;
      }
    }
    meta.author = extractName(product.author) || extractName(product.creator) || extractName(product.brand) || meta.author;
    meta.publicationDate = normalizeLookupValue(product.datePublished || product.releaseDate || meta.publicationDate);

    const aggregate = product.aggregateRating;
    if (aggregate && typeof aggregate === 'object') {
      const ratingValue = Number(aggregate.ratingValue || aggregate.ratingValueAverage || aggregate.rating);
      if (Number.isFinite(ratingValue)) {
        meta.rating = ratingValue;
      }
      const ratingCount = Number(aggregate.reviewCount || aggregate.ratingCount || aggregate.ratingValueCount);
      if (Number.isFinite(ratingCount)) {
        meta.ratingCount = ratingCount;
      }
    }
  }

  if (!meta.image) {
    const ogImage = findMetaContent(html, 'property', 'og:image') || findMetaContent(html, 'name', 'twitter:image');
    if (ogImage) {
      meta.image = normalizeUrl(ogImage, productUrl || BASE_URL);
    }
  }

  if (!meta.thumbnail) {
    meta.thumbnail = meta.image;
  }

  if (!meta.title) {
    const ogTitle = findMetaContent(html, 'property', 'og:title');
    if (ogTitle) {
      meta.title = decodeHtmlEntities(ogTitle);
    }
  }

  if (!meta.author) {
    const authorMeta = findMetaContent(html, 'name', 'author');
    if (authorMeta) {
      meta.author = decodeHtmlEntities(authorMeta);
    }
  }

  if (!meta.publicationDate) {
    const dateMeta =
      findMetaContent(html, 'itemprop', 'datePublished') || findMetaContent(html, 'name', 'date');
    if (dateMeta) {
      meta.publicationDate = normalizeLookupValue(dateMeta);
    }
  }

  if (meta.rating == null) {
    const ratingMeta = findMetaContent(html, 'itemprop', 'ratingValue');
    const ratingValue = Number(ratingMeta);
    if (Number.isFinite(ratingValue)) {
      meta.rating = ratingValue;
    }
  }

  if (meta.ratingCount == null) {
    const countMeta = findMetaContent(html, 'itemprop', 'ratingCount') || findMetaContent(html, 'itemprop', 'reviewCount');
    const ratingCount = Number(countMeta);
    if (Number.isFinite(ratingCount)) {
      meta.ratingCount = ratingCount;
    }
  }

  if (meta.image && !meta.thumbnail) {
    meta.thumbnail = meta.image;
  }

  return meta;
};

const extractSearchCandidates = (html) => {
  if (!html) return [];
  const candidates = [];
  const anchorRegex = /<a[^>]+href=["']([^"']*(?:product|product_info)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html))) {
    const href = normalizeUrl(match[1], BASE_URL);
    if (!href) continue;
    const text = stripTags(match[2]);
    if (!text) continue;
    candidates.push({ url: href, text });
  }
  return candidates;
};

const scoreCandidate = (candidate, { code, title }) => {
  let score = 0;
  const text = candidate.text.toLowerCase();
  const codeText = normalizeLookupValue(code).toLowerCase();
  if (codeText && text.includes(codeText)) {
    score += 6;
  }
  const titleText = normalizeLookupValue(title).toLowerCase();
  if (titleText) {
    if (text.includes(titleText)) {
      score += 4;
    }
    const words = titleText.split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
    let matches = 0;
    for (const word of words) {
      if (text.includes(word)) {
        matches += 1;
      }
    }
    score += matches * 0.75;
    if (matches === words.length && words.length > 0) {
      score += 1;
    }
  }
  return score;
};

const resolveProductFromSearch = (html, { code, title }) => {
  const candidates = extractSearchCandidates(html);
  if (!candidates.length) {
    return null;
  }
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const candidateScore = scoreCandidate(candidate, { code, title });
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      best = candidate;
    }
  }
  return best;
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return respond(null, { json: false });
  }

  if (req.method !== 'GET') {
    return respond({ error: 'Use GET' }, { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const code = normalizeLookupValue(url.searchParams.get('code'));
    const title = normalizeLookupValue(url.searchParams.get('title'));

    if (!code && !title) {
      return respond({ error: 'Provide an adventure code or title.' }, { status: 400 });
    }

    const queryParts = [];
    if (code) queryParts.push(code);
    if (title) queryParts.push(title);
    const query = queryParts.join(' ').trim();

    const searchUrl = `${BASE_URL}${SEARCH_PATH}?keywords=${encodeURIComponent(query)}`;
    const requestHeaders = {
      'user-agent': DEFAULT_USER_AGENT,
      accept: HTML_ACCEPT_HEADER
    };

    const searchResponse = await fetch(searchUrl, { headers: requestHeaders });
    if (!searchResponse.ok) {
      return respond(
        { error: 'Dungeon Masters Guild search request failed.' },
        { status: 502 }
      );
    }

    const searchHtml = await searchResponse.text();
    const productCandidate = resolveProductFromSearch(searchHtml, { code, title });

    if (!productCandidate) {
      return respond(
        { error: 'No matching Dungeon Masters Guild product found.' },
        { status: 404, headers: CACHE_HEADERS }
      );
    }

    const productResponse = await fetch(productCandidate.url, { headers: requestHeaders });
    if (!productResponse.ok) {
      return respond(
        { error: 'Unable to load Dungeon Masters Guild product page.' },
        { status: 502 }
      );
    }

    const productHtml = await productResponse.text();
    const metadata = parseProductMetadata(productHtml, productCandidate.url);

    if (!metadata.thumbnail && metadata.image) {
      metadata.thumbnail = metadata.image;
    }
    if (!metadata.url) {
      metadata.url = productCandidate.url;
    }
    if (!metadata.title) {
      metadata.title = productCandidate.text || title || code || null;
    }

    return respond(
      {
        data: metadata,
        meta: {
          searchUrl,
          productUrl: metadata.url
        }
      },
      { headers: CACHE_HEADERS }
    );
  } catch (err) {
    return respond({ error: String(err) }, { status: 500 });
  }
}
