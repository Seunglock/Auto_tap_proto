export function extractGeneric(): string {
  const parts: string[] = [];

  const ogTitle = metaContent('meta[property="og:title"]');
  if (ogTitle) parts.push(ogTitle);

  const desc =
    metaContent('meta[name="description"]') ??
    metaContent('meta[property="og:description"]');
  if (desc) parts.push(desc);

  const h1 = document.querySelector("h1");
  if (h1?.textContent) parts.push(h1.textContent.trim());

  const main =
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.querySelector('[role="main"]');
  if (main) {
    const mainText = (main as HTMLElement).innerText?.trim();
    if (mainText) parts.push(mainText.slice(0, 800));
  } else {
    const bodyText = (document.body?.innerText ?? "").trim();
    if (bodyText) parts.push(bodyText.slice(0, 500));
  }

  return dedupePieces(parts).join(" | ").replace(/\s+/g, " ").trim();
}

function metaContent(selector: string): string | null {
  const el = document.querySelector(selector) as HTMLMetaElement | null;
  const content = el?.content?.trim();
  return content && content.length > 0 ? content : null;
}

function dedupePieces(pieces: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of pieces) {
    const key = piece.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(piece);
  }
  return out;
}
