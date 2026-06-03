export function extractChatGPT(): string {
  const collected: string[] = [];
  const nodes = document.querySelectorAll("[data-message-author-role]");
  for (const node of Array.from(nodes)) {
    const text = (node as HTMLElement).innerText?.trim();
    if (text && text.length >= 4) collected.push(text);
  }
  if (collected.length === 0) {
    const main = document.querySelector("main");
    if (main) collected.push((main as HTMLElement).innerText.trim());
  }
  return collected.slice(-6).join(" | ").slice(0, 1500).replace(/\s+/g, " ").trim();
}
