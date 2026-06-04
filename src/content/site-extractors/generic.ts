import { extractCoreContent } from "../core-content";

export function extractGeneric(): string {
  const meta = getMetaDescription();
  const core = extractCoreContent();
  const parts: string[] = [];
  if (meta && !core.text.startsWith(meta.slice(0, 40))) parts.push(meta);
  if (core.text) parts.push(core.text);
  return dedupePieces(parts).join(" | ").replace(/\s+/g, " ").trim();
}

function getMetaDescription(): string | null {
  const el =
    (document.querySelector(
      'meta[name="description"]',
    ) as HTMLMetaElement | null) ??
    (document.querySelector(
      'meta[property="og:description"]',
    ) as HTMLMetaElement | null);
  const content = el?.content?.trim();
  return content && content.length > 10 ? content : null;
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
