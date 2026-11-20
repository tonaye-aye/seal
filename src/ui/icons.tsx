// The icons buttons show in mouse mode (in keyboard mode the key caps show
// instead). From lucide-react (ISC licence), all at one size and weight so
// they read as a set. The list and timeline icons at the end are hand-drawn
// for the icon rail (src/ui/Palette/Rail.tsx).

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Check,
  Clock,
  Columns2,
  EyeOff,
  Keyboard,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";

function icon(Icon: LucideIcon) {
  return function ButtonIcon() {
    return <Icon size={14} strokeWidth={1.75} aria-hidden="true" />;
  };
}

export const ApproveIcon = icon(Check);
export const SnoozeIcon = icon(Clock);
export const DismissIcon = icon(Ban);
export const EditIcon = icon(Pencil);
export const OpenIcon = icon(ArrowUpRight);
export const PaneIcon = icon(Columns2);
export const TraceIcon = icon(Activity);
export const KeysIcon = icon(Keyboard);
export const HideIcon = icon(EyeOff);
export const CloseIcon = icon(X);
export const UndoIcon = icon(Undo2);
export const NextIcon = icon(ArrowRight);
export const ConnectIcon = icon(Plus);
export const CheckNowIcon = icon(ScanSearch);
export const ResetIcon = icon(RotateCcw);

/** Three rows with a dot each: the findings list. */
export function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6 4h7M6 8h7M6 12h7" />
      <circle cx="3" cy="4" r="0.7" fill="currentColor" />
      <circle cx="3" cy="8" r="0.7" fill="currentColor" />
      <circle cx="3" cy="12" r="0.7" fill="currentColor" />
    </svg>
  );
}

/**
 * A vertical line with stops, the middle one filled: the timeline and its "now".
 * The line breaks around each stop, so the icon reads the same on any background.
 */
export function TimelineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 1.5v1M4 5.5v.5M4 10v.5M4 13.5v1" />
      <circle cx="4" cy="4" r="1.4" />
      <circle cx="4" cy="8" r="1.8" fill="currentColor" />
      <circle cx="4" cy="12" r="1.4" />
      <path d="M8 4h5.5M8 8h5.5M8 12h3.5" />
    </svg>
  );
}
