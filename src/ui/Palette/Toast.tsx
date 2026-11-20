import { TOAST_MS, dismissToast, undoLast, useScan } from "../../lib/scan-store";
import { UndoIcon } from "../icons";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";

// The result of an action, with Undo for 10 seconds. The thin bar shows the
// time left (it doesn't move when reduced motion is on).
export function Toast() {
  const { toast } = useScan();
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={`toast-in absolute bottom-[88px] left-1/2 z-20 flex w-max max-w-[560px] -translate-x-1/2 items-center gap-3 overflow-hidden rounded-lg border border-hairline bg-raised py-2 pr-2 pl-3.5 shadow-[0_8px_24px_rgb(0_0_0/0.35)]`}
    >
      <span className="text-[12.5px]">{toast.text}</span>
      {toast.undoable ? (
        <button
          type="button"
          onClick={() => void undoLast()}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-amber hover:bg-hairline"
        >
          <UndoIcon />
          {copy.toasts.undo} <Kbd keys={["⌘", "Z"]} />
        </button>
      ) : (
        <button type="button" onClick={dismissToast} aria-label={copy.toasts.dismiss} className="px-1.5 text-faint hover:text-muted">
          ×
        </button>
      )}
      {toast.undoable && (
        <span
          aria-hidden="true"
          className="toast-timer absolute bottom-0 left-0 h-px w-full origin-left bg-amber/60"
          style={{ animationDuration: `${TOAST_MS}ms` }}
        />
      )}
    </div>
  );
}
