import type { VideoContent } from "@/shared/types";

function metaContent(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLMetaElement | null;
    const value = el?.content?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return undefined;
}

function textContent(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = (document.querySelector(selector) as HTMLElement | null)
      ?.innerText?.replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (value) return value;
  }
  return undefined;
}

export function extractVideoContent(): VideoContent {
  const videoTitle =
    metaContent(['meta[property="og:title"]', 'meta[name="title"]']) ??
    textContent(["h1", '[data-testid="video-title"]']) ??
    document.title;
  const channel =
    textContent([
      "ytd-channel-name a",
      "#owner-name a",
      '[data-testid="creator-name"]',
      ".video-owner a",
    ]) ??
    metaContent(['meta[name="author"]', 'meta[property="og:site_name"]']);
  const description = cleanVideoDescription(
    textContent([
      "#description-inline-expander",
      "#description",
      '[data-testid="video-description"]',
    ]) ??
      metaContent([
        'meta[property="og:description"]',
        'meta[name="description"]',
      ]) ??
      "",
  );

  return {
    videoTitle: videoTitle.slice(0, 300),
    channel: channel?.slice(0, 200),
    description: description || undefined,
  };
}

function cleanVideoDescription(value: string): string {
  const noise =
    /(https?:\/\/|www\.|구독|좋아요|알림 설정|문의|협찬|광고|sponsor|subscribe|follow|instagram|twitter|facebook|copyright)/i;
  const timestamp = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/;
  const seen = new Set<string>();
  return value
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const key = line.toLowerCase();
      if (line.length < 15 || noise.test(line) || timestamp.test(line))
        return false;
      if (/^(#[^\s#]+\s*)+$/.test(line) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10)
    .join("\n")
    .slice(0, 1_600);
}
