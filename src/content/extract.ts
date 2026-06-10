import { extractCoreContent } from "./core-content";
import { pickExtractor } from "./site-extractors";
import { ContentChangeWatcher } from "./observers";
import type { PageType, ExtractedContent } from "@/shared/types";
import { extractChatGPTTurns } from "./site-extractors/chatgpt";
import { extractClaudeTurns } from "./site-extractors/claude";
import { extractGeminiTurns } from "./site-extractors/gemini";
import { extractVideoContent } from "./site-extractors/video";
import type {
  ExtractRequest,
  ExtractResponse,
  ReclassifyRequest,
} from "@/shared/messages";
import {
  cleanSearchEngineTitle,
  isSearchEngineHost,
  isAiChatHost,
} from "@/shared/site-detection";

function buildExtracted(): ExtractedContent {
  const host = location.hostname;
  const rawTitle = document.title ?? "";
  const title = isSearchEngineHost(host)
    ? cleanSearchEngineTitle(rawTitle)
    : rawTitle;

  const aiChat = isAiChatHost(host);
  const searchEngine = isSearchEngineHost(host);

  if (aiChat || searchEngine) {
    // Use site-specific extractor — no structural DOM extraction needed
    const extractor = pickExtractor();
    const snippet = safeRun(extractor);
    const pageType: PageType = aiChat ? "ai-chat" : "search";
    const conversationTurns = aiChat ? extractConversationTurns(host) : [];
    const bodyText =
      conversationTurns.length > 0
        ? formatConversationBody(conversationTurns)
        : snippet.slice(0, 16_000);
    return {
      title,
      url: location.href,
      contentSnippet: snippet,
      headings: [],
      pageType,
      extractionSource: "site-extractor",
      extractionConfidence: snippet.length > 100 ? 0.85 : 0.5,
      richContent: {
        summary: snippet.slice(0, 1_800),
        bodyText,
        conversationTurns:
          conversationTurns.length > 0 ? conversationTurns : undefined,
      },
    };
  }

  // Generic page: use core-content for structured extraction
  const core = safeRunCoreContent();
  const pageType = detectPageType(host, location.pathname);
  const video = pageType === "video" ? extractVideoContent() : undefined;
  const description = extractMetaDescription();

  const videoSnippet = video
    ? [video.videoTitle, video.channel, video.description]
        .filter(Boolean)
        .join(" | ")
    : "";
  const snippet = videoSnippet || joinDistinct([description, core.text]);
  const fallbackSnippet = snippet || safeRun(pickExtractor());
  const bodyText =
    pageType === "video"
      ? video?.description ?? fallbackSnippet
      : core.bodyText || fallbackSnippet;

  return {
    title,
    url: location.href,
    contentSnippet: fallbackSnippet.slice(0, 1_800),
    headings: core.headings,
    pageType,
    extractionSource:
      core.confidence >= 0.55 ? "core-content" : "metadata-only",
    extractionConfidence: core.confidence,
    richContent: {
      summary: fallbackSnippet.slice(0, 1_800),
      bodyText: bodyText.slice(0, 16_000),
      sections: core.sections.length > 0 ? core.sections : undefined,
      codeBlocks: core.codeBlocks.length > 0 ? core.codeBlocks : undefined,
      video,
    },
  };
}

function extractConversationTurns(host: string) {
  if (host === "claude.ai" || host.endsWith(".claude.ai"))
    return extractClaudeTurns();
  if (host === "gemini.google.com" || host === "bard.google.com")
    return extractGeminiTurns();
  return extractChatGPTTurns();
}

function formatConversationBody(
  turns: Array<{ role: "user" | "assistant"; text: string }>,
): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n\n")
    .slice(0, 16_000);
}

function extractMetaDescription(): string {
  const selectors = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ];
  for (const selector of selectors) {
    const value = (document.querySelector(selector) as HTMLMetaElement | null)
      ?.content?.replace(/\s+/g, " ")
      .trim();
    if (value) return value;
  }
  return "";
}

function joinDistinct(parts: string[]): string {
  const seen = new Set<string>();
  return parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => {
      const key = part.toLowerCase().slice(0, 160);
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" | ");
}

function safeRun(fn: () => string): string {
  try {
    return fn();
  } catch (err) {
    console.warn("[auto-tab-group] extractor error", err);
    return "";
  }
}

function safeRunCoreContent(): import("./core-content").CoreContentResult {
  try {
    return extractCoreContent();
  } catch (err) {
    console.warn("[auto-tab-group] core-content extraction failed", err);
    return {
      text: "",
      bodyText: "",
      headings: [],
      sections: [],
      codeBlocks: [],
      confidence: 0,
      source: "fallback",
    };
  }
}

function detectPageType(host: string, path: string): PageType {
  if (/github\.com/.test(host)) {
    if (/\/(issues|pull|discussions)/.test(path)) return "code";
    return "documentation";
  }
  if (/docs\.|developer\.|wiki\.|confluence|notion\.so/.test(host))
    return "documentation";
  if (/youtube\.com|vimeo\.com|twitch\.tv/.test(host)) return "video";
  if (
    /twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com/.test(host)
  )
    return "social";
  if (/mail\.google|outlook\.live|outlook\.office/.test(host)) return "mail";
  return "article";
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
  chrome.runtime
    .sendMessage(msg)
    .catch((err) =>
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
