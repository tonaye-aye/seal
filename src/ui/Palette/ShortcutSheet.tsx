import { copy } from "../../copy";
import { Kbd } from "../Kbd";

// The backup teacher: every key in one place. The primary teacher is the
// inline hints on screen.
const GROUPS = copy.shortcuts.groups;

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-scrim backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-label={copy.shortcuts.label}
        className="sheet-in w-[520px] rounded-xl border border-hairline bg-surface p-5 shadow-(--shadow-sheet)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-6">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h2 className="mb-2.5 label text-faint">{g.title}</h2>
              <ul className="flex flex-col gap-2">
                {g.keys.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-3 text-small text-muted">
                    {label}
                    <Kbd keys={keys} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-meta text-faint">{copy.shortcuts.footnote}</p>
      </section>
    </div>
  );
}
