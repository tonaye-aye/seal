import { useRef } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronRight, Copy, Globe, Mail, MessageCircle, Phone } from "lucide-react";
import type { Finding } from "../../agent/pipeline";
import type { FixRoute, RouteKind } from "../../agent/routes";
import { copy } from "../../copy";
import { routeText, type SamplePage } from "../fix-route";
import { Kbd, KeyButton } from "../Kbd";
import { Sheet, SheetTitle, Tip } from "../layers";

// The ways to fix a finding: which one is best and why, a switcher (keys 1-4),
// and what the chosen route needs prepared. Email keeps the existing draft; this
// draws Call, Chat and Online. Every contact comes from the help directory and
// is a sample: it's shown, never dialled or opened.

const KIND_ICON: Record<RouteKind, typeof Mail> = { email: Mail, call: Phone, chat: MessageCircle, online: Globe };

/** A fold's heading line in an open finding: the sidebar's panels, "Drafted email" and Have Ready. */
export const FOLD_LINE = "row-press relative flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-meta";

export function CopyIcon() {
  return <Copy size={14} strokeWidth={1.75} aria-hidden="true" />;
}

/** Marks a number or link as belonging to a fictional business. */
export function SampleChip() {
  return (
    <Tip content={copy.routes.sampleTip}>
      <span className="inline-flex h-4.5 shrink-0 items-center rounded-full border border-hairline px-1.5 text-label text-faint">{copy.routes.sample}</span>
    </Tip>
  );
}

/** "Best way", why, then one tab per route. */
export function RouteChooser({
  finding,
  route,
  mouse,
  onPick,
}: {
  finding: Finding;
  route: FixRoute;
  mouse: boolean;
  onPick: (index: number) => void;
}) {
  const plan = finding.fix!;
  const best = plan.routes.find((r) => r.id === plan.recommendedId) ?? plan.routes[0];
  return (
    <div className="mb-4">
      <p className="mb-2.5 text-small">
        <span className="mr-2 label text-faint">{copy.routes.best}</span>
        <span className="font-medium text-text">{best.label}.</span> <span className="text-muted">{plan.reason}</span>
      </p>
      <div role="tablist" aria-label={copy.routes.label} className="flex min-w-0 gap-1">
        {plan.routes.map((r, i) => {
          const Icon = KIND_ICON[r.kind];
          const selected = r.id === route.id;
          return (
            <Tip key={r.id} content={copy.routes.tip(r.provider, r.label)} keys={[String(i + 1)]} side="bottom">
              <button
                type="button"
                role="tab"
                tabIndex={-1}
                aria-selected={selected}
                // Keep keyboard focus on the palette, which owns the keys.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(i)}
                className={`press flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-meta transition-colors duration-(--duration-fast) ${
                  selected ? "bg-raised text-text shadow-[0_0_0_1px_var(--color-hairline)]" : "text-muted hover:bg-raised/60 hover:text-text"
                }`}
              >
                {/* Same width either way, so the tabs don't move when the mouse takes over. */}
                <span className="grid w-[18px] shrink-0 place-items-center">{mouse ? <Icon size={14} strokeWidth={1.75} aria-hidden="true" /> : <Kbd keys={[String(i + 1)]} />}</span>
                <span className="truncate">{r.label}</span>
              </button>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

function Part({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="mb-1.5 flex h-6 items-center justify-between gap-3">
        <h3 className="label text-faint">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const BOX = "rounded-lg bg-raised/60 px-3 py-2.5 text-small leading-5.5";

/** The number or link, marked as a sample, then when they answer. */
function Contact({ route, reason, onSample }: { route: FixRoute; reason?: string; onSample: () => void }) {
  const link = route.href?.replace(/^https?:\/\//, "");
  const facts = [
    route.hours,
    route.waitMinutes !== undefined ? copy.routes.wait(route.waitMinutes) : undefined,
    route.replyDays !== undefined ? copy.routes.replies(route.replyDays) : undefined,
  ].filter(Boolean);
  return (
    <div className="mb-4">
      <div className="flex min-w-0 items-center gap-2">
        {route.phone && <span className="figure text-body text-text">{route.phone}</span>}
        {link && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSample}
            className="press min-w-0 cursor-pointer truncate text-small text-text underline decoration-hairline underline-offset-3 hover:decoration-muted"
          >
            {link}
          </button>
        )}
        <SampleChip />
      </div>
      {facts.length > 0 && <p className="mt-0.5 text-meta text-faint">{facts.join(" · ")}</p>}
      {/* The best way's reason can be this same note: don't say it twice. */}
      {route.note && route.note !== reason && <p className="mt-1 text-meta text-muted">{route.note}</p>}
    </div>
  );
}

/** Whether this route has anything to put under Have Ready. */
export function hasHaveReady(finding: Finding, route: FixRoute | undefined): boolean {
  return !!route && route.kind !== "email" && (route.needs.length > 0 || (finding.fix?.haveReady.length ?? 0) > 0);
}

const HAVE_READY = "have-ready";

/**
 * What to have in front of you: what the business will ask for, then figures
 * code checked. Folded to start, so the script or steps come first. Enter or
 * Space on the draft side opens it, or a click. Drawn like "Drafted email".
 */
function HaveReady({ finding, route, open, onToggle }: { finding: Finding; route: FixRoute; open: boolean; onToggle: () => void }) {
  if (!hasHaveReady(finding, route)) return null;
  const figures = finding.fix?.haveReady ?? [];
  return (
    <Accordion.Root type="single" collapsible value={open ? HAVE_READY : ""} onValueChange={onToggle}>
      <Accordion.Item value={HAVE_READY}>
        <Accordion.Trigger asChild>
          <div className={`${FOLD_LINE} -mx-2 w-fit text-muted hover:text-text`}>
            <span className={`label ${open ? "text-muted" : "text-faint"}`}>{copy.routes.haveReady}</span>
            <ChevronRight size={12} strokeWidth={2} aria-hidden="true" className="accordion-chevron shrink-0 text-faint" />
          </div>
        </Accordion.Trigger>
        <Accordion.Content className="accordion-content">
          <div className="pt-0.5 pb-1">
            {route.needs.length > 0 && (
              <ul className="mb-1.5 list-disc pl-4 text-meta text-muted">
                {route.needs.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-meta">
              {figures.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="truncate text-muted">{f.label}</dt>
                  <dd className="figure text-right text-text">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}

/** A call, chat or online route, with what it needs prepared. */
export function RoutePanel({
  finding,
  route,
  mouse,
  readyOpen = false,
  onToggleReady = () => {},
  onCopy,
  onSample,
}: {
  finding: Finding;
  route: FixRoute;
  mouse: boolean;
  /** Have Ready is unfolded (closed to start). */
  readyOpen?: boolean;
  onToggleReady?: () => void;
  /** Y: copy the script, opener or figures. */
  onCopy: () => void;
  /** Show the labelled stand-in for this business's page. */
  onSample: () => void;
}) {
  const plan = finding.fix!;
  const copyButton = routeText(finding, route) ? <KeyButton keys={["Y"]} label={copy.routes.copy} icon={<CopyIcon />} tone="muted" mouse={mouse} onClick={onCopy} /> : undefined;
  // The model's words only appear on a call or chat, so only those can need checking.
  const wrote = route.kind === "call" ? !!plan.callScript : route.kind === "chat" ? !!plan.chatOpener : false;
  return (
    <div>
      <Contact route={route} reason={finding.status === "new" ? plan.reason : undefined} onSample={onSample} />
      {wrote && !plan.grounded && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/8 px-2.5 py-2 text-meta">
          <p className="font-semibold text-danger">{copy.routes.checkFirst}</p>
          <ul className="mt-0.5 list-disc pl-4 text-muted">
            {plan.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {route.kind === "call" &&
        (plan.callScript ? (
          <>
            <Part title={copy.routes.sayThis} action={copyButton}>
              <div className={BOX}>
                <p>{plan.callScript.opening}</p>
                <ul className="my-1.5 list-disc pl-4 text-muted">
                  {plan.callScript.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p>
                  <span className="mr-1.5 label text-faint">{copy.routes.ask}</span>
                  <span className="font-medium">{plan.callScript.ask}</span>
                </p>
              </div>
            </Part>
            <Part title={copy.routes.ifNo}>
              <p className="text-small text-muted">{plan.callScript.ifNo}</p>
            </Part>
          </>
        ) : (
          <p className="text-small text-muted">{copy.routes.noScript}</p>
        ))}
      {route.kind === "chat" &&
        (plan.chatOpener ? (
          <Part title={copy.routes.pasteThis} action={copyButton}>
            <p className={BOX}>{plan.chatOpener}</p>
          </Part>
        ) : (
          <p className="text-small text-muted">{copy.routes.noOpener}</p>
        ))}
      {route.kind === "online" && route.steps.length > 0 && (
        <Part title={copy.routes.steps} action={copyButton}>
          <ol className="flex flex-col gap-1.5 text-small">
            {route.steps.map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="figure w-4 shrink-0 text-right text-faint">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Part>
      )}
      <div className="mt-4">
        <HaveReady finding={finding} route={route} open={readyOpen} onToggle={onToggleReady} />
      </div>
    </div>
  );
}

/** The stand-in for a fictional business's page or phone line. Nothing here dials or opens anything. */
export function SamplePageSheet({ page, onClose }: { page?: SamplePage; onClose: () => void }) {
  // Keeps its words while the sheet fades out.
  const last = useRef(page);
  if (page) last.current = page;
  const shown = last.current;
  return (
    <Sheet open={!!page} onClose={onClose} className="max-h-[80%] w-[460px] overflow-y-auto rounded-xl border border-hairline bg-surface p-5 shadow-(--shadow-sheet)">
      {shown && (
        <>
          <span className="label text-faint">{copy.routes.samplePage.title}</span>
          <SheetTitle className="mt-1 heading text-title font-semibold">{shown.title}</SheetTitle>
          <p className="mt-1 text-meta text-muted">{copy.routes.samplePage.why(shown.provider)}</p>
          <dl className="mt-4 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-meta">
            {shown.contact && (
              <>
                <dt className="text-faint">{copy.routes.samplePage.contact}</dt>
                <dd className="figure break-all text-text">{shown.contact}</dd>
              </>
            )}
            {shown.hours && (
              <>
                <dt className="text-faint">{copy.routes.samplePage.hours}</dt>
                <dd className="text-text">{shown.hours}</dd>
              </>
            )}
          </dl>
          {shown.note && <p className="mt-3 text-small text-muted">{shown.note}</p>}
          {shown.steps.length > 0 && (
            <ol className="mt-3 flex flex-col gap-1.5 text-small">
              {shown.steps.map((step, i) => (
                <li key={step} className="flex gap-2.5">
                  <span className="figure w-4 shrink-0 text-right text-faint">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {shown.article && (
            <div className={`mt-3 ${BOX}`}>
              <p className="font-medium">{shown.article.title}</p>
              <p className="mt-0.5 text-muted">{shown.article.body}</p>
            </div>
          )}
          <footer className="mt-4 flex justify-end text-meta">
            <KeyButton keys={["Esc"]} label={copy.routes.samplePage.close} tone="muted" onClick={onClose} />
          </footer>
        </>
      )}
    </Sheet>
  );
}
