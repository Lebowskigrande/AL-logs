import { promises as fs } from 'node:fs';
import pathModule from 'node:path';

export const config = { runtime: 'nodejs' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-save-key',
  'access-control-allow-methods': 'POST,OPTIONS'
};

const DEFAULT_DATA_PATH = 'data/data.js';

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

    // Optional: simple shared secret for client -> function
    const clientKey = req.headers.get('x-save-key');
    if (process.env.SAVE_KEY && clientKey !== process.env.SAVE_KEY) {
      return respond({ error: 'Unauthorized' }, { status: 401 });
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
