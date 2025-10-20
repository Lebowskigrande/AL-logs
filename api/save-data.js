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
    const { dataJs, path = 'data.js' } = await req.json();
    if (!dataJs || typeof dataJs !== 'string') {
      return respond({ error: 'dataJs (string) required' }, { status: 400 });
    }

    const repo = process.env.GH_REPO;   // e.g. "Lebowskigrande/AL-logs"
    if (!repo)  return respond({ error: 'GH_REPO not set' },  { status: 500 });
    const token = process.env.GH_TOKEN; // fine-grained PAT or GitHub App token
    if (!token) return respond({ error: 'GH_TOKEN not set' }, { status: 500 });

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    };

    const envBranch = process.env.GH_BRANCH?.trim();
    const deployBranch = process.env.VERCEL_GIT_COMMIT_REF?.trim();
    let branch = envBranch || deployBranch;
    let branchSource = envBranch ? 'GH_BRANCH' : (deployBranch ? 'VERCEL_GIT_COMMIT_REF' : null);

    if (!branch) {
      const repoMetaRes = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: authHeaders
      });

      if (!repoMetaRes.ok) {
        const text = await repoMetaRes.text();
        return respond(
          {
            error: 'Unable to determine default branch from repository metadata',
            details: text
          },
          { status: repoMetaRes.status }
        );
      }

      const repoMeta = await repoMetaRes.json();
      if (repoMeta?.default_branch) {
        branch = repoMeta.default_branch;
        branchSource = 'repository default_branch';
      }
    }

    if (!branch) {
      return respond(
        {
          error: 'Unable to determine which branch to commit to. Set GH_BRANCH in your Vercel environment.'
        },
        { status: 500 }
      );
    }

    // Optional: simple shared secret for client -> function
    const clientKey = req.headers.get('x-save-key');
    if (process.env.SAVE_KEY && clientKey !== process.env.SAVE_KEY) {
      return respond({ error: 'Unauthorized' }, { status: 401 });
    }

    const base = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

    // 1) Get current SHA (required to update an existing file)
    let sha = undefined;
    const curRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
      headers: authHeaders
    });
    if (curRes.ok) {
      const cur = await curRes.json();
      sha = cur?.sha;
    } else if (curRes.status === 404) {
      let curError = null;
      try {
        curError = await curRes.json();
      } catch (err) {
        // ignore JSON parse issues – we'll fall back to text below
      }

      const curMessage = curError?.message || '';
      if (/No commit found for the ref/i.test(curMessage) || /branch.*not found/i.test(curMessage)) {
        return respond(
          {
            error: `Branch "${branch}" was not found in ${repo}.`,
            hint:
              branchSource === 'GH_BRANCH'
                ? 'Double-check the GH_BRANCH environment variable.'
                : 'Set GH_BRANCH in Vercel to the branch you want to update.'
          },
          { status: 400 }
        );
      }
    }

    // 2) Create commit
    const message = `feat: update ${path} from dashboard`;
    const encoded = new TextEncoder().encode(dataJs);
    let binary = '';
    for (let i = 0; i < encoded.length; i += 1) {
      binary += String.fromCharCode(encoded[i]);
    }
    const content = btoa(binary); // UTF-8 -> base64

    const putRes = await fetch(base, {
      method: 'PUT',
      headers: authHeaders,
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
