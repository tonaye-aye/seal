import { SEAL_GRID, SEAL_PATH } from "../seal-mark";

// Seal's logo in the current text colour. The shape lives in seal-mark.ts.

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${SEAL_GRID} ${SEAL_GRID}`} aria-hidden="true" className="block">
      <path d={SEAL_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
