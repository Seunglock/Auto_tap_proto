import type { ContentSection } from "@/shared/types";

export type NamuWikiContent = {
  bodyText: string;
  headings: string[];
  sections: ContentSection[];
  summary: string;
};

const MAX_SECTION_CHARS = 1_800;
const MAX_BODY_CHARS = 16_000;

export function extractNamuWikiContent(): NamuWikiContent | null {
  const headingNodes = Array.from(document.querySelectorAll("h2, h3"));
  const sections: ContentSection[] = [];
  for (const heading of headingNodes) {
    const cleanHeading = cleanNamuHeading(heading.textContent ?? "");
    if (!cleanHeading || isIgnoredHeading(cleanHeading)) continue;
    const text = collectSectionText(heading);
    if (text.length < 80) continue;
    sections.push({
      heading: cleanHeading,
      text: text.slice(0, MAX_SECTION_CHARS),
    });
    if (sections.length >= 10) break;
  }

  const bodyText = sections
    .map((section) => [section.heading, section.text].join("\n"))
    .join("\n\n")
    .slice(0, MAX_BODY_CHARS);
  if (bodyText.length < 120) return null;

  const headings = sections
    .map((section) => section.heading ?? "")
    .filter((heading) => heading.length > 0)
    .slice(0, 12);
  const overview =
    sections.find((section) => /개요|소개|특징/.test(section.heading ?? "")) ??
    sections[0];

  return {
    bodyText,
    headings,
    sections,
    summary: overview
      ? `${overview.heading ?? ""}: ${overview.text}`.slice(0, 1_800)
      : bodyText.slice(0, 1_800),
  };
}

function collectSectionText(heading: Element): string {
  const parts: string[] = [];
  const root = document.body;
  if (!root) return "";

  const headingLevel = sectionHeadingLevel(heading);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let collecting = false;
  while (walker.nextNode() && parts.join(" ").length < MAX_SECTION_CHARS) {
    const node = walker.currentNode as Element;
    if (node === heading) {
      collecting = true;
      continue;
    }
    if (!collecting) continue;

    if (isSectionHeading(node) && sectionHeadingLevel(node) <= headingLevel) {
      break;
    }
    if (!isReadableParagraphNode(node)) continue;

    const text = cleanNamuText(node.textContent ?? "");
    if (text.length >= 30) parts.push(text);
  }
  return dedupeLines(parts).join("\n\n").slice(0, MAX_SECTION_CHARS);
}

function isSectionHeading(node: Element): boolean {
  return /^H[23]$/.test(node.tagName) && node.classList.contains("wiki-heading");
}

function sectionHeadingLevel(node: Element): number {
  const match = node.tagName.match(/^H([1-6])$/);
  return match ? Number(match[1]) : 6;
}

function isReadableParagraphNode(node: Element): boolean {
  if (
    !node.matches(".wiki-paragraph, p, li") ||
    node.closest("table, nav, header, footer, aside, .wiki-macro-toc")
  ) {
    return false;
  }
  return !Array.from(node.children).some((child) =>
    child.matches(".wiki-paragraph, p, li"),
  );
}

function cleanNamuHeading(value: string): string {
  return cleanNamuText(value)
    .replace(/\[편집\]/g, "")
    .replace(/^\d+(?:\.\d+)*\.\s*/, "")
    .trim();
}

function cleanNamuText(value: string): string {
  const lines = value
    .replace(/\u00a0/g, " ")
    .replace(/\[편집\]/g, " ")
    .replace(/\[\d+(?:\.\d+)?\]/g, " ")
    .replace(/\[clearfix\]/gi, " ")
    .replace(/\s{2,}/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2 && !isNamuNoiseLine(line));
  return dedupeLines(lines).join(" ").trim();
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase().slice(0, 180);
    if (!line || seen.has(key)) continue;
    seen.add(key);
    output.push(line);
  }
  return output;
}

function isIgnoredHeading(value: string): boolean {
  return /^(분류|둘러보기|관련 문서|외부 링크|각주|여담|사건 사고)$/i.test(value);
}

function isNamuNoiseLine(value: string): boolean {
  if (
    /(최근\s*수정\s*시각|분류:|상위\s*문서:|하위\s*문서:|관련\s*문서:|나무위키|로그인|회원가입|토론|역사|ACL|편집|닫기|펼치기|접기|주의\.|이\s*저작물|\|\s*시\s*\||\|\s*군\s*\||\|\s*도청\s*)/i.test(
      value,
    )
  )
    return true;
  if (/^[-–—\s|·]+$/.test(value)) return true;
  if (/^\d{4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}/.test(value)) return true;
  return false;
}
