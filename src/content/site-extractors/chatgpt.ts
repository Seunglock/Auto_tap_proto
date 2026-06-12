import type { ConversationTurn } from "@/shared/types";

export function extractChatGPTTurns(): ConversationTurn[] {
  const turns = Array.from(document.querySelectorAll("[data-message-author-role]"))
    .map((node) => ({
      role:
        node.getAttribute("data-message-author-role") === "user"
          ? ("user" as const)
          : ("assistant" as const),
      text: cleanConversationText((node as HTMLElement).innerText ?? ""),
    }))
    .filter((turn) => turn.text.length >= 4)
  return dedupeTurns(turns).slice(-16);
}

function dedupeTurns(turns: ConversationTurn[]): ConversationTurn[] {
  return turns.filter(
    (turn, index) =>
      index === 0 ||
      turn.role !== turns[index - 1].role ||
      turn.text !== turns[index - 1].text,
  );
}

function cleanConversationText(value: string): string {
  return value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractChatGPT(): string {
  const collected = extractChatGPTTurns().map((turn) => turn.text);
  if (collected.length === 0) {
    const main = document.querySelector("main");
    if (main) collected.push((main as HTMLElement).innerText.trim());
  }
  return collected.slice(-6).join(" | ").slice(0, 1500).replace(/\s+/g, " ").trim();
}
