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
      ?.innerText?.replace(/\s+/g, " ")
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
  const description =
    metaContent([
      'meta[property="og:description"]',
      'meta[name="description"]',
    ]) ??
    textContent([
      "#description-inline-expander",
      "#description",
      '[data-testid="video-description"]',
    ]);

  return {
    videoTitle: videoTitle.slice(0, 300),
    channel: channel?.slice(0, 200),
    description: description?.slice(0, 1200),
  };
}
