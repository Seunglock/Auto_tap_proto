import type { ConversationTurn } from "@/shared/types";

export function extractGeminiTurns(): ConversationTurn[] {
  const directNodes = Array.from(
    document.querySelectorAll("user-query, model-response"),
  );
  const nodes =
    directNodes.length > 0
      ? directNodes
      : Array.from(
          document.querySelectorAll("[data-test-id='conversation-turn']"),
        );
  const turns = nodes
    .map((node) => ({
      role:
        node.matches("user-query") || !!node.querySelector("user-query")
          ? ("user" as const)
          : ("assistant" as const),
      text: cleanConversationText((node as HTMLElement).innerText ?? ""),
    }))
    .filter((turn) => turn.text.length >= 4)
  return dedupeTurns(turns).slice(-16);
}

function dedupeTurns(turns: ConversationTurn[]): ConversationTurn[] {
  const seen = new Set<string>();
  return turns.filter((turn) => {
    const key = `${turn.role}:${turn.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanConversationText(value: string): string {
  return value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractGemini(): string {
  const turns = extractGeminiTurns();
  if (turns.length > 0) {
    return turns.map((turn) => turn.text).join(" | ").slice(0, 1500);
  }
  const selectors = [
    "user-query",
    "model-response",
    "[data-test-id='conversation-turn']",
  ];
  const collected: string[] = [];
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const node of Array.from(nodes)) {
      const text = (node as HTMLElement).innerText?.trim();
      if (text && text.length >= 4) collected.push(text);
    }
  }
  if (collected.length === 0) {
    const main = document.querySelector("main");
    if (main) collected.push((main as HTMLElement).innerText.trim());
  }
  return collected.slice(-6).join(" | ").slice(0, 1500).replace(/\s+/g, " ").trim();
}
