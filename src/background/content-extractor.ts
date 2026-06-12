import type { ExtractedContent } from "@/shared/types";

export async function requestExtract(
  tabId: number,
): Promise<ExtractedContent | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT" });
      if (response && response.type === "EXTRACT_RESULT") {
        const payload = response.payload as ExtractedContent;
        if (payload.contentSnippet || payload.richContent?.bodyText) {
          return payload;
        }
      }
    } catch (err) {
      if (attempt === 2) {
        console.warn("[auto-tab-group] extract request failed", err);
      }
    }
    await delay(350 * (attempt + 1));
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fallbackExtract(
  tab: chrome.tabs.Tab,
): Promise<ExtractedContent> {
  return {
    title: tab.title ?? "",
    url: tab.url ?? "",
    contentSnippet: "",
  };
}
