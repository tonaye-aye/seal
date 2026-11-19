import { KeyHint } from "../Kbd";

// Bottom bar: an honest one-line privacy note and the keys that work right now.
export function Footer({ hotkey }: { hotkey: string[] }) {
  return (
    <footer className="flex h-10 shrink-0 items-center justify-between border-t border-hairline px-4 text-[11.5px]">
      <span className="text-faint">Read-only. Nothing is sent or changed without your approval.</span>
      <div className="flex items-center gap-4">
        <KeyHint keys={["/"]} label="Search" />
        <KeyHint keys={["Esc"]} label="Close" />
        {hotkey.length > 0 && <KeyHint keys={hotkey} label="Toggle" />}
      </div>
    </footer>
  );
}
