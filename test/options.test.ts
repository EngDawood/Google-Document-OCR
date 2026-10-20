import { describe, expect, it } from "vitest";
import { type Env, loadConfig } from "../src/config";
import { buildProcessRequest } from "../src/google";
import { parseOcrOptions, parsePageRange } from "../src/options";

const config = loadConfig({ MONTHLY_PAGE_LIMIT: "900", RETENTION_DAYS: "7", MAX_RETENTION_DAYS: "30" } as Env);

describe("loadConfig", () => {
  it("caps pages per file at Google's online limit", () => {
    expect(loadConfig({ MAX_PAGES_PER_FILE: "100" } as Env).maxPagesPerFile).toBe(30);
    expect(loadConfig({ MAX_PAGES_PER_FILE: "100", IMAGELESS_MODE: "false" } as Env).maxPagesPerFile).toBe(15);
  });
});

describe("parsePageRange", () => {
  it("parses ranges and singles, sorted and unique", () => {
    expect(parsePageRange("5, 1-3,2", 10)).toEqual([1, 2, 3, 5]);
  });
  it("rejects out-of-range and malformed input", () => {
    expect(() => parsePageRange("0-2", 10)).toThrow();
    expect(() => parsePageRange("9-11", 10)).toThrow();
    expect(() => parsePageRange("a", 10)).toThrow();
  });
});

describe("parseOcrOptions", () => {
  it("applies defaults", () => {
    const o = parseOcrOptions({}, config, 4);
    expect(o).toMatchObject({ languageHints: [], nativePdfParsing: false, pages: null, retentionDays: 7 });
  });
  it("blocks premium add-ons unless allowed", () => {
    expect(() => parseOcrOptions({ math_ocr: "true" }, config, 1)).toThrow(/disabled/);
    const allowed = { ...config, allowPremiumFeatures: true };
    expect(parseOcrOptions({ math_ocr: "true" }, allowed, 1).mathOcr).toBe(true);
    expect(() => parseOcrOptions({ math_ocr: "true", selection_marks: "true" }, allowed, 1)).toThrow();
  });
  it("validates retention and language codes", () => {
    expect(() => parseOcrOptions({ retention_days: "31" }, config, 1)).toThrow();
    expect(() => parseOcrOptions({ language_hints: "ar,<x>" }, config, 1)).toThrow();
    expect(parseOcrOptions({ language_hints: "ar, en" }, config, 1).languageHints).toEqual(["ar", "en"]);
  });
});

describe("buildProcessRequest", () => {
  it("builds the Document AI request body", () => {
    const opts = parseOcrOptions({ language_hints: "ar", pages: "2-3", image_quality_scores: "1" }, config, 5);
    expect(buildProcessRequest("QUJD", "application/pdf", opts, true)).toEqual({
      rawDocument: { content: "QUJD", mimeType: "application/pdf" },
      imagelessMode: true,
      processOptions: {
        individualPageSelector: { pages: [2, 3] },
        ocrConfig: { enableNativePdfParsing: false, enableImageQualityScores: true, hints: { languageHints: ["ar"] } },
      },
    });
  });
});
