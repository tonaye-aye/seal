import { Kbd } from "../Kbd";

// The backup teacher: every key in one place. The primary teacher is the
// inline hints on screen.
const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Findings",
    keys: [
      [["J"], "Next"],
      [["K"], "Previous"],
      [["↵"], "Open evidence and draft"],
      [["A"], "Approve: save the draft to Drafts"],
      [["E"], "Edit the draft"],
      [["S"], "Snooze"],
      [["D"], "Not a leak"],
      [["⌘", "Z"], "Undo"],
    ],
  },
  {
    title: "Everywhere",
    keys: [
      [["/"], "Search findings"],
      [["Tab"], "Switch pane (in a finding)"],
      [["T"], "Show what the agent did"],
      [["R"], "Check again (reconnects first)"],
      [["Esc"], "Back, then close"],
      [["?"], "This sheet"],
    ],
  },
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-bg/70 backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="sheet-in w-[520px] rounded-xl border border-hairline bg-surface p-5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-6">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h2 className="mb-2.5 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">{g.title}</h2>
              <ul className="flex flex-col gap-2">
                {g.keys.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
                    {label}
                    <Kbd keys={keys} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11.5px] text-faint">Nothing is ever sent. Approving saves a draft you send yourself.</p>
      </section>
    </div>
  );
}
