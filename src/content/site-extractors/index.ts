import { extractClaude } from "./claude";
import { extractChatGPT } from "./chatgpt";
import { extractGemini } from "./gemini";
import { extractGeneric } from "./generic";
import { extractSearchEngine, isSearchEngineHost } from "./search-engine";

type Extractor = () => string;

const SITE_EXTRACTORS: Array<{ test: (host: string) => boolean; fn: Extractor }> = [
  { test: (h) => h === "claude.ai" || h.endsWith(".claude.ai"), fn: extractClaude },
  {
    test: (h) =>
      h === "chat.openai.com" || h === "chatgpt.com" || h.endsWith(".chatgpt.com"),
    fn: extractChatGPT,
  },
  {
    test: (h) => h === "gemini.google.com" || h === "bard.google.com",
    fn: extractGemini,
  },
  { test: isSearchEngineHost, fn: extractSearchEngine },
];

export function pickExtractor(): Extractor {
  const host = location.hostname;
  for (const entry of SITE_EXTRACTORS) {
    if (entry.test(host)) return entry.fn;
  }
  return extractGeneric;
}
