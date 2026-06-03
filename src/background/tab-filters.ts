import {
  INTERNAL_URL_PATTERNS,
  LOCAL_HOST_PATTERNS,
} from "@/shared/constants";

export type FilterReason =
  | "ok"
  | "no-url"
  | "internal-url"
  | "localhost"
  | "incognito"
  | "pinned"
  | "already-grouped";

export function classifyTab(tab: chrome.tabs.Tab): FilterReason {
  if (!tab.url || tab.url.length === 0) return "no-url";
  if (tab.incognito) return "incognito";
  if (tab.pinned) return "pinned";
  if (isInternalUrl(tab.url)) return "internal-url";
  if (isLocalHost(tab.url)) return "localhost";
  if (
    typeof tab.groupId === "number" &&
    tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
  ) {
    return "already-grouped";
  }
  return "ok";
}

export function isInternalUrl(url: string): boolean {
  return INTERNAL_URL_PATTERNS.some((re) => re.test(url));
}

export function isLocalHost(url: string): boolean {
  return LOCAL_HOST_PATTERNS.some((re) => re.test(url));
}

export function shouldClassify(tab: chrome.tabs.Tab): boolean {
  return classifyTab(tab) === "ok";
}
