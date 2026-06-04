const SEARCH_ENGINE_HOSTS = [
  /^(www\.)?google\.[a-z.]+$/,
  /^search\.naver\.com$/,
  /^search\.daum\.net$/,
  /^(www\.)?bing\.com$/,
  /^(www\.)?duckduckgo\.com$/,
  /^(www\.)?baidu\.com$/,
  /^(www\.)?yandex\.com$/,
  /^(www\.)?ecosia\.org$/,
];

export function isSearchEngineHost(host: string): boolean {
  return SEARCH_ENGINE_HOSTS.some((re) => re.test(host));
}

export function isSearchEngineUrl(url: string): boolean {
  try {
    return isSearchEngineHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

const SEARCH_TITLE_SUFFIXES = [
  /\s*-\s*google\s*검색\s*$/i,
  /\s*-\s*google\s*search\s*$/i,
  /\s*:\s*네이버\s*통합검색\s*$/,
  /\s*-\s*daum\s*검색\s*$/i,
  /\s*-\s*bing\s*$/i,
  /\s+at\s+duckduckgo\s*$/i,
  /\s*-\s*ecosia\s*$/i,
];

export function cleanSearchEngineTitle(title: string): string {
  let out = title ?? "";
  for (const re of SEARCH_TITLE_SUFFIXES) {
    out = out.replace(re, "");
  }
  return out.trim();
}

const AI_CHAT_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "bard.google.com",
];

export function isAiChatHost(host: string): boolean {
  return AI_CHAT_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export function isAiChatUrl(url: string): boolean {
  try {
    return isAiChatHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
