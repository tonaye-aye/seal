import { Fragment } from "react";
import { Kbd } from "./Kbd";

// Draws a sentence from src/copy.ts: [J] or [⌘ Z] becomes a key cap (keys
// separated by spaces), and {name} is replaced with `slots.name` (an error
// message, a styled shortcut). Everything else is plain text.

const TOKEN = /\[([^\]]+)\]|\{(\w+)\}/g;

export function KeyText({ text, slots = {} }: { text: string; slots?: Record<string, React.ReactNode> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(match[1] !== undefined ? <Kbd keys={match[1].split(" ")} /> : slots[match[2]]);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
