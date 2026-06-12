import type { ConversationTurn } from "@/shared/types";

export function extractClaudeTurns(): ConversationTurn[] {
  const nodes = Array.from(
    document.querySelectorAll(
      '[data-testid="user-message"], [data-testid="message"], main .prose',
    ),
  );
  const turns = nodes
    .map((node) => ({
      role:
        node.matches('[data-testid="user-message"]') ||
        !!node.closest('[data-testid="user-message"]')
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
