import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { Sheet } from "../layers";

// The backup teacher: every key in one place. The primary teacher is the
// inline hints on screen.
const GROUPS = copy.shortcuts.groups;

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy.shortcuts.label}
      // ? opens it, and ? closes it again (Esc too).
      onKeyDown={(e) => {
        if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        onClose();
      }}
      className="w-[520px] rounded-xl border border-hairline bg-surface p-5 shadow-(--shadow-sheet)"
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
    </Sheet>
  );
}
