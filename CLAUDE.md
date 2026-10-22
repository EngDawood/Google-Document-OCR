# CLAUDE.md

Personal OCR server: Cloudflare Worker (TypeScript, Hono) calling Google Document AI Enterprise Document OCR, returning Markdown / plain text. User-facing setup, settings and API live in `README.md`.

## Read before changing

- **Architecture**, module map, D1/R2 layout, quota and retention flow: `docs/architecture.md`
- **Document AI API facts** (request fields, page/size limits, processor versions, what is still unverified): `docs/google-document-ai.md`. Read before touching `src/google.ts` or adding an OCR option.
- **Decisions** and their reasons: `docs/decisions.md`. Read before reversing a design choice.
- **Roadmap** (PDF splitting, Layout Parser, searchable PDF): `docs/roadmap.md`
- **Testing**, including the local end-to-end recipe and the Google stub: `docs/testing.md`

## Memory

`docs/decisions.md` is the project memory. When the user makes a decision, or you learn a gotcha the code and config don't reveal, append a dated entry there (newest last) in the same session. Update the matching doc when a fact in it goes stale.

## Rules

- **The page cap is the safety guarantee.** Every path that sends pages to Google reserves them first with `reservePages` (`src/quota.ts`) and refunds only on `HttpError` (Google said no). Network errors stay counted, since Google may have billed them.
- **Premium OCR add-ons stay opt-in** behind `ALLOW_PREMIUM_FEATURES`; they are billed outside the free tier.
- **Call Google over REST with `fetch`.** The official Node SDK uses gRPC, which Workers can't run.
- **Settings** go in `wrangler.jsonc` `vars` (parsed in `src/config.ts`) and get a row in the README settings table; per-request options get parsed in `src/options.ts` and a row in the README API table.
- **Writing**: plain, short sentences. Use commas, colons or parentheses in place of em dashes in every doc and UI string.

## Gotchas

- `npm install` crashes (`Cannot read properties of null (reading 'edgesOut')`) without `legacy-peer-deps`; `.npmrc` sets it. Keep that file.
- `.dev.vars`: put the service account JSON on one line inside **single** quotes; double quotes expand `\n` and break the JSON. `wrangler dev` reads `.dev.vars` only at start, so restart it after edits.
- In the cloud sandbox, `pkill -f "wrangler dev"` also kills the calling shell (exit 144). Stop dev servers by PID or as background tasks.
