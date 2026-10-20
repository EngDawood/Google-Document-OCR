import { describe, expect, it } from "vitest";
import type { DocAiDocument } from "../src/google";
import { pageMeta, toMarkdown, toText } from "../src/render";

// Two pages; page 1 has two paragraphs (one wrapped over two lines), page 2 has no paragraphs.
const text = "مرحبا بالعالم\nسطر ثاني\n# not a heading\nPage two text\n";
const seg = (start: number, end: number) => ({ textAnchor: { textSegments: [{ startIndex: String(start), endIndex: String(end) }] } });
const p1a = [0, text.indexOf("# not")];
const p1b = [text.indexOf("# not"), text.indexOf("Page two")];
const doc: DocAiDocument = {
  text,
  pages: [
    {
      pageNumber: 1,
      layout: seg(0, p1b[1]),
      paragraphs: [{ layout: seg(p1a[0], p1a[1]) }, { layout: seg(p1b[0], p1b[1]) }],
      detectedLanguages: [{ languageCode: "ar" }],
      imageQualityScores: { qualityScore: 0.9, detectedDefects: [{ type: "quality/defect_blurry", confidence: 0.7 }] },
    },
    { pageNumber: 2, layout: seg(p1b[1], text.length) },
  ],
};

describe("toMarkdown", () => {
  it("joins paragraph lines, escapes markdown, adds page markers", () => {
    expect(toMarkdown(doc, { pageMarkers: true, joinLines: true })).toBe(
      "<!-- page 1 -->\n\nمرحبا بالعالم سطر ثاني\n\n\\# not a heading\n\n<!-- page 2 -->\n\nPage two text\n",
    );
  });

  it("keeps line breaks when joinLines is off", () => {
    expect(toMarkdown(doc, { pageMarkers: false, joinLines: false })).toBe(
      "مرحبا بالعالم  \nسطر ثاني\n\n\\# not a heading\n\nPage two text\n",
    );
  });

  it("uses the selected page numbers for markers", () => {
    expect(toMarkdown(doc, { pageMarkers: true, joinLines: true }, [3, 7])).toContain("<!-- page 7 -->");
  });
});

describe("toText", () => {
  it("keeps original lines and separates pages", () => {
    expect(toText(doc, { pageMarkers: true, joinLines: true })).toBe(
      "===== Page 1 =====\n\nمرحبا بالعالم\nسطر ثاني\n\n# not a heading\n\n===== Page 2 =====\n\nPage two text\n",
    );
  });

  it("handles a document without pages", () => {
    expect(toText({ text: "hello\n" }, { pageMarkers: true, joinLines: true })).toBe("hello\n");
  });
});

describe("pageMeta", () => {
  it("reports chars, languages and confident defects", () => {
    const meta = pageMeta(doc);
    expect(meta[0]).toEqual({ page: 1, chars: p1b[1], languages: ["ar"], qualityScore: 0.9, defects: ["quality/defect_blurry"] });
    expect(meta[1]).toEqual({ page: 2, chars: "Page two text\n".length, languages: [] });
  });
});
