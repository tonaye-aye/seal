// The icons buttons show in mouse mode (in keyboard mode the key caps show
// instead). From lucide-react (ISC licence), all at one size and weight so
// they read as a set. The list and timeline icons at the end are hand-drawn
// for the View button (src/ui/Palette/Controls.tsx).

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  CircleCheck,
  CircleX,
  Columns2,
  CreditCard,
  EyeOff,
  FileText,
  Image,
  Info,
  Keyboard,
  Mail,
  Paperclip,
  Quote,
  Send,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  ScanSearch,
  TriangleAlert,
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
export const ToastErrorIcon = icon(CircleX);
export const ToastWarningIcon = icon(TriangleAlert);
export const ToastSuccessIcon = icon(CircleCheck);
export const ToastInfoIcon = icon(Info);
export const RemindIcon = icon(Bell);
export const RemoveReminderIcon = icon(BellOff);
export const DismissIcon = icon(Ban);
export const EditIcon = icon(Pencil);
export const OpenIcon = icon(ArrowUpRight);
export const PaneIcon = icon(Columns2);
export const TraceIcon = icon(Activity);
/** The sidebar's collapse icon, hand-drawn so its little panel slides with the real one (.sidebar-glyph in tokens.css). */
export function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" data-open={open} className="sidebar-glyph block">
      <rect className="sidebar-glyph-pane" x="10" y="2.5" width="3.75" height="11" fill="currentColor" />
      <path className="sidebar-glyph-line" d="M10 2.5v11" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2.25" y="2.5" width="11.5" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
export const KeysIcon = icon(Keyboard);
export const HideIcon = icon(EyeOff);
export const CloseIcon = icon(X);
/** The draft's Details: To (a paper plane), Subject (a quote) and Attach (a paper clip). */
export const ToIcon = icon(Send);
export const SubjectIcon = icon(Quote);
export const AttachIcon = icon(Paperclip);
export const UndoIcon = icon(Undo2);
export const NextIcon = icon(ArrowRight);
export const PlugIcon = icon(Plug);
export const ConnectIcon = icon(Plus);
export const CheckNowIcon = icon(ScanSearch);
export const ResetIcon = icon(RotateCcw);

// Where a piece of evidence came from, for the open finding's sidebar.
export const BankIcon = icon(CreditCard);
export const EmailIcon = icon(Mail);
export const DocumentIcon = icon(FileText);
export const PhotoIcon = icon(Image);
export const CalendarIcon = icon(CalendarDays);

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
