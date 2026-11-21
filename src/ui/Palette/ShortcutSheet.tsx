import { copy } from "../../copy";
import { ApproveIcon, KeysIcon } from "../icons";
import { Kbd, KeyButton } from "../Kbd";
import { Sheet, SheetDescription, SheetTitle } from "../layers";

// The backup teacher: every key in one place. The primary teacher is the
// inline hints on screen.
const GROUPS = copy.shortcuts.groups;
const INTRO = copy.shortcuts.intro;

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

/**
 * The short version, shown once as onboarding ends: the handful of keys that
 * get you through the findings, with a way to the full sheet.
 */
export function ShortcutIntro({
  open,
  mouse,
  onClose,
  onAll,
}: {
  open: boolean;
  mouse: boolean;
  onClose: () => void;
  /** Swaps this for the full sheet. */
  onAll: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onClose();
        } else if (e.key === "?") {
          e.preventDefault();
          onAll();
        }
      }}
      className="w-[380px] rounded-xl border border-hairline bg-surface p-5 shadow-(--shadow-sheet)"
    >
      <SheetTitle className="heading text-title font-semibold">{INTRO.title}</SheetTitle>
      <SheetDescription className="mt-0.5 text-meta text-muted">{INTRO.body}</SheetDescription>
      <ul className="mt-4 flex flex-col gap-2">
        {INTRO.keys.map(([keys, label]) => (
          <li key={label} className="flex items-center justify-between gap-3 text-small text-muted">
            {label}
            <Kbd keys={keys} />
          </li>
        ))}
      </ul>
      <footer className="mt-5 flex items-center justify-between gap-3 text-meta">
        <KeyButton keys={["?"]} label={INTRO.all} icon={<KeysIcon />} mouse={mouse} onClick={onAll} />
        <KeyButton keys={["↵"]} label={INTRO.gotIt} icon={<ApproveIcon />} tone="primary" mouse={mouse} onClick={onClose} />
      </footer>
    </Sheet>
  );
}
