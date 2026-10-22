# Google Document OCR

A personal OCR server on **Cloudflare Workers** (TypeScript) that uses **Google Document AI (Enterprise Document OCR)** to turn PDFs and images into **Markdown** or **plain text**. It works well for Arabic, and Google detects the language automatically.

- Web upload page and a simple REST API
- Auth with an API token, Cloudflare Access, or both
- **Usage guard**: monthly and daily page caps checked *before* anything is sent to Google, so you stay inside the free tier
- Results saved in R2 for a set number of days (default 7, can be set per request), then removed automatically
- Every OCR option exposed: language hints, page selection, embedded PDF text, quality scores, processor version, premium add-ons (off by default)

```
Browser / API client ──► Cloudflare Worker ──► Google Document AI (OCR)
                            │  D1: page usage + job list
                            │  R2: .md / .txt results (auto-expire)
                            └─ Cron: hourly cleanup
```

---

## 1. Google Cloud setup (one time)

You only need a Google Cloud project with billing enabled.

1. **Enable the API**: open [Document AI API](https://console.cloud.google.com/apis/library/documentai.googleapis.com) and click **Enable**.
2. **Create the OCR processor**: go to [Document AI > Processor gallery](https://console.cloud.google.com/ai/document-ai/processor-library), pick **Document OCR** (Enterprise Document OCR), name it, and choose region `us` or `eu`. On the processor page copy the **Processor ID**. Your **Project ID** is shown on the console home page.
3. **Create a service account** (the key the server uses):
   - [IAM > Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) > **Create service account**
   - Role: **Document AI API User**
   - Open the account > **Keys** > **Add key** > **JSON**. A `.json` file downloads. Keep it private and never commit it.
4. **Safety net (recommended)**: [Billing > Budgets & alerts](https://console.cloud.google.com/billing/budgets): create a budget of, say, $1 with email alerts. A budget only *alerts* and does not stop charges, which is why this server enforces its own page cap.

> **Pricing**: check the current numbers on the [Document AI pricing page](https://cloud.google.com/products/document-ai/pricing). When this was written, it was reported to include a monthly free allowance for Enterprise Document OCR (1,000 pages); confirm it applies to your account. Add-ons are billed extra (math, checkboxes, font style). The default cap here is **900 pages/month** to leave a margin.

## 2. Cloudflare setup

Requires Node 20+ and a Cloudflare account (Workers Paid recommended for large PDFs).

```bash
npm install
npx wrangler login

npx wrangler d1 create ocr-db              # copy the database_id into wrangler.jsonc
npx wrangler r2 bucket create ocr-results
npm run db:migrate                          # creates the tables

# Optional safety net: R2 deletes anything older than 30 days even if the cron never ran
npx wrangler r2 bucket lifecycle add ocr-results expire-results results/ --expire-days 30
```

Edit `wrangler.jsonc` → `vars`: set `GCP_PROJECT_ID`, `GCP_LOCATION`, `DOCAI_PROCESSOR_ID`, and the limits you want.

Add the secrets:

```bash
npx wrangler secret put GCP_SERVICE_ACCOUNT_JSON < path/to/service-account.json
npx wrangler secret put API_TOKENS          # e.g. a long random string; comma-separate several tokens
```

Generate a token with `openssl rand -hex 32`.

Deploy:

```bash
npm run deploy
```

Open the Worker URL, paste your token, and upload a file.

### Optional: Cloudflare Access

To protect the web page with a login (Google, GitHub, email code, ...):

1. In **Zero Trust > Access > Applications**, add a *Self-hosted* application for your Worker's hostname.
2. Copy the **Application Audience (AUD) tag**.
3. Set `ACCESS_TEAM_DOMAIN` (e.g. `yourteam.cloudflareaccess.com`) and `ACCESS_AUD` in `wrangler.jsonc`, then deploy.

The browser then needs no token. API clients can still use `Authorization: Bearer <token>`, as long as Access lets them through. Either add a *Bypass* or *Service Auth* policy for `/api/*`, or call the API through Access with a service token.

## 3. Settings (`wrangler.jsonc` → `vars`)

| Variable | Default | Meaning |
|---|---|---|
| `GCP_PROJECT_ID` | (none) | Google Cloud project ID |
| `GCP_LOCATION` | `us` | Processor region (`us` or `eu`) |
| `DOCAI_PROCESSOR_ID` | (none) | Document OCR processor ID |
| `DOCAI_PROCESSOR_VERSION` | *(processor default)* | e.g. `pretrained-ocr-v2.1-2024-08-07` |
| `MONTHLY_PAGE_LIMIT` | `900` | Hard cap per calendar month (UTC). `0` = no limit |
| `DAILY_PAGE_LIMIT` | `0` | Hard cap per day (UTC). `0` = no limit |
| `MAX_PAGES_PER_FILE` | `30` | Pages per request. Capped at Google's online limit: 30 in imageless mode, else 15 |
| `MAX_FILE_MB` | `20` | Upload size limit (Google allows up to 40) |
| `IMAGELESS_MODE` | `true` | Ask Google not to return page images (smaller, faster, allows 30 pages) |
| `DEFAULT_LANGUAGE_HINTS` | *(empty = auto)* | e.g. `ar,en`. Google recommends auto-detect in most cases |
| `DEFAULT_NATIVE_PDF_PARSING` | `false` | Use the text already embedded in digital PDFs instead of OCR |
| `ALLOW_PREMIUM_FEATURES` | `false` | Allow math / checkbox / font-style add-ons (**billed extra**) |
| `RETENTION_DAYS` | `7` | How long results are kept |
| `MAX_RETENTION_DAYS` | `30` | Upper bound for per-request `retention_days` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | *(empty)* | Enable Cloudflare Access login |

Secrets: `GCP_SERVICE_ACCOUNT_JSON`, `API_TOKENS`.

**How the page cap works:** the server counts the pages (or the selected range) and reserves them in D1 *before* calling Google. If the reservation would exceed a cap, the request is refused with `429`. If Google rejects the request, the pages are given back. If the connection drops mid-request, they stay counted, because Google may have processed and billed them.

## 4. API

All `/api/*` endpoints need `Authorization: Bearer <token>` (or Cloudflare Access).

### `POST /api/ocr` (multipart/form-data)

| Field | Example | Notes |
|---|---|---|
| `file` | *(PDF/PNG/JPEG/WEBP/BMP)* | required |
| `format` | `md` \| `txt` \| `none` | which result to include inline (default `md`). Both are always saved |
| `pages` | `1-5,8` | only OCR these pages; only these count toward the cap |
| `language_hints` | `ar,en` | BCP-47 codes |
| `native_pdf_parsing` | `true` | |
| `image_quality_scores` | `true` | adds per-page quality score and defects to `meta` |
| `processor_version` | `pretrained-ocr-v2.1-2024-08-07` | overrides the default |
| `math_ocr`, `selection_marks`, `style_info` | `true` | premium add-ons, need `ALLOW_PREMIUM_FEATURES=true` |
| `retention_days` | `14` | 1 to `MAX_RETENTION_DAYS` |
| `page_markers` | `false` | `<!-- page N -->` in md, `===== Page N =====` in txt (default on) |
| `join_lines` | `false` | md only: join wrapped lines inside a paragraph (default on) |

```bash
curl -H "Authorization: Bearer $TOKEN" \
  -F file=@book.pdf -F format=md -F pages=1-10 \
  https://<your-worker>/api/ocr
```

Response:

```json
{
  "id": "…",
  "filename": "book.pdf",
  "pages": 10,
  "expiresAt": "2026-10-27T12:00:00.000Z",
  "files": { "md": "https://…/api/jobs/<id>/md", "txt": "https://…/api/jobs/<id>/txt" },
  "meta": { "pages": [{ "page": 1, "chars": 1834, "languages": ["ar"] }] },
  "format": "md",
  "content": "<!-- page 1 -->\n\n…",
  "usage": { "month": { "period": "2026-10", "used": 120, "limit": 900 }, "day": { … } }
}
```

### Other endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/jobs/:id/md` or `/txt` | Result file. Add `?download` for an attachment |
| `GET /api/jobs` | Saved (non-expired) jobs, newest first |
| `GET /api/jobs/:id` | Job details and options used |
| `DELETE /api/jobs/:id` | Delete a result now |
| `GET /api/usage` | Pages used this month / today |
| `GET /api/config` | Active limits and defaults |

Errors are JSON `{ "error": "…" }` with status `400`, `401`, `403`, `404`, `413` (too big / too many pages), `415` (file type), `429` (page cap), or `502` (Google error).

## 5. Development

```bash
cp .dev.vars.example .dev.vars    # fill in your secrets
npm run db:migrate:local
npm run dev                       # http://localhost:8787
npm test                          # unit tests
npm run typecheck
```

## Docs

- [Architecture](docs/architecture.md): request flow, modules, data, quota and retention
- [Google Document AI reference](docs/google-document-ai.md): API fields, limits, versions
- [Decisions](docs/decisions.md): what was decided and why
- [Roadmap](docs/roadmap.md): PDF splitting, Layout Parser, searchable PDF
- [Testing](docs/testing.md): unit tests and local end-to-end checks

## Credits

Built with ideas and references from:

- [GoogleCloudPlatform/document-ai-samples](https://github.com/GoogleCloudPlatform/document-ai-samples): official Document AI samples
- [googleapis/google-cloud-python: documentai-toolbox](https://github.com/googleapis/google-cloud-python/tree/main/packages/google-cloud-documentai-toolbox): official helpers for Document AI output
- [thevinduttr/Google-Document-AI-OCR](https://github.com/thevinduttr/Google-Document-AI-OCR): choosing page ranges before OCR
- [AliAlWahayb/WebUi-Arabic-PDF-OCR-Text-Extraction](https://github.com/AliAlWahayb/WebUi-Arabic-PDF-OCR-Text-Extraction): Arabic PDF OCR web UI with Document AI
- [LikeCarter/google-document-ai-searchable-pdf](https://github.com/LikeCarter/google-document-ai-searchable-pdf): searchable PDFs from Document AI (for the roadmap)

Libraries: [Hono](https://hono.dev), [jose](https://github.com/panva/jose), [pdf-lib](https://pdf-lib.js.org).
