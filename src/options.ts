import { type Config, list } from "./config";
import { HttpError } from "./errors";

export interface OcrOptions {
  languageHints: string[];
  nativePdfParsing: boolean;
  imageQualityScores: boolean;
  /** 1-indexed page numbers to process; null = all pages. */
  pages: number[] | null;
  processorVersion: string | null;
  mathOcr: boolean;
  selectionMarks: boolean;
  styleInfo: boolean;
  retentionDays: number;
}

export interface RenderOptions {
  pageMarkers: boolean;
  /** Markdown only: join the OCR line breaks inside a paragraph into one line. */
  joinLines: boolean;
}

type Fields = Record<string, string | undefined>;

function flag(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/** Parses "1-3,5,8-9" into sorted unique page numbers. */
export function parsePageRange(input: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new HttpError(400, `Invalid page range "${part}". Use e.g. 1-3,5`);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (start < 1 || end < start || end > totalPages) {
      throw new HttpError(400, `Page range "${part}" is outside 1-${totalPages}`);
    }
    for (let p = start; p <= end; p++) pages.add(p);
  }
  if (pages.size === 0) throw new HttpError(400, "Page range is empty");
  return [...pages].sort((a, b) => a - b);
}

export function parseOcrOptions(fields: Fields, config: Config, totalPages: number): OcrOptions {
  const languageHints = fields.language_hints !== undefined ? list(fields.language_hints) : config.defaultLanguageHints;
  for (const code of languageHints) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
      throw new HttpError(400, `Invalid language code "${code}" (use BCP-47, e.g. ar, en)`);
    }
  }

  const processorVersion = fields.processor_version?.trim() || null;
  if (processorVersion && !/^[a-z0-9][a-z0-9.\-]*$/.test(processorVersion)) {
    throw new HttpError(400, "Invalid processor_version");
  }

  const mathOcr = flag(fields.math_ocr, false);
  const selectionMarks = flag(fields.selection_marks, false);
  const styleInfo = flag(fields.style_info, false);
  if ((mathOcr || selectionMarks || styleInfo) && !config.allowPremiumFeatures) {
    throw new HttpError(403, "Premium OCR add-ons are disabled (ALLOW_PREMIUM_FEATURES=false). They are billed extra.");
  }
  if (mathOcr && selectionMarks) {
    throw new HttpError(400, "math_ocr and selection_marks cannot be used together");
  }

  let retentionDays = config.retentionDays;
  if (fields.retention_days) {
    retentionDays = Number.parseInt(fields.retention_days, 10);
    if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > config.maxRetentionDays) {
      throw new HttpError(400, `retention_days must be 1-${config.maxRetentionDays}`);
    }
  }

  const range = fields.pages?.trim();
  return {
    languageHints,
    nativePdfParsing: flag(fields.native_pdf_parsing, config.defaultNativePdfParsing),
    imageQualityScores: flag(fields.image_quality_scores, false),
    pages: range ? parsePageRange(range, totalPages) : null,
    processorVersion,
    mathOcr,
    selectionMarks,
    styleInfo,
    retentionDays,
  };
}

export function parseRenderOptions(fields: Fields): RenderOptions {
  return {
    pageMarkers: flag(fields.page_markers, true),
    joinLines: flag(fields.join_lines, true),
  };
}
