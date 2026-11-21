import { KeyButton } from "../Kbd";

// The one big button each onboarding step ends on. It is a KeyButton, so it
// shows its key in keyboard mode and its icon in mouse mode like every other
// button. Until the step is done it is locked and neutral.
export function OnboardingCta({
  keys,
  label,
  icon,
  disabled = false,
  mouse,
  onClick,
}: {
  keys: string[];
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  mouse: boolean;
  onClick: () => void;
}) {
  return <KeyButton keys={keys} label={label} icon={icon} tone="primary" size="cta" disabled={disabled} mouse={mouse} onClick={onClick} />;
}
