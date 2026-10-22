# Roadmap

Ordered by the user's priority. Each item notes the approach worked out so far; confirm with the user before starting one.

## 1. PDF splitting (large files)

Goal: accept PDFs above the online limit (30 pages imageless, 15 otherwise).

Approach:
- Split with `pdf-lib` in the Worker (paid plan has the CPU budget) into chunks of `MAX_PAGES_PER_FILE`, each also under the size limit. Chunks start at page 1 of their own file, so the imageless 30-page limit applies.
- Reserve the **whole** document's pages up front, refund per failed chunk.
- Process chunks with limited concurrency (Google default quota is 120 requests/min per processor type in `us`/`eu`), then merge Documents in page order, offsetting page numbers.
- Long files outgrow a single request: move processing to a Cloudflare Queue or Workflow and make `POST /api/ocr` return a job to poll (`status: processing`). The `jobs` table already has the status column.
- Alternative for very large files: Document AI batch processing (500 pages, needs a GCS bucket and more GCP setup).

## 2. Layout Parser option

Goal: structure-aware Markdown (headings, lists, tables).

Approach: a second processor ID setting, a per-request `processor=layout` option, `layoutConfig` in the request, and a renderer for `documentLayout.blocks` (see `docs/google-document-ai.md`). Check pricing and Arabic quality first; the 20 MB file limit is lower than OCR's.

## 3. Searchable PDF output

Goal: the original PDF with an invisible text layer.

Hard part: Arabic needs shaping and right-to-left ordering in the text layer. References: `LikeCarter/google-document-ai-searchable-pdf`, `goroggy/GrGoogleOCR` (C#), Document AI Toolbox hOCR export. May fit better as an external step than inside the Worker.
