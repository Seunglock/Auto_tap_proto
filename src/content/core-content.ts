import type { CodeBlock, ContentSection } from "@/shared/types";

export type CoreContentResult = {
  text: string;
  bodyText: string;
  headings: string[];
  sections: ContentSection[];
  codeBlocks: CodeBlock[];
  confidence: number;
  source: "semantic-tag" | "scored-dom" | "fallback";
};

const MAX_BODY_CHARS = 16_000;
const MAX_EXCERPT_CHARS = 1_800;
const NOISE_SELECTOR = [
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "iframe",
  "svg",
  "canvas",
  "dialog",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
  "[hidden]",
  ".advertisement",
  ".ads",
  ".cookie",
  ".modal",
  ".newsletter",
  ".recommend",
  ".related",
  ".share",
  ".sidebar",
  ".social",
].join(",");

const POSITIVE_PATTERN =
  /(article|body|content|detail|entry|main|post|read|story|text)/i;
const NEGATIVE_PATTERN =
  /(ad-|advert|breadcrumb|comment|cookie|footer|header|menu|nav|promo|recommend|related|share|sidebar|social|sponsor|widget)/i;

type Candidate = {
  element: Element;
  bodyText: string;
  score: number;
  linkDensity: number;
};

export function extractCoreContent(): CoreContentResult {
  const candidates = collectCandidates();
  const best = candidates.sort((a, b) => b.score - a.score)[0];

  if (best && best.bodyText.length >= 120 && best.score > 8) {
    const headings = collectHeadings(best.element);
    const sections = collectSections(best.element);
    const confidence = confidenceFor(best);
    const source = isSemanticElement(best.element)
      ? "semantic-tag"
      : "scored-dom";
    return {
      text: buildExcerpt(best.bodyText, sections),
      bodyText: best.bodyText.slice(0, MAX_BODY_CHARS),
      headings,
      sections,
      codeBlocks: collectCodeBlocks(best.element),
      confidence,
      source,
    };
  }

  const fallbackRoot = document.body;
  const bodyText = fallbackRoot
    ? cleanCandidateText(fallbackRoot).slice(0, MAX_BODY_CHARS)
    : "";
  return {
    text: trimToSentence(bodyText, MAX_EXCERPT_CHARS),
    bodyText,
    headings: fallbackRoot ? collectHeadings(fallbackRoot) : [],
    sections: fallbackRoot ? collectSections(fallbackRoot) : [],
    codeBlocks: fallbackRoot ? collectCodeBlocks(fallbackRoot) : [],
    confidence: 0.2,
    source: "fallback",
  };
}

function collectCandidates(): Candidate[] {
  const roots = Array.from(
    document.querySelectorAll("article, main, [role='main'], section, div"),
  );
  const candidates: Candidate[] = [];

  for (const element of roots) {
    const rawText = normalizeText((element as HTMLElement).innerText ?? "");
    if (rawText.length < 100) continue;

    const linkDensity = getLinkDensity(element);
    const paragraphCount = element.querySelectorAll("p").length;
    const sentenceCount = (rawText.match(/[.!?。！？]\s|[.!?。！？]$/g) ?? [])
      .length;
    const tag = element.tagName.toLowerCase();
    const classId = `${element.className || ""} ${element.id || ""}`;

    let score = Math.min(rawText.length / 180, 28);
    score += Math.min(paragraphCount * 1.8, 20);
    score += Math.min(sentenceCount * 0.7, 12);
    if (tag === "article") score += 22;
    if (tag === "main" || element.getAttribute("role") === "main") score += 18;
    if (POSITIVE_PATTERN.test(classId)) score += 10;
    if (NEGATIVE_PATTERN.test(classId)) score -= 24;
    if (linkDensity > 0.55) score -= 30;
    else if (linkDensity > 0.35) score -= 14;
    else if (linkDensity < 0.15) score += 5;

    const rect = element.getBoundingClientRect();
    if (rect.width >= 420) score += 4;
    if (rect.height >= 240) score += 3;
    if (rect.width <= 1 || rect.height <= 1) score -= 30;
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth || 1;
    const horizontalCenter = rect.left + rect.width / 2;
    const centrality =
      1 -
      Math.min(
        1,
        Math.abs(horizontalCenter - viewportWidth / 2) / (viewportWidth / 2),
      );
    score += centrality * 6;
    if (rawText.length > 300 && paragraphCount === 0) score -= 8;

    candidates.push({ element, bodyText: "", score, linkDensity });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((candidate) => ({
      ...candidate,
      bodyText: cleanCandidateText(candidate.element),
    }))
    .filter((candidate) => candidate.bodyText.length >= 100);
}

function cleanCandidateText(root: Element): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NOISE_SELECTOR).forEach((node) => node.remove());
  clone.querySelectorAll("*").forEach((node) => {
    const classId = `${node.className || ""} ${node.id || ""}`;
    if (NEGATIVE_PATTERN.test(classId)) node.remove();
  });

  const blocks = Array.from(
    clone.querySelectorAll("h1, h2, h3, h4, p, blockquote, li, pre, table, dl"),
  )
    .map((node) =>
      node.tagName.toLowerCase() === "table"
        ? tableToText(node)
        : normalizeText(node.textContent ?? ""),
    )
    .filter((text) => text.length >= 2);
  const deduped = dedupeTextBlocks(blocks);
  if (deduped.length > 0) return deduped.join("\n\n").slice(0, MAX_BODY_CHARS);
  return normalizeText(clone.innerText ?? clone.textContent ?? "").slice(
    0,
    MAX_BODY_CHARS,
  );
}

function tableToText(table: Element): string {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td"))
        .map((cell) => normalizeText(cell.textContent ?? ""))
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

function collectHeadings(root: Element): string[] {
  const headings = Array.from(root.querySelectorAll("h1, h2, h3"))
    .map((node) => normalizeText((node as HTMLElement).innerText ?? ""))
    .filter((text) => text.length >= 2 && text.length <= 200);
  return dedupeTextBlocks(headings).slice(0, 12);
}

function collectSections(root: Element): ContentSection[] {
  const sections: ContentSection[] = [];
  const seen = new Set<string>();
  for (const headingNode of Array.from(root.querySelectorAll("h1, h2, h3"))) {
    const heading = normalizeText((headingNode as HTMLElement).innerText ?? "");
    if (!heading || heading.length > 200) continue;

    const parts: string[] = [];
    let sibling = headingNode.nextElementSibling;
    while (sibling && parts.join(" ").length < 1_600) {
      if (/^H[1-3]$/.test(sibling.tagName)) break;
      const text = cleanCandidateText(sibling);
      if (text.length >= 20) parts.push(text);
      sibling = sibling.nextElementSibling;
    }
    const text = dedupeTextBlocks(parts).join("\n\n").slice(0, 1_800);
    const key = `${heading}\n${text.slice(0, 120)}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    sections.push({ heading, text });
    if (sections.length >= 8) break;
  }
  return sections;
}

function collectCodeBlocks(root: ParentNode): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const seen = new Set<string>();
  root.querySelectorAll("pre code, pre").forEach((node) => {
    const code = node.textContent?.trim() ?? "";
    if (code.length < 8 || seen.has(code)) return;
    seen.add(code);
    const classes = `${node.className} ${node.parentElement?.className ?? ""}`;
    const language = classes.match(/(?:language-|lang-)([\w#+.-]+)/i)?.[1];
    blocks.push({ language, code: code.slice(0, 2_000) });
  });
  return blocks.slice(0, 5);
}

function buildExcerpt(bodyText: string, sections: ContentSection[]): string {
  const sectionText = sections
    .slice(0, 3)
    .map((section) => [section.heading, section.text].filter(Boolean).join(": "))
    .join("\n");
  return trimToSentence(sectionText || bodyText, MAX_EXCERPT_CHARS);
}

function getLinkDensity(node: Element): number {
  const textLength = normalizeText((node as HTMLElement).innerText ?? "").length;
  if (textLength === 0) return 0;
  const linkLength = Array.from(node.querySelectorAll("a")).reduce(
    (sum, anchor) =>
      sum + normalizeText((anchor as HTMLElement).innerText ?? "").length,
    0,
  );
  return linkLength / textLength;
}

function confidenceFor(candidate: Candidate): number {
  const scoreConfidence = Math.min(0.9, 0.35 + candidate.score / 100);
  const linkPenalty = Math.min(0.25, candidate.linkDensity * 0.35);
  return Math.max(0.25, scoreConfidence - linkPenalty);
}

function isSemanticElement(element: Element): boolean {
  return (
    element.tagName.toLowerCase() === "article" ||
    element.tagName.toLowerCase() === "main" ||
    element.getAttribute("role") === "main"
  );
}

function dedupeTextBlocks(blocks: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const block of blocks) {
    const normalized = normalizeText(block);
    const key = normalized.toLowerCase().slice(0, 180);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimToSentence(text: string, maxChars: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;
  const threshold = Math.floor(maxChars * 0.65);
  const chunk = normalized.slice(0, maxChars);
  for (let index = chunk.length - 1; index >= threshold; index -= 1) {
    if (/[.!?。！？]/.test(chunk[index])) return chunk.slice(0, index + 1);
  }
  return chunk.trim();
}
