import type { DocAiDocument, DocAiPage, TextAnchor } from "./google";
import type { RenderOptions } from "./options";

export function anchorText(text: string, anchor: TextAnchor | undefined): string {
  if (!anchor?.textSegments) return "";
  return anchor.textSegments
    .map((s) => text.slice(Number(s.startIndex ?? 0), Number(s.endIndex ?? 0)))
    .join("");
}

/** The real page number in the source file (respects page selection). */
function pageNumber(page: DocAiPage, index: number, selected: number[] | null): number {
  return selected?.[index] ?? page.pageNumber ?? index + 1;
}

function paragraphs(text: string, page: DocAiPage): string[] {
  const parts = (page.paragraphs ?? []).map((p) => anchorText(text, p.layout?.textAnchor).trim()).filter(Boolean);
  if (parts.length > 0) return parts;
  const whole = anchorText(text, page.layout?.textAnchor).trim();
  return whole ? [whole] : [];
}

// Avoid accidental headings/quotes/code from OCR text that starts with Markdown syntax.
function escapeMarkdownLine(line: string): string {
  return line.replace(/^(\s*)([#>]|`{3,}|={3,}|-{3,})/, "$1\\$2");
}

export function toMarkdown(doc: DocAiDocument, opts: RenderOptions, selected: number[] | null = null): string {
  const text = doc.text ?? "";
  const pages = doc.pages ?? [];
  if (pages.length === 0) return text.trim() + "\n";

  const out = pages.map((page, i) => {
    const body = paragraphs(text, page)
      .map((p) => {
        const lines = p.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(escapeMarkdownLine);
        // Two trailing spaces = Markdown line break, keeps the original line layout.
        return opts.joinLines ? lines.join(" ") : lines.join("  \n");
      })
      .join("\n\n");
    return opts.pageMarkers ? `<!-- page ${pageNumber(page, i, selected)} -->\n\n${body}` : body;
  });
  return out.join("\n\n").trim() + "\n";
}

export function toText(doc: DocAiDocument, opts: RenderOptions, selected: number[] | null = null): string {
  const text = doc.text ?? "";
  const pages = doc.pages ?? [];
  if (pages.length === 0) return text.trim() + "\n";

  const out = pages.map((page, i) => {
    const body = paragraphs(text, page).join("\n\n");
    return opts.pageMarkers ? `===== Page ${pageNumber(page, i, selected)} =====\n\n${body}` : body;
  });
  return out.join("\n\n").trim() + "\n";
}

export interface PageMeta {
  page: number;
  chars: number;
  languages: string[];
  qualityScore?: number;
  defects?: string[];
}

export function pageMeta(doc: DocAiDocument, selected: number[] | null = null): PageMeta[] {
  const text = doc.text ?? "";
  return (doc.pages ?? []).map((page, i) => ({
    page: pageNumber(page, i, selected),
    chars: anchorText(text, page.layout?.textAnchor).length,
    languages: (page.detectedLanguages ?? []).map((l) => l.languageCode ?? "").filter(Boolean),
    ...(page.imageQualityScores && {
      qualityScore: page.imageQualityScores.qualityScore,
      defects: (page.imageQualityScores.detectedDefects ?? [])
        .filter((d) => (d.confidence ?? 0) >= 0.5)
        .map((d) => d.type ?? ""),
    }),
  }));
}
