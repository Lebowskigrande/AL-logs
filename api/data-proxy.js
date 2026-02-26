import { promises as fs } from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type,x-save-key'
};

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_DATA_PATH = 'data/data.js';
const DEFAULT_SUPABASE_TABLE = 'al_data_snapshots';

const isLikelyGitObjectId = (value) => /^[0-9a-f]{40}$/i.test(String(value || '').trim());

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

const getSupabaseConfig = () => {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const table = String(process.env.SUPABASE_DATA_TABLE || DEFAULT_SUPABASE_TABLE).trim();
  if (!(url && serviceRoleKey && table)) {
    return null;
  }
  return { url, serviceRoleKey, table };
};

const buildSupabaseTableUrl = (config, params = null) => {
  const base = `${config.url.replace(/\/+$/, '')}/rest/v1/${config.table}`;
  if (!params) {
    return base;
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

const readSupabaseDataFile = async ({ config, pathParam, ref, cacheBustToken }) => {
  const params = new URLSearchParams();
  params.set('select', 'path,data_js,version,updated_at');
  params.set('path', `eq.${pathParam}`);
  if (ref) {
    params.set('version', `eq.${ref}`);
  } else {
    params.set('order', 'updated_at.desc.nullslast');
  }
  params.set('limit', '1');
  if (cacheBustToken) {
    params.set('cb', cacheBustToken);
  }

  const supaUrl = buildSupabaseTableUrl(config, params);
  const supaRes = await fetch(supaUrl, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!supaRes.ok) {
    const text = await supaRes.text();
    return { error: { status: supaRes.status, message: text || 'Failed to read from Supabase.' } };
  }

  const rows = await supaRes.json();
  if (!Array.isArray(rows) || !rows.length) {
    return { error: { status: 404, message: `Could not locate ${pathParam}${ref ? ` at version "${ref}"` : ''}.` } };
  }

  const row = rows[0] || {};
  const dataJs = typeof row.data_js === 'string' ? row.data_js : '';
  if (!dataJs) {
    return { error: { status: 404, message: `No data_js payload found for ${pathParam}.` } };
  }

  return {
    value: {
      body: dataJs,
      version: row.version ? String(row.version) : '',
      source: 'supabase'
    }
  };
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


const readLocalDataFile = async (inputPath) => {
  const cwd = process.cwd();
  const targetPath = path.resolve(cwd, String(inputPath || DEFAULT_DATA_PATH));
  const relativeTarget = path.relative(cwd, targetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    return { error: { status: 400, message: 'Resolved data path escapes repository root.' } };
  }
  try {
    const body = await fs.readFile(targetPath, 'utf8');
    return { body };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { error: { status: 404, message: `Could not locate ${inputPath}.` } };
    }
    return { error: { status: 500, message: 'Failed to read local data file.', details: String(error && error.message ? error.message : error) } };
  }
};

const resolveCommitShaForRef = async ({ repo, ref, headers }) => {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) {
    return { error: { status: 400, message: 'Cannot resolve empty ref.' } };
  }

  if (isLikelyGitObjectId(normalizedRef)) {
    return { sha: normalizedRef, source: 'commit' };
  }

  const encodedBranch = encodeURIComponent(normalizedRef);
  const branchUrl = `https://api.github.com/repos/${repo}/git/refs/heads/${encodedBranch}`;
  const branchRes = await fetch(branchUrl, { headers });

  if (!branchRes.ok) {
    const text = await branchRes.text();
    if (branchRes.status === 404) {
      return {
        error: {
          status: 404,
          message: `Branch "${normalizedRef}" not found when resolving data ref.`,
          details: text || null
        }
      };
    }

    return {
      error: {
        status: branchRes.status,
        message: 'Failed to resolve branch head commit.',
        details: text || null
      }
    };
  }

  const branchMeta = await branchRes.json();
  const sha = branchMeta?.object?.sha || branchMeta?.object?.oid || null;

  if (!sha || !isLikelyGitObjectId(sha)) {
    return {
      error: {
        status: 500,
        message: `Branch "${normalizedRef}" did not return a valid commit SHA.`
      }
    };
  }

  return { sha, source: `branch:${normalizedRef}` };
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
    const token = process.env.GH_TOKEN;

    const url = new URL(req.url);
    const params = url.searchParams;
    const pathParam = params.get('path') || DEFAULT_DATA_PATH;
    const cacheBustToken = (params.get('cb') || params.get('cacheBust') || '').trim();
    const requestedRef = (params.get('ref') || params.get('v') || '').trim();
    const encodedPath = encodeGitHubPath(pathParam);

    if (!encodedPath) {
      return respond({ error: 'Invalid or empty data path provided.' }, { status: 400 });
    }

    const supabaseConfig = getSupabaseConfig();
    if (supabaseConfig) {
      const supabaseResult = await readSupabaseDataFile({
        config: supabaseConfig,
        pathParam,
        ref: requestedRef,
        cacheBustToken
      });
      if (supabaseResult.error) {
        return respond({ error: supabaseResult.error.message }, { status: supabaseResult.error.status || 500 });
      }
      return respond(supabaseResult.value.body, {
        json: false,
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store, max-age=0',
          'x-data-path': pathParam,
          'x-data-ref': supabaseResult.value.version,
          'x-data-ref-source': supabaseResult.value.source
        }
      });
    }

    if (!repo || !token) {
      const localResult = await readLocalDataFile(pathParam);
      if (localResult.error) {
        return respond({ error: localResult.error.message, details: localResult.error.details || null }, {
          status: localResult.error.status || 500
        });
      }
      return respond(localResult.body, {
        json: false,
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': cacheBustToken ? 'no-store, max-age=0' : 'public, max-age=5',
          'x-data-path': pathParam,
          'x-data-ref': 'local-file',
          'x-data-ref-source': 'filesystem'
        }
      });
    }

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.raw'
    };

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

    let resolvedCommitSha = null;
    let resolvedCommitSource = refSource || null;

    if (refToUse) {
      const commitResult = await resolveCommitShaForRef({ repo, ref: refToUse, headers: authHeaders });
      if (commitResult?.error) {
        return respond({ error: commitResult.error.message, details: commitResult.error.details || null }, {
          status: commitResult.error.status || 500
        });
      }
      resolvedCommitSha = commitResult.sha;
      resolvedCommitSource = commitResult.source || resolvedCommitSource;
    }

    const ghParams = [];
    if (resolvedCommitSha) {
      ghParams.push(`ref=${encodeURIComponent(resolvedCommitSha)}`);
    }
    if (cacheBustToken) {
      ghParams.push(`cb=${encodeURIComponent(cacheBustToken)}`);
    }
    const query = ghParams.length ? `?${ghParams.join('&')}` : '';
    const ghUrl = `https://api.github.com/repos/${repo}/contents/${encodedPath}${query}`;

    const ghRes = await fetch(ghUrl, { headers: authHeaders, cache: 'no-store' });

    if (!ghRes.ok) {
      const text = await ghRes.text();
      if (ghRes.status === 404) {
        const refLabel = resolvedCommitSha || refToUse || '';
        return respond({
          error: `Could not locate ${pathParam} at ref "${refLabel}".`,
          hint: refSource === 'query'
            ? 'Verify that the requested ref exists.'
            : 'Confirm that your configured branch contains the latest commit.'
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
        'x-data-ref': resolvedCommitSha || refToUse || '',
        'x-data-ref-source': resolvedCommitSource || ''
      }
    });
  } catch (error) {
    return respond({ error: error && error.message ? error.message : 'Unexpected error while loading data.' }, {
      status: 500
    });
  }
}
