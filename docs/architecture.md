# Architecture

```
client (web page or API)
   │  multipart POST /api/ocr
   ▼
Cloudflare Worker (Hono)
   ├─ auth: Bearer token or Cloudflare Access JWT
   ├─ validate: size, file type (magic bytes), page count (pdf-lib), options
   ├─ D1: reserve pages in usage counters  ──► 429 if a cap would be exceeded
   ├─ Google: OAuth token (service-account JWT) → documentai :process (REST)
   ├─ render Document → .md and .txt
   ├─ R2: store both results, D1: job row
   └─ respond with content + download URLs + usage
Cron (hourly, :17) → delete expired jobs from R2 + D1, prune old daily counters
```

## Modules (`src/`)

| File | Responsibility |
|---|---|
| `index.ts` | Routes, request flow, file-type detection, page counting, scheduled handler |
| `auth.ts` | `requireAuth` middleware: constant-time token check, Access JWT verification (JWKS cached per isolate) |
| `config.ts` | `Env` bindings and `loadConfig` (string vars → typed config, clamps to Google limits) |
| `options.ts` | Per-request OCR and render options, page-range parsing, premium gating |
| `google.ts` | Service-account token (cached per isolate), request body builder, `processDocument`, Document types |
| `render.ts` | Document → Markdown / text, per-page metadata |
| `quota.ts` | Atomic page reservation, refund, usage report |
| `cleanup.ts` | Retention sweep |
| `ui.ts` | The single HTML page (vanilla JS, same `/api` as API clients) |
| `errors.ts` | `HttpError(status, message)`; `app.onError` turns it into JSON |

## Data

**D1** (`migrations/`):
- `usage(period, pages)`: `period` is `m:YYYY-MM` or `d:YYYY-MM-DD`, UTC. Usage is always recorded, even with limits off, so `/api/usage` stays accurate.
- `jobs`: one row per OCR request: `status` (`processing` / `done` / `failed`), the options used (JSON), per-page `meta` (JSON), `created_at` / `expires_at` in unix ms.

**R2**: `results/<job-id>.md` and `results/<job-id>.txt`. The original upload is never stored.

## Quota flow

1. Count pages: the selected range if `pages` is given, else every page (images count as 1).
2. `reservePages`: conditional `UPDATE … WHERE pages + n <= limit` on the month counter, then the day counter; if the day fails the month is rolled back. `meta.changes === 1` means the reservation succeeded, so concurrent requests can't overshoot.
3. On `HttpError` from the Google call (auth failure or Google rejecting the request): `refundPages`. On any other error (network, timeout): keep the count.

## Retention

`expires_at` is set per job from `retention_days` (default `RETENTION_DAYS`, max `MAX_RETENTION_DAYS`). Reads filter on `expires_at > now`, so an expired job is gone the moment it expires, even before the cron deletes it. The optional R2 lifecycle rule in the README is a backstop only.

## Rendering

- Text comes from `Document.text` sliced by each element's `textAnchor.textSegments` (indexes are int64 **strings**, `startIndex` may be missing = 0).
- Markdown: paragraphs per page, OCR line breaks joined with spaces (`join_lines`) or kept as hard breaks; lines starting with Markdown syntax (`#`, `>`, fences, rules) are escaped; page markers are HTML comments so they don't render.
- Text: paragraphs with original line breaks; `===== Page N =====` markers.
- With a page selection, markers use the selected (original) page numbers.
