// Placeholder mark: a ring with a centre point, the same shape as the menu
// bar icon. Swapped out when the real name and mark are chosen.

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
    </svg>
  );
}
