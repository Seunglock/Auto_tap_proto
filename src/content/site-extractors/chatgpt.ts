import type { ConversationTurn } from "@/shared/types";

export function extractChatGPTTurns(): ConversationTurn[] {
  return Array.from(document.querySelectorAll("[data-message-author-role]"))
    .map((node) => ({
      role:
        node.getAttribute("data-message-author-role") === "user"
          ? ("user" as const)
          : ("assistant" as const),
      text: (node as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((turn) => turn.text.length >= 4)
    .slice(-8);
}

export function extractChatGPT(): string {
  const collected = extractChatGPTTurns().map((turn) => turn.text);
  if (collected.length === 0) {
    const main = document.querySelector("main");
    if (main) collected.push((main as HTMLElement).innerText.trim());
  }
  return collected.slice(-6).join(" | ").slice(0, 1500).replace(/\s+/g, " ").trim();
}
