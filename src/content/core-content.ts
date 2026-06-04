export type CoreContentResult = {
  text: string;
  headings: string[];
  confidence: number; // 0.0–1.0
  source: "semantic-tag" | "scored-dom" | "fallback";
};

function getLinkDensity(node: Element): number {
  const text = (node as HTMLElement).innerText;
  if (text.length === 0) return 0;
  let anchorTextLen = 0;
  node.querySelectorAll("a").forEach((a) => {
    anchorTextLen += (a as HTMLElement).innerText.length;
  });
  return anchorTextLen / text.length;
}

function trimToSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const threshold = Math.floor(maxChars * 0.6);
  const sub = text.slice(0, maxChars);
  for (let i = sub.length - 1; i >= threshold; i--) {
    const ch = sub[i];
    if (ch === "." || ch === "?" || ch === "!" || ch === "。") {
      return sub.slice(0, i + 1);
    }
  }
  return sub;
}

export function extractCoreContent(): CoreContentResult {
  // Collect headings: h1, h2, h3 — strip whitespace, skip < 2 or > 200 chars, take first 5
  const headings: string[] = [];
  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    const text = (el as HTMLElement).innerText.trim();
    if (text.length >= 2 && text.length <= 200) headings.push(text);
  });
  const collectedHeadings = headings.slice(0, 5);

  // Fast path — semantic tag: article → main → [role="main"]
  for (const sel of ["article", "main", '[role="main"]']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const text = (el as HTMLElement).innerText;
    const linkDensity = getLinkDensity(el);
    if (text.length >= 200 && linkDensity < 0.5) {
      const confidence = Math.max(0.5, 0.85 - linkDensity * 0.4);
      return {
        text: trimToSentence(text, 800),
        headings: collectedHeadings,
        confidence,
        source: "semantic-tag",
      };
    }
  }

  // Score-based fallback
  const SKIP_TAGS = new Set([
    "script", "style", "noscript", "nav", "footer",
    "aside", "header", "form", "button", "select", "iframe", "svg",
  ]);

  let bestScore = -Infinity;
  let bestEl: Element | null = null;

  document.querySelectorAll("div, section, article, main").forEach((node) => {
    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    const text = (node as HTMLElement).innerText;
    if (text.length < 80) return;

    let score = 0;
    score += Math.min(text.length / 60, 12);
    score += node.querySelectorAll("p").length * 2;
    if (tag === "main") score += 25;
    if (tag === "article") score += 20;
    if (tag === "section") score += 8;

    const classId = (node.className + " " + node.id).toLowerCase();
    if (/(content|article|post|entry|story|detail|page-body|main-text)/.test(classId)) score += 12;
    if (/(nav|sidebar|menu|footer|comment|related|recommend|widget|share|ad-)/.test(classId)) score -= 18;

    const linkDensity = getLinkDensity(node);
    if (linkDensity > 0.5) score -= 18;
    else if (linkDensity > 0.35) score -= 8;

    const rect = node.getBoundingClientRect();
    if (rect.width > 400) score += 5;

    if (score > bestScore) {
      bestScore = score;
      bestEl = node;
    }
  });

  if (bestEl !== null && bestScore > 8) {
    const text = (bestEl as HTMLElement).innerText;
    const confidence = Math.min(bestScore / 55, 0.75);
    return {
      text: trimToSentence(text, 800),
      headings: collectedHeadings,
      confidence,
      source: "scored-dom",
    };
  }

  // Fallback
  const fallbackText = document.body?.innerText ?? "";
  return {
    text: trimToSentence(fallbackText, 500),
    headings: collectedHeadings,
    confidence: 0.2,
    source: "fallback",
  };
}
