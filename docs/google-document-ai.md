# Google Document AI reference

Facts this project depends on, read from the official docs on 2026-10-20 (`docs.cloud.google.com/document-ai/...`). Re-check the source page before relying on anything marked **unverified**.

## Endpoint

```
POST https://{location}-documentai.googleapis.com/v1/projects/{project}/locations/{location}/processors/{processor}[/processorVersions/{version}]:process
Authorization: Bearer <OAuth access token, scope https://www.googleapis.com/auth/cloud-platform>
```

Access token: sign an RS256 JWT with the service account key (`iss` = `client_email`, `aud` = `token_uri`, `scope` claim) and exchange it at `https://oauth2.googleapis.com/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. Service account role: **Document AI API User**.

## Request body (JSON, camelCase)

- Source, exactly one of: `rawDocument { content (base64), mimeType }`, `inlineDocument`, `gcsDocument`. We use `rawDocument`.
- `imagelessMode` (bool): drop page images from the response; raises the online page limit (see limits).
- `processOptions`:
  - Page selection, one of: `individualPageSelector { pages: [int, 1-indexed] }`, `fromStart`, `fromEnd`.
  - `ocrConfig` (OCR and Form Parser processors only):
    - `hints { languageHints: [BCP-47] }`. Google says auto-detect (no hints) is usually best.
    - `enableNativePdfParsing`, `enableImageQualityScores`, `enableSymbol`, `disableCharacterBoxesDetection`
    - `advancedOcrOptions` (only listed value: `legacy_layout`)
    - `premiumFeatures { enableSelectionMarkDetection, computeStyleInfo, enableMathOcr }`. Math OCR and selection marks are mutually exclusive; selection marks need OCR v2.0+. Top-level `computeStyleInfo` is deprecated.
  - `layoutConfig` (Layout Parser only): `chunkingConfig { chunkSize, includeAncestorHeadings }`, `returnImages`, `returnBoundingBoxes`, `enableImageAnnotation`, `enableTableAnnotation`.
- `skipHumanReview` is deprecated. `fieldMask` and `labels` exist; we don't use them.

## Response (subset we read)

`document.text`, `document.pages[]` with `pageNumber`, `layout.textAnchor`, `paragraphs[].layout`, `lines[]`, `detectedLanguages[]`, `imageQualityScores { qualityScore, detectedDefects[] }`. `TextSegment.startIndex` / `endIndex` are int64 encoded as strings.

Layout Parser returns `document.documentLayout.blocks[]`: `textBlock { text, type, blocks }`, `tableBlock { headerRows, bodyRows, caption }`, `listBlock { listEntries, type: ordered|unordered }`, `imageBlock`, `pageSpan { pageStart, pageEnd }`. `textBlock.type` values (**unverified**, from a summary): `paragraph`, `subtitle`, `heading-1`…`heading-5`, `header`, `footer`.

## Limits (online / synchronous)

| | Enterprise Document OCR | Layout Parser |
|---|---|---|
| Pages per request | 15 (30 in imageless mode) | 15 (30 in imageless mode) |
| File size | 40 MB | 20 MB (Layout Parser page) |
| Batch (needs GCS) | 500 pages, 1 GB | 500 pages |

The 30-page imageless limit "is only applicable when processing pages contiguously starting from page 1". Whether a page selection on a longer file counts against the request limit is **unverified**.

Default quota: 120 online process requests per minute per project per processor type (US/EU multi-region), 6 in single regions.

## Processor versions

- OCR: `pretrained-ocr-v1.2-2022-11-10`, `pretrained-ocr-v2.0-2023-06-02`, `pretrained-ocr-v2.1-2024-08-07` (stable), `pretrained-ocr-v2.1.1-2025-01-31` (release candidate, not in `us`, `eu`, `asia-southeast1`). Add-ons need v2.0+.
- Layout Parser: `pretrained-layout-parser-v1.0-2024-06-03` (stable default) through `pretrained-layout-parser-v3.1-lite-2026-08-11` (release candidate).

## Unverified

- **Pricing and free tier.** The pricing page returned no content when fetched. Search results reported 1,000 free pages/month for Enterprise Document OCR, $1.50 per 1,000 pages after, add-ons $6 per 1,000. `MONTHLY_PAGE_LIMIT=900` assumes the free tier is real.
- **Arabic support list.** The OCR and Layout Parser pages state no language list. Arabic OCR quality is assumed from general reports, not a documented table.
- Whether Google bills a request that fails mid-flight (we assume it may, so we don't refund on network errors).
