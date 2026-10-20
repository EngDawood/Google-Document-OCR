# Testing

## Unit tests

`test/*.test.ts` (Vitest, runs in Node) cover the pure modules: rendering, option parsing, page ranges, config clamping, the Google request body. Code that needs Workers runtime APIs (`crypto.subtle.timingSafeEqual`, D1, R2) isn't covered here; use the local end-to-end check below.

## Local end-to-end check

1. Write `.dev.vars` with `API_TOKENS="testtoken"`, a low `MONTHLY_PAGE_LIMIT` (e.g. `"5"`) to hit the cap quickly, and a service account. Without real credentials, generate a throwaway RSA key (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`) and wrap it in a fake service-account JSON: the Google token call then fails with `invalid_grant`, which exercises the refund path.
2. `npm run db:migrate:local`, then `npx wrangler dev`.
3. Make test PDFs with `pdf-lib` (`PDFDocument.create()` + `addPage()`), e.g. 3 and 40 pages.
4. Check with `curl -H "authorization: Bearer testtoken"`:
   - no / wrong token → 401
   - 40-page file → 413; same file with `pages=1-2` → accepted
   - text file → 415; `math_ocr=true` → 403
   - over the monthly cap → 429
   - Google failure → 502 and `/api/usage` unchanged (refund)
   - cron: `curl localhost:8787/cdn-cgi/handler/scheduled`, then look for `cleanup:` in the log

## Success path without Google

Copy the project to a scratch folder, symlink `node_modules`, and make `processDocument` in the copy return a fixed `Document` before `getAccessToken`. Run `wrangler dev` there to test R2 storage, `/api/jobs/:id/md|txt`, `?download`, delete, and expiry (set `expires_at = 1` with `wrangler d1 execute ocr-db --local`, then trigger the cron). Keep the stub out of the real `src/`.

## Browser check

Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` in the cloud sandbox; drive it with `playwright-core` (`executablePath`) installed in a scratch folder. The Playwright MCP looks for Google Chrome and fails there.
