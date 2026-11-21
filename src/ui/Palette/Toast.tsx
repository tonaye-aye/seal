import { TOAST_MS, dismissToast, rememberWhy, undoLast, useScan } from "../../lib/scan-store";
import { UndoIcon } from "../icons";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { RuleChoices } from "./RuleChoices";

// The result of an action, with Undo for 5 seconds. The thin bar shows the
// time left (it doesn't move when reduced motion is on). After "Not a leak" it
// also asks why, on a second line. Ignoring the question is fine.
export function Toast() {
  const { toast } = useScan();
  if (!toast) return null;
  const { ask } = toast;
  return (
    <div
      key={toast.id}
      role="status"
      className={`toast-in absolute bottom-[88px] left-1/2 z-20 flex w-max max-w-[560px] -translate-x-1/2 flex-col gap-1 overflow-hidden rounded-lg border border-hairline bg-raised py-2 pr-2 pl-3.5 shadow-(--shadow-toast)`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-small">{toast.text}</span>
        {toast.undoable ? (
          <button
            type="button"
            onClick={() => void undoLast()}
            className="press flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-meta text-accent hover:bg-hairline"
          >
            <UndoIcon />
            {copy.toasts.undo} <Kbd keys={["⌘", "Z"]} />
          </button>
        ) : (
          <button type="button" onClick={dismissToast} aria-label={copy.toasts.dismiss} className="press cursor-pointer px-1.5 text-faint hover:text-muted">
            ×
          </button>
        )}
      </div>
      {ask && (
        <div className="flex items-center gap-2 pb-0.5">
          <span className="shrink-0 text-meta text-muted">{copy.rules.question}</span>
          <RuleChoices onChoose={(reason) => rememberWhy(ask, reason)} />
        </div>
      )}
      {toast.undoable && (
        <span
          aria-hidden="true"
          className="toast-timer absolute bottom-0 left-0 h-px w-full origin-left bg-muted/50"
          style={{ animationDuration: `${TOAST_MS}ms` }}
        />
      )}
    </div>
  );
}
