import type { CSSProperties } from "react";
import { TOAST_MS, dismissToast, rememberWhy, undoLast, useScan, type Toast as ToastData, type ToastTone } from "../../lib/scan-store";
import { ToastErrorIcon, ToastInfoIcon, ToastSuccessIcon, ToastWarningIcon, UndoIcon } from "../icons";
import { copy } from "../../copy";
import { Kbd } from "../Kbd";
import { RuleChoices } from "./RuleChoices";

// Each tone has its own icon shape, so the meaning doesn't rest on colour
// alone. The colour goes on the icon and timer bar. The message stays in the
// normal text colour.
const TONES: Record<ToastTone, { Icon: () => React.ReactNode; icon: string; bar: string }> = {
  error: { Icon: ToastErrorIcon, icon: "text-danger", bar: "bg-danger" },
  warning: { Icon: ToastWarningIcon, icon: "text-amber", bar: "bg-amber" },
  success: { Icon: ToastSuccessIcon, icon: "text-positive", bar: "bg-positive" },
  info: { Icon: ToastInfoIcon, icon: "text-info", bar: "bg-info" },
};

/** The toast the app is showing, if any. A new one replaces the old one at once. */
export function Toast() {
  const { toast } = useScan();
  if (!toast) return null;
  return <ToastCard key={toast.id} toast={toast} className="absolute bottom-[88px] left-1/2 z-20 -translate-x-1/2" />;
}

// The result of an action, shown for 5 seconds. The thin bar shows the time
// left (it doesn't move when reduced motion is on). The fade happens inside
// those 5 seconds, so Undo, ⌘Z and keys 1-3 work until it has gone. After
// "Not a leak" it also asks why, on a second line. Ignoring the question is fine.
export function ToastCard({ toast, className }: { toast: ToastData; className: string }) {
  const { ask } = toast;
  const tone = TONES[toast.tone];
  return (
    <div
      role="status"
      style={{ "--toast-ms": `${TOAST_MS}ms` } as CSSProperties}
      className={`toast-in flex w-max max-w-[560px] flex-col gap-1 overflow-hidden rounded-lg border border-hairline bg-raised py-2 pr-2 pl-3.5 shadow-(--shadow-toast) ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2 text-small text-text">
          <span className={`mt-[3px] shrink-0 ${tone.icon}`}>
            <tone.Icon />
          </span>
          <span>{toast.text}</span>
        </span>
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
        <div className="flex items-center gap-2 pb-0.5 pl-5.5">
          <span className="shrink-0 text-meta text-muted">{copy.rules.question}</span>
          <RuleChoices onChoose={(reason) => rememberWhy(ask, reason)} />
        </div>
      )}
      <span aria-hidden="true" className={`toast-timer absolute bottom-0 left-0 h-0.5 w-full origin-left ${tone.bar}`} />
    </div>
  );
}
