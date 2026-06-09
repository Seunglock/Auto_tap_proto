import type { ConversationTurn } from "@/shared/types";

export function extractGeminiTurns(): ConversationTurn[] {
  return Array.from(
    document.querySelectorAll(
      "user-query, model-response, [data-test-id='conversation-turn']",
    ),
  )
    .map((node) => ({
      role: node.matches("user-query") ? ("user" as const) : ("assistant" as const),
      text: (node as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((turn) => turn.text.length >= 4)
    .slice(-8);
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
