export const config = { runtime: 'edge' };

const BASE_HOST = 'https://www.dmsguild.com/';
const SEARCH_PATH = 'product/search.php';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function respondJson(body, { status = 200, headers = {} } = {}) {
  const responseHeaders = { ...corsHeaders, ...headers };
  if (!('content-type' in responseHeaders)) {
    responseHeaders['content-type'] = JSON_CONTENT_TYPE;
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function normalizeForComparison(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeLookupValue(value) {
  return String(value || '').trim();
}

function decodeHtmlEntities(input) {
  if (!input) return '';
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const codePoint = parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith('#')) {
      const codePoint = parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    switch (lower) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'nbsp':
        return ' ';
      default:
        return match;
    }
  });
}

function stripTags(input) {
  return String(input || '').replace(/<[^>]*>/g, ' ');
}

function toAbsoluteUrl(href) {
  try {
    return new URL(href, BASE_HOST).toString();
  } catch (err) {
    return null;
  }
}

function extractProductCandidates(html) {
  const candidates = [];
  if (!html) {
    return candidates;
  }

  const anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html))) {
    const href = match[1];
    if (!href) continue;
    if (!(/\/product\//i.test(href) || /product_info\.php/i.test(href))) {
      continue;
    }
    const absoluteUrl = toAbsoluteUrl(href);
    if (!absoluteUrl) continue;
    const innerHtml = match[2];
    const textContent = decodeHtmlEntities(stripTags(innerHtml)).trim();
    const normalizedText = normalizeForComparison(textContent);
    if (!normalizedText) continue;
    candidates.push({
      url: absoluteUrl,
      text: textContent,
      normalizedText
    });
  }
  return candidates;
}

function scoreCandidate(candidate, { normalizedTitle, normalizedCode }) {
  let score = 0;
  if (!candidate) return score;
  if (normalizedTitle) {
    if (candidate.normalizedText === normalizedTitle) {
      score += 1000;
    } else if (candidate.normalizedText.includes(normalizedTitle)) {
      score += 750;
    } else if (normalizedTitle.includes(candidate.normalizedText)) {
      score += 500;
    }
  }
  if (normalizedCode) {
    if (candidate.normalizedText.includes(normalizedCode)) {
      score += 300;
    }
  }
  if (!score && normalizedTitle) {
    const titleParts = normalizedTitle.split(' ');
    const matches = titleParts.filter((part) => part.length > 2 && candidate.normalizedText.includes(part)).length;
    if (matches) {
      score += matches * 25;
    }
  }
  return score;
}

function pickBestCandidate(candidates, { normalizedTitle, normalizedCode }) {
  if (!candidates.length) {
    return null;
  }
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, { normalizedTitle, normalizedCode });
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best || candidates[0];
}

function buildSearchKeywords({ code, title }) {
  const parts = [];
  if (code) {
    parts.push(code);
  }
  if (title && (!code || normalizeForComparison(code) !== normalizeForComparison(title))) {
    parts.push(title);
  }
  return parts.join(' ').trim();
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return respondJson({ error: 'Use GET' }, { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const title = normalizeLookupValue(params.get('title'));
    const code = normalizeLookupValue(params.get('code'));
    const keywords = buildSearchKeywords({ code, title });

    if (!keywords) {
      return respondJson({ error: 'Missing search keywords.' }, { status: 400 });
    }

    const searchParams = new URLSearchParams();
    searchParams.set('search_keyword', keywords);
    const searchUrl = `${BASE_HOST}${SEARCH_PATH}?${searchParams.toString()}`;

    const fetchResponse = await fetch(searchUrl, {
      headers: {
        'user-agent': 'AL-logs/1.0 (+https://github.com/adam-r-kowalski/AL-logs)',
        accept: 'text/html,application/xhtml+xml'
      }
    });

    if (!fetchResponse.ok) {
      return respondJson(
        {
          error: 'Search request failed.',
          status: fetchResponse.status,
          searchUrl
        },
        { status: fetchResponse.status }
      );
    }

    const html = await fetchResponse.text();
    const candidates = extractProductCandidates(html);
    const normalizedTitle = normalizeForComparison(title);
    const normalizedCode = normalizeForComparison(code);
    const best = pickBestCandidate(candidates, { normalizedTitle, normalizedCode });

    return respondJson({
      url: best ? best.url : null,
      matchedTitle: best ? best.text : null,
      searchUrl,
      candidateCount: candidates.length
    });
  } catch (err) {
    return respondJson({ error: err?.message || 'Unexpected error.' }, { status: 500 });
  }
}
