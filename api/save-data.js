import { promises as fs } from 'node:fs';
import pathModule from 'node:path';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-save-key',
  'access-control-allow-methods': 'POST,OPTIONS'
};

const DEFAULT_DATA_PATH = 'data/data.js';
const DEFAULT_SUPABASE_TABLE = 'al_data_snapshots';

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

const getSupabaseConfig = () => {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const table = String(process.env.SUPABASE_DATA_TABLE || DEFAULT_SUPABASE_TABLE).trim();
  if (!(url && serviceRoleKey && table)) {
    return null;
  }
  return { url, serviceRoleKey, table };
};

const buildSupabaseTableUrl = (config, extraParams = null) => {
  const base = `${config.url.replace(/\/+$/, '')}/rest/v1/${config.table}`;
  if (!extraParams) {
    return base;
  }
  const query = extraParams.toString();
  return query ? `${base}?${query}` : base;
};

const createVersion = () => {
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const saveToSupabase = async ({ config, path, dataJs, req }) => {
  const savedAt = new Date().toISOString();
  const version = createVersion();
  const updatedByHeader = req.headers.get('x-updated-by');
  const updatedByEnv = String(process.env.APP_INSTANCE || '').trim();
  const updatedBy = String(updatedByHeader || updatedByEnv || 'dashboard').slice(0, 120);

  const query = new URLSearchParams();
  query.set('on_conflict', 'path');
  const endpoint = buildSupabaseTableUrl(config, query);

  const payload = {
    path: String(path || DEFAULT_DATA_PATH),
    data_js: dataJs,
    updated_at: savedAt,
    updated_by: updatedBy,
    version,
    commit_sha: null
  };

  const supaRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!supaRes.ok) {
    const text = await supaRes.text();
    return { error: { status: supaRes.status, message: text || 'Supabase save failed.' } };
  }

  return {
    value: {
      ok: true,
      mode: 'supabase',
      version,
      path: String(path || DEFAULT_DATA_PATH),
      savedAt
    }
  };
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return respond(null, { json: false });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Use POST' }, { status: 405 });
  }

  try {
    const { dataJs, branch = process.env.GH_BRANCH || 'work', path = DEFAULT_DATA_PATH } = await req.json();
    if (!dataJs || typeof dataJs !== 'string') {
      return respond({ error: 'dataJs (string) required' }, { status: 400 });
    }

    const encodedPath = encodeGitHubPath(path);
    if (!encodedPath) {
      return respond({ error: 'path must be a non-empty file path' }, { status: 400 });
    }

    // Optional: simple shared secret for client -> function
    const clientKey = req.headers.get('x-save-key');
    if (process.env.SAVE_KEY && clientKey !== process.env.SAVE_KEY) {
      return respond({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseConfig = getSupabaseConfig();
    if (supabaseConfig) {
      const supabaseWrite = await saveToSupabase({
        config: supabaseConfig,
        path: String(path || DEFAULT_DATA_PATH),
        dataJs,
        req
      });
      if (supabaseWrite.error) {
        return respond({ error: supabaseWrite.error.message }, { status: supabaseWrite.error.status || 500 });
      }
      return respond(supabaseWrite.value);
    }

    const repo = process.env.GH_REPO;   // e.g. "Lebowskigrande/AL-logs"
    const token = process.env.GH_TOKEN; // fine-grained PAT or GitHub App token

    if (!repo || !token) {
      const cwd = process.cwd();
      const targetPath = pathModule.resolve(cwd, String(path || DEFAULT_DATA_PATH));
      const normalizedRoot = `${pathModuleResolveWithSlash(cwd)}`;
      const normalizedTarget = pathModuleResolveWithSlash(targetPath);
      if (!normalizedTarget.startsWith(normalizedRoot)) {
        return respond({ error: 'Resolved save path escapes repository root.' }, { status: 400 });
      }
      await fs.mkdir(pathModule.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, dataJs, 'utf8');
      return respond({
        ok: true,
        mode: 'local-file',
        path: String(path || DEFAULT_DATA_PATH),
        savedAt: new Date().toISOString()
      });
    }

    const base = `https://api.github.com/repos/${repo}/contents/${encodedPath}`;

    // 1) Get current SHA (required to update an existing file)
    let sha = undefined;
    const curRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    });
    if (curRes.ok) {
      const cur = await curRes.json();
      sha = cur?.sha;
    }

    // 2) Create commit
    const message = `feat: update ${path} from dashboard`;
    const content = btoa(unescape(encodeURIComponent(dataJs))); // UTF-8 -> base64

    const putRes = await fetch(base, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) })
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      return respond({ error: text }, { status: putRes.status });
    }

    const out = await putRes.json();

    // CORS for your site(s)
    return respond({ ok: true, commit: out.commit?.sha });
  } catch (e) {
    return respond({ error: String(e) }, { status: 500 });
  }
}

function pathModuleResolveWithSlash(value) {
  const resolved = pathModule.resolve(String(value || ''));
  return resolved.endsWith(pathModule.sep) ? resolved : `${resolved}${pathModule.sep}`;
}
