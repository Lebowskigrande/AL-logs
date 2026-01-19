// Vercel Edge Function – commits data.js to your repo via GitHub API
export const config = { runtime: 'edge' };

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-save-key',
  'access-control-allow-methods': 'POST,OPTIONS'
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
    const { dataJs, branch = process.env.GH_BRANCH || 'work', path = 'data.js' } = await req.json();
    if (!dataJs || typeof dataJs !== 'string') {
      return respond({ error: 'dataJs (string) required' }, { status: 400 });
    }

    const repo = process.env.GH_REPO;   // e.g. "Lebowskigrande/AL-logs"
    if (!repo)  return respond({ error: 'GH_REPO not set' },  { status: 500 });
    const token = process.env.GH_TOKEN; // fine-grained PAT or GitHub App token
    if (!token) return respond({ error: 'GH_TOKEN not set' }, { status: 500 });

    // Optional: simple shared secret for client -> function
    const clientKey = req.headers.get('x-save-key');
    if (process.env.SAVE_KEY && clientKey !== process.env.SAVE_KEY) {
      return respond({ error: 'Unauthorized' }, { status: 401 });
    }

    const base = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

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
