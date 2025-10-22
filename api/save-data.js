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

const extractDataPayload = (text) => {
  if (typeof text !== 'string') return null;
  const pattern = /window\.DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/;
  const match = text.match(pattern);
  return match && match[1] ? match[1] : null;
};

const parseDataObject = (text) => {
  const payload = extractDataPayload(text);
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (err) {
    return null;
  }
};

const formatDataObject = (obj) => `window.DATA = ${JSON.stringify(obj, null, 2)};`;

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

    const incomingData = parseDataObject(dataJs);
    if (!incomingData || typeof incomingData !== 'object') {
      return respond({ error: 'Unable to parse dataJs payload' }, { status: 400 });
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

    let currentRevision = 0;

    // 1) Get current SHA (required to update an existing file)
    let sha = undefined;
    const curRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
      headers: authHeaders
    });
    if (curRes.ok) {
      const cur = await curRes.json();
      sha = cur?.sha;
      const encodedContent = cur?.content;
      if (encodedContent) {
        try {
          const decoded = atob(encodedContent.replace(/\n/g, ''));
          const currentData = parseDataObject(decoded);
          if (currentData && currentData.meta && typeof currentData.meta === 'object') {
            const revValue = Number(currentData.meta.revision);
            if (Number.isFinite(revValue)) {
              currentRevision = Math.max(0, Math.floor(revValue));
            }
          }
        } catch (err) {
          /* ignore parse errors */
        }
      }
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

    const revisionHeader = req.headers.get('x-data-revision');
    let expectedRevision = null;
    if (revisionHeader != null) {
      const parsedHeader = Number(revisionHeader);
      if (Number.isFinite(parsedHeader)) {
        expectedRevision = Math.max(0, Math.floor(parsedHeader));
      } else {
        const fallbackHeader = Number.parseInt(revisionHeader, 10);
        if (Number.isFinite(fallbackHeader)) {
          expectedRevision = Math.max(0, fallbackHeader);
        }
      }
    }

    if (sha && expectedRevision == null) {
      return respond(
        {
          error: 'conflict',
          message: 'Missing revision token. Refresh and try again.',
          revision: currentRevision
        },
        { status: 409 }
      );
    }

    if (expectedRevision != null && expectedRevision !== currentRevision) {
      return respond(
        {
          error: 'conflict',
          message: 'Data.js has changed since your last load.',
          revision: currentRevision
        },
        { status: 409 }
      );
    }

    const nextRevision = currentRevision + 1;
    if (!incomingData.meta || typeof incomingData.meta !== 'object') {
      incomingData.meta = {};
    }
    incomingData.meta.revision = nextRevision;

    const preparedDataJs = formatDataObject(incomingData);

    // 2) Create commit
    const message = `feat: update ${path} from dashboard`;
    const encoded = new TextEncoder().encode(preparedDataJs);
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
    return respond({ ok: true, commit: out.commit?.sha, revision: nextRevision });
  } catch (e) {
    return respond({ error: String(e) }, { status: 500 });
  }
}
