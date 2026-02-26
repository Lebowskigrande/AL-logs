# Supabase Setup (Free Tier)

This project now supports a Supabase-backed runtime data store via:

- `api/save-data.js` (write)
- `api/data-proxy.js` (read)

When Supabase env vars are present, APIs use Supabase first. Otherwise they
fall back to existing GitHub/local-file behavior.

## 1) Create Supabase Project

1. Create a new Supabase project (free tier).
2. Open SQL editor and run:

```sql
create table if not exists public.al_data_snapshots (
  path text primary key,
  data_js text not null,
  version text not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  commit_sha text
);

create index if not exists al_data_snapshots_updated_at_idx
  on public.al_data_snapshots (updated_at desc);
```

Optional seed row:

```sql
insert into public.al_data_snapshots (path, data_js, version, updated_by)
values ('data/data.js', 'window.DATA = {"characters":{}};', gen_random_uuid()::text, 'setup')
on conflict (path) do nothing;
```

## 2) API Security

Use the **service role key only in server env vars** (never in client JS).

Because reads/writes go through your serverless API handlers, you can keep RLS
off for this table or configure restrictive RLS policies. Recommended simple
approach for this app:

- Keep table in `public`.
- Do not expose direct client writes to this table.
- Use only server-side service role key in deployment env.

## 3) Vercel Environment Variables

Set these in your Vercel project:

- `SUPABASE_URL` = your project URL (e.g. `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase service role key
- `SUPABASE_DATA_TABLE` = `al_data_snapshots` (or your table name)

Optional:

- `SAVE_KEY` = shared secret header for save API
- `APP_INSTANCE` = label written to `updated_by`

## 4) Deploy and Verify

1. Deploy to Vercel.
2. Open app and load data.
3. Make a small edit and save.
4. Confirm row updated in Supabase table:
   - `path = data/data.js`
   - `version` changes each save
   - `updated_at` updates
5. Verify `GET /api/data-proxy?path=data/data.js` returns JS payload with:
   - `x-data-ref-source: supabase`

## 5) Rollback/Fallback

If Supabase vars are removed, API behavior automatically falls back to previous
GitHub/local-file logic.
