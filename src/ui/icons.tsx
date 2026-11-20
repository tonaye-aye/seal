// The icons buttons show in mouse mode (in keyboard mode the key caps show
// instead). From lucide-react (ISC licence), all at one size and weight so
// they read as a set next to the hand-drawn list, timeline and back icons.

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
