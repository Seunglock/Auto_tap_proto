import type { ExtractedContent } from "@/shared/types";

export async function requestExtract(
  tabId: number,
): Promise<ExtractedContent | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT" });
    if (response && response.type === "EXTRACT_RESULT") {
      return response.payload as ExtractedContent;
    }
    return null;
  } catch (err) {
    console.warn("[auto-tab-group] extract request failed", err);
    return null;
  }
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
