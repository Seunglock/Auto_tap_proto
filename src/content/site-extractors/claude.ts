import type { ConversationTurn } from "@/shared/types";

export function extractClaudeTurns(): ConversationTurn[] {
  const nodes = Array.from(
    document.querySelectorAll(
      '[data-testid="user-message"], [data-testid="message"], main .prose',
    ),
  );
  return nodes
    .map((node) => ({
      role: node.matches('[data-testid="user-message"]')
        ? ("user" as const)
        : ("assistant" as const),
      text: (node as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((turn) => turn.text.length >= 4)
    .slice(-8);
}

export function extractClaude(): string {
  const turns = extractClaudeTurns();
  if (turns.length > 0) {
    return turns.map((turn) => turn.text).join(" | ").slice(0, 1500);
  }
  const messageSelectors = [
    '[data-testid="user-message"]',
    '[data-testid="message"]',
    'div[class*="font-claude-message"]',
    "main .prose",
  ];

  const collected: string[] = [];
  for (const sel of messageSelectors) {
    const nodes = document.querySelectorAll(sel);
    for (const node of Array.from(nodes)) {
      const text = (node as HTMLElement).innerText?.trim();
      if (text && text.length >= 4) collected.push(text);
    }
    if (collected.length > 0) break;
  }

  if (collected.length === 0) {
    const main = document.querySelector("main");
    if (main) collected.push((main as HTMLElement).innerText.trim());
  }

  const recent = collected.slice(-6).join(" | ");
  return recent.slice(0, 1500).replace(/\s+/g, " ").trim();
}
