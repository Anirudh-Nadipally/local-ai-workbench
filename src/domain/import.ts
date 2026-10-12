export type ImportMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};
export function parseConversation(raw: string) {
  if (!raw.trim())
    throw new Error("Paste a conversation or select a text file.");
  if (raw.length > 4_000_000)
    throw new Error("Conversation imports are limited to 4 MB.");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const messages: ImportMessage[] = [];
  const preamble: string[] = [];
  let current: ImportMessage | null = null;
  let fence: { char: string; length: number } | null = null;
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length)
        fence = null;
    }
    const heading =
      !fence && !marker
        ? line.match(
            /^(?:#{1,6}\s+)?(User|You|Human|Question|Assistant|ChatGPT|Claude|Answer|System)(?::\s*(.*)|\s*)$/i,
          )
        : null;
    if (heading) {
      if (current)
        messages.push({ ...current, content: current.content.trim() });
      const label = heading[1].toLowerCase();
      current = {
        role: ["assistant", "chatgpt", "claude", "answer"].includes(label)
          ? "assistant"
          : label === "system"
            ? "system"
            : "user",
        content: heading[2] || "",
      };
    } else if (current) current.content += (current.content ? "\n" : "") + line;
    else preamble.push(line);
  }
  if (current) messages.push({ ...current, content: current.content.trim() });
  return {
    original: raw,
    messages: messages.filter((m) => m.content),
    preamble: preamble.join("\n").trim(),
    ambiguous: messages.length < 2 || !messages.some((m) => m.role === "user"),
  };
}
export function filename(title: string, extension = "md") {
  return (
    (title
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "workbench-export") +
    "." +
    extension
  );
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
