import { pickExtractor } from "./site-extractors";
import { ContentChangeWatcher } from "./observers";
import type { ExtractedContent } from "@/shared/types";
import type {
  ExtractRequest,
  ExtractResponse,
  ReclassifyRequest,
} from "@/shared/messages";
import {
  cleanSearchEngineTitle,
  isSearchEngineHost,
} from "@/shared/site-detection";

function buildExtracted(): ExtractedContent {
  const extractor = pickExtractor();
  const snippet = safeRun(extractor);
  const rawTitle = document.title ?? "";
  const title = isSearchEngineHost(location.hostname)
    ? cleanSearchEngineTitle(rawTitle)
    : rawTitle;
  return {
    title,
    url: location.href,
    contentSnippet: snippet,
  };
}

function safeRun(fn: () => string): string {
  try {
    return fn();
  } catch (err) {
    console.warn("[auto-tab-group] extractor error", err);
    return "";
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtractRequest, _sender, sendResponse) => {
    if (message?.type === "EXTRACT") {
      const payload = buildExtracted();
      const response: ExtractResponse = { type: "EXTRACT_RESULT", payload };
      sendResponse(response);
      return true;
    }
    return undefined;
  },
);

const watcher = new ContentChangeWatcher(() => {
  const payload = buildExtracted();
  const msg: ReclassifyRequest = { type: "RECLASSIFY", payload };
  watcher.noteSignaled(document.body?.innerText?.length ?? 0);
  chrome.runtime.sendMessage(msg).catch((err) =>
    console.warn("[auto-tab-group] reclassify send failed", err),
  );
});

function start(): void {
  watcher.start(document.body?.innerText?.length ?? 0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
