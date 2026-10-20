# Decisions

Project memory: what was decided, and why. Append new entries at the end with a date. When an entry is reversed, add a new entry that names the old one rather than editing it.

## 2026-10-20: Build on the official API, not a fork

GitHub search found no mature self-hosted Document AI server; the community repos are small and lightly maintained. We build our own on the REST API and credit the repos we learned from in the README.

## 2026-10-20: Cloudflare Workers + TypeScript

User choice (has a paid Workers plan). Hono for routing, D1 for counters and jobs, R2 for results, Cron for cleanup. The official `@google-cloud/documentai` SDK needs gRPC, so we call REST with `fetch` and sign the service-account JWT with `jose`.

## 2026-10-20: Our own page cap is the cost guarantee

Google budgets only alert; they don't stop charges. Pages are reserved in D1 before calling Google (atomic conditional update), refunded when Google rejects the request, kept on network errors. Default `MONTHLY_PAGE_LIMIT=900` leaves margin under the reported 1,000-page free tier.

## 2026-10-20: Premium add-ons off by default

Math OCR, selection marks and font style are billed outside the free tier, so requests can't enable them unless `ALLOW_PREMIUM_FEATURES=true`.

## 2026-10-20: Auth is token and/or Cloudflare Access

User asked for both. Bearer tokens (`API_TOKENS`, comma-separated, constant-time compare) serve API clients; Access JWT verification (`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`) serves the browser.

## 2026-10-20: Output is Markdown and plain text only

User doesn't need searchable PDF for now (Arabic text layers need font shaping, hard on Workers). Both formats are rendered and stored on every request so either can be downloaded later.

## 2026-10-20: Results kept for a set period, originals never stored

User wants results kept for a week or a chosen period, then removed. Default 7 days, per-request `retention_days` up to `MAX_RETENTION_DAYS`. Uploads aren't stored at all, which keeps storage small and limits what can leak.

## 2026-10-20: No PDF splitting in the core

User decision: ship the core first; splitting is a later feature (`docs/roadmap.md`). So each request must fit Google's online limit (30 pages in imageless mode, 15 otherwise), processing is synchronous, and there is no Queue.

## 2026-10-20: Imageless mode on by default

We never use returned page images, and imageless mode doubles the online page limit to 30 and shrinks responses.

## 2026-10-20: Enterprise Document OCR, not Layout Parser

OCR is the processor with the reported free tier and is built for raw text extraction. Its Markdown is paragraph-level only (no headings or tables). Layout Parser would give structure but is billed separately and its Arabic support is undocumented; it's on the roadmap as an option.

## 2026-10-20: Native PDF parsing off by default

Assumption, not yet tested on real files: embedded text in Arabic PDFs is often stored in presentation forms or reversed order, so OCR of the rendered page is the safer default. Users can turn it on per request.
