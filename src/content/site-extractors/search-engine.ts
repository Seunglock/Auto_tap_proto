import { isSearchEngineHost as isSearchHost } from "@/shared/site-detection";

export function extractSearchEngine(): string {
  const params = new URLSearchParams(location.search);
  const queryKeys = ["q", "query", "wd", "p", "search_query", "qry"];
  let query = "";
  for (const key of queryKeys) {
    const v = params.get(key);
    if (v && v.trim().length > 0) {
      query = v.trim();
      break;
    }
  }

  const parts: string[] = [];
  if (query) parts.push(query, query);

  const titles = collectResultTitles();
  if (titles.length > 0) parts.push(titles.slice(0, 12).join(" / "));
  const snippets = collectResultSnippets();
  if (snippets.length > 0) parts.push(snippets.slice(0, 8).join(" / "));

  if (titles.length === 0 && snippets.length === 0) {
    const main =
      document.querySelector("#search") ??
      document.querySelector("#main") ??
      document.querySelector("main") ??
      document.querySelector('[role="main"]');
    if (main) {
      const text = (main as HTMLElement).innerText?.replace(/\s+/g, " ").trim();
      if (text) parts.push(text.slice(0, 800));
    }
  }

  return parts.join(" | ").replace(/\s+/g, " ").trim();
}

function collectResultSnippets(): string[] {
  const selectors = [
    "#search .VwiC3b",
    "#search [data-sncf]",
    ".b_algo p",
    ".result__snippet",
    '[data-testid="result-snippet"]',
    ".api_txt_lines.dsc_txt",
    ".total_dsc",
  ];
  const seen = new Set<string>();
  const snippets: string[] = [];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      const text = (node as HTMLElement).innerText?.replace(/\s+/g, " ").trim();
      if (!text || text.length < 20 || text.length > 500 || seen.has(text))
        return;
      seen.add(text);
      snippets.push(text);
    });
    if (snippets.length >= 8) break;
  }
  return snippets;
}

function collectResultTitles(): string[] {
  const selectors = [
    "#search h3",
    "#rso h3",
    "#main h3",
    "main h3",
    "h3 a",
    "h3.t",
    'a[data-testid="result-title-a"]',
    'a[data-testid="search-result-title"]',
    "[data-attrid] h3",
    ".g h3",
    ".total_tit",
    ".api_txt_lines",
    ".lst_total .total_tit",
    ".b_algo h2",
    "li.b_algo h2",
    ".result__a",
    ".result__title",
    "h2.result__title",
  ];
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const n of Array.from(nodes)) {
      const txt = (n as HTMLElement).innerText?.replace(/\s+/g, " ").trim();
      if (!txt || txt.length < 2 || txt.length > 200) continue;
      if (seen.has(txt)) continue;
      seen.add(txt);
      titles.push(txt);
    }
    if (titles.length >= 8) break;
  }
  return titles;
}

export function isSearchEngineHost(host: string): boolean {
  return isSearchHost(host);
}
