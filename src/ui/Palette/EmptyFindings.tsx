// What the findings area says before the first check has run. Plain words:
// what will appear here, and that nothing happens without approval.
export function EmptyFindings() {
  return (
    <section
      aria-label="Findings"
      className="flex flex-1 flex-col items-center justify-center px-10 text-center"
    >
      <div className="mb-4 grid size-10 place-items-center rounded-full border border-hairline bg-raised text-faint">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 5.5v4.75l3 1.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <h1 className="text-[17px] font-medium tracking-[-0.015em]">Nothing checked yet</h1>
      <p className="mt-1.5 max-w-[46ch] text-muted">
        Once your accounts are connected, this is where charges that look wrong or unwanted will
        show up, with the evidence gathered and a fix drafted for you to approve.
      </p>
    </section>
  );
}
