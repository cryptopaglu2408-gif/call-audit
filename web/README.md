# Call Audit — Web

React + Vite + Tailwind frontend. Reads Supabase directly for the
dashboard / results pages, and POSTs to the FastAPI service in `../api`
to kick off the processing pipeline.

## Setup

```bash
cd web
npm install
cp .env.example .env       # then fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
```

`vite.config.ts` proxies `/api/*` to `http://localhost:8000` in dev, so
you don't need to set `VITE_API_BASE` unless deploying the frontend
separately.

## Build

```bash
npm run build              # outputs to web/dist
npm run preview            # serve the build locally
```

## Pages

- `/dashboard` — KPI cards, status donut, weekly score bar chart,
  duration trend, score-by-parameter pie, recent calls table.
- `/process` — upload a sheet, pick the link column + row range, stream
  pipeline progress over SSE.
- `/rubric` — edit / save / activate scoring rubrics.
- `/results` — call list + per-call transcript & scores; semantic
  search tab.

## Backend dependency

The frontend assumes the FastAPI service in `../api` is running
(see `../api/README` or the root `README.md`). Without it the dashboard
and rubric pages still work (they hit Supabase directly), but the
**Process** and **Semantic search** features will fail.
