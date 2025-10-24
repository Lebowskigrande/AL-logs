export const config = { runtime: 'edge' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type,x-save-key'
};

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_DATA_PATH = 'data/data.js';

const respond = (body, { status = 200, headers = {}, json = true } = {}) => {
  const responseHeaders = { ...corsHeaders, ...headers };
  if (json) {
    if (!('content-type' in responseHeaders)) {
      responseHeaders['content-type'] = JSON_CONTENT_TYPE;
    }
    return new Response(JSON.stringify(body), { status, headers: responseHeaders });
  }
  return new Response(body, { status, headers: responseHeaders });
};

const encodeGitHubPath = (inputPath) => {
  const normalized = String(inputPath || '')
    .replace(/^\/+/, '')
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

const determineBranch = async ({ repo, headers }) => {
  const envBranch = process.env.GH_BRANCH?.trim();
  if (envBranch) {
    return { branch: envBranch, source: 'GH_BRANCH' };
  }

  const deployBranch = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  if (deployBranch) {
    return { branch: deployBranch, source: 'VERCEL_GIT_COMMIT_REF' };
  }

  const repoMetaRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoMetaRes.ok) {
    const text = await repoMetaRes.text();
    return {
      error: {
        status: repoMetaRes.status,
        message: 'Unable to determine default branch from repository metadata.',
        details: text
      }
    };
  }

  const repoMeta = await repoMetaRes.json();
  if (repoMeta?.default_branch) {
    return { branch: repoMeta.default_branch, source: 'repository default_branch' };
  }

  return {
    error: {
      status: 500,
      message: 'Unable to determine repository default branch. Set GH_BRANCH in your environment.'
    }
  };
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return respond(null, { json: false });
  }

  if (req.method !== 'GET') {
    return respond({ error: 'Use GET' }, { status: 405 });
  }

  try {
    const repo = process.env.GH_REPO;
    if (!repo) {
      return respond({ error: 'GH_REPO not set' }, { status: 500 });
    }

    const token = process.env.GH_TOKEN;
    if (!token) {
      return respond({ error: 'GH_TOKEN not set' }, { status: 500 });
    }

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.raw'
    };

    const url = new URL(req.url);
    const params = url.searchParams;
    const pathParam = params.get('path') || DEFAULT_DATA_PATH;
    const encodedPath = encodeGitHubPath(pathParam);

    if (!encodedPath) {
      return respond({ error: 'Invalid or empty data path provided.' }, { status: 400 });
    }

    const requestedRef = (params.get('ref') || params.get('v') || '').trim();
    let refToUse = requestedRef;
    let refSource = requestedRef ? 'query' : null;

    if (!refToUse) {
      const branchResult = await determineBranch({ repo, headers: authHeaders });
      if (branchResult?.error) {
        return respond({ error: branchResult.error.message, details: branchResult.error.details || null }, {
          status: branchResult.error.status || 500
        });
      }
      refToUse = branchResult.branch;
      refSource = branchResult.source || 'default';
    }

    const refQuery = refToUse ? `?ref=${encodeURIComponent(refToUse)}` : '';
    const ghUrl = `https://api.github.com/repos/${repo}/contents/${encodedPath}${refQuery}`;

    const ghRes = await fetch(ghUrl, { headers: authHeaders });

    if (!ghRes.ok) {
      const text = await ghRes.text();
      if (ghRes.status === 404) {
        return respond({
          error: `Could not locate ${pathParam} at ref "${refToUse}".`,
          hint: refSource === 'query'
            ? 'Verify that the requested ref exists.'
            : 'Confirm that GH_BRANCH matches an existing branch.'
        }, { status: 404 });
      }
      return respond({ error: text || 'Failed to fetch data from GitHub.' }, { status: ghRes.status });
    }

    const body = await ghRes.text();

    return respond(body, {
      json: false,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'x-data-path': pathParam,
        'x-data-ref': refToUse || ''
      }
    });
  } catch (error) {
    return respond({ error: error && error.message ? error.message : 'Unexpected error while loading data.' }, {
      status: 500
    });
  }
}
