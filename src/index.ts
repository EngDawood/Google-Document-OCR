import { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import { type AuthMethod, requireAuth } from "./auth";
import { type Env, loadConfig } from "./config";
import { HttpError } from "./errors";
import { processDocument } from "./google";
import { parseOcrOptions, parseRenderOptions } from "./options";
import { getUsage, refundPages, reservePages } from "./quota";
import { pageMeta, toMarkdown, toText } from "./render";
import { cleanupExpired } from "./cleanup";
import { UI_HTML } from "./ui";

type App = { Bindings: Env; Variables: { auth: AuthMethod } };

const DAY_MS = 24 * 60 * 60 * 1000;
const FORMATS = { md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8" } as const;
type Format = keyof typeof FORMATS;

function detectMimeType(bytes: Uint8Array): string | null {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (head(8).join() === "137,80,78,71,13,10,26,10") return "image/png";
  if (head(3).join() === "255,216,255") return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 2) === "BM") return "image/bmp";
  return null;
}

async function countPages(bytes: Uint8Array, mimeType: string): Promise<number> {
  if (mimeType !== "application/pdf") return 1;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    throw new HttpError(400, "Could not read the PDF (corrupt or unsupported)");
  }
}

function resultKey(id: string, format: Format) {
  return `results/${id}.${format}`;
}

const app = new Hono<App>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.get("/", (c) => c.html(UI_HTML));

const api = new Hono<App>();
api.use("*", requireAuth);

api.get("/config", (c) => {
  const config = loadConfig(c.env);
  return c.json({
    maxPagesPerFile: config.maxPagesPerFile,
    maxFileMB: config.maxFileBytes / 1024 / 1024,
    monthlyPageLimit: config.monthlyPageLimit || null,
    dailyPageLimit: config.dailyPageLimit || null,
    retentionDays: config.retentionDays,
    maxRetentionDays: config.maxRetentionDays,
    allowPremiumFeatures: config.allowPremiumFeatures,
    defaultLanguageHints: config.defaultLanguageHints,
    defaultNativePdfParsing: config.defaultNativePdfParsing,
    imagelessMode: config.imagelessMode,
  });
});

api.get("/usage", async (c) => c.json(await getUsage(c.env.DB, loadConfig(c.env))));

api.post("/ocr", async (c) => {
  const config = loadConfig(c.env);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new HttpError(400, 'Send the document as multipart field "file"');
  if (file.size > config.maxFileBytes) {
    throw new HttpError(413, `File is larger than ${config.maxFileBytes / 1024 / 1024} MB`);
  }

  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") fields[k] = v;

  const format = (fields.format ?? "md") as Format | "none";
  if (!["md", "txt", "none"].includes(format)) throw new HttpError(400, "format must be md, txt or none");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectMimeType(bytes);
  if (!mimeType) throw new HttpError(415, "Unsupported file type. Use PDF, PNG, JPEG, WEBP or BMP.");

  const totalPages = await countPages(bytes, mimeType);
  const ocr = parseOcrOptions(fields, config, totalPages);
  const render = parseRenderOptions(fields);
  const pages = ocr.pages?.length ?? totalPages;
  if (pages > config.maxPagesPerFile) {
    throw new HttpError(
      413,
      `Document has ${pages} pages; the limit is ${config.maxPagesPerFile} per request. Select a range with "pages" (e.g. 1-${config.maxPagesPerFile}).`,
    );
  }

  await reservePages(c.env.DB, config, pages);

  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + ocr.retentionDays * DAY_MS;
  await c.env.DB.prepare(
    "INSERT INTO jobs (id, filename, mime_type, pages, status, options, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, 'processing', ?5, ?6, ?7)",
  )
    .bind(id, file.name || "document", mimeType, pages, JSON.stringify({ ...ocr, ...render }), now, expiresAt)
    .run();

  let doc;
  try {
    doc = await processDocument(c.env, bytes, mimeType, ocr, config.imagelessMode);
  } catch (err) {
    // HttpError = Google rejected it (or auth failed before sending): not billed, give the pages back.
    // Network errors/timeouts are left counted, since Google may have processed the request.
    if (err instanceof HttpError) await refundPages(c.env.DB, pages);
    const message = err instanceof Error ? err.message : String(err);
    await c.env.DB.prepare("UPDATE jobs SET status = 'failed', error = ?2 WHERE id = ?1").bind(id, message).run();
    throw err;
  }

  const outputs: Record<Format, string> = {
    md: toMarkdown(doc, render, ocr.pages),
    txt: toText(doc, render, ocr.pages),
  };
  for (const f of Object.keys(FORMATS) as Format[]) {
    await c.env.RESULTS.put(resultKey(id, f), outputs[f], {
      httpMetadata: { contentType: FORMATS[f] },
      customMetadata: { expiresAt: String(expiresAt) },
    });
  }
  const meta = { pages: pageMeta(doc, ocr.pages) };
  await c.env.DB.prepare("UPDATE jobs SET status = 'done', meta = ?2 WHERE id = ?1").bind(id, JSON.stringify(meta)).run();

  const base = new URL(c.req.url).origin;
  return c.json({
    id,
    filename: file.name,
    pages,
    expiresAt: new Date(expiresAt).toISOString(),
    files: { md: `${base}/api/jobs/${id}/md`, txt: `${base}/api/jobs/${id}/txt` },
    meta,
    ...(format !== "none" && { format, content: outputs[format] }),
    usage: await getUsage(c.env.DB, config),
  });
});

interface JobRow {
  id: string;
  filename: string;
  mime_type: string;
  pages: number;
  status: string;
  error: string | null;
  options: string;
  meta: string | null;
  created_at: number;
  expires_at: number;
}

function jobJson(row: JobRow) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    pages: row.pages,
    status: row.status,
    error: row.error,
    options: JSON.parse(row.options),
    meta: row.meta ? JSON.parse(row.meta) : null,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

async function findJob(env: Env, id: string): Promise<JobRow> {
  const row = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?1 AND expires_at > ?2").bind(id, Date.now()).first<JobRow>();
  if (!row) throw new HttpError(404, "Job not found or expired");
  return row;
}

api.get("/jobs", async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const rows = await c.env.DB.prepare("SELECT * FROM jobs WHERE expires_at > ?1 ORDER BY created_at DESC LIMIT ?2")
    .bind(Date.now(), limit)
    .all<JobRow>();
  return c.json({ jobs: rows.results.map(jobJson) });
});

api.get("/jobs/:id", async (c) => c.json(jobJson(await findJob(c.env, c.req.param("id")))));

api.get("/jobs/:id/:format{md|txt}", async (c) => {
  const job = await findJob(c.env, c.req.param("id"));
  const format = c.req.param("format") as Format;
  const obj = await c.env.RESULTS.get(resultKey(job.id, format));
  if (!obj) throw new HttpError(404, "Result not found");

  const headers: Record<string, string> = { "content-type": FORMATS[format] };
  if (c.req.query("download") !== undefined) {
    const name = `${job.filename.replace(/\.[^.]+$/, "") || "document"}.${format}`;
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    headers["content-disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  return new Response(obj.body, { headers });
});

api.delete("/jobs/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.RESULTS.delete([resultKey(id, "md"), resultKey(id, "txt")]);
  const res = await c.env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(id).run();
  if (res.meta.changes === 0) throw new HttpError(404, "Job not found");
  return c.json({ deleted: id });
});

app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env).then((n) => console.log(`cleanup: removed ${n} expired job(s)`)));
  },
} satisfies ExportedHandler<Env>;
