// Which way of fixing a finding Maya has chosen, and the words that route
// needs. Plain code over the finding's fix plan: no model, nothing sent.

import type { Finding } from "../agent/pipeline.ts";
import type { Escalation, FixRoute, RouteKind } from "../agent/routes.ts";
import { copy } from "../copy.ts";

type Choices = { routes: Record<string, string>; decisions: Record<string, Finding["status"]> };
type WithPlan = Pick<Finding, "id" | "fix" | "draft">;

/**
 * The route in use: the one Maya picked, else the recommended one. An approval
 * from before routes existed saved an email draft, so it stays on Email.
 * Undefined when the finding has no fix plan.
 */
export function chosenRoute(finding: WithPlan, s: Choices): FixRoute | undefined {
  const plan = finding.fix;
  if (!plan) return undefined;
  const picked = plan.routes.find((r) => r.id === s.routes[finding.id]);
  if (picked) return picked;
  if (s.decisions[finding.id] === "approved" && finding.draft) {
    const email = plan.routes.find((r) => r.kind === "email");
    if (email) return email;
  }
  return plan.routes.find((r) => r.id === plan.recommendedId) ?? plan.routes[0];
}

/** True when approving saves the email draft (the Email route, or a finding with no routes). */
export function usesEmail(finding: WithPlan, s: Choices): boolean {
  const route = chosenRoute(finding, s);
  return !route || route.kind === "email";
}

/** Firmer and Shorter show on an email draft that's still waiting for Maya. */
export function showsVerbs(finding: WithPlan & Pick<Finding, "status">, s: Choices): boolean {
  return finding.status === "new" && !!finding.draft && usesEmail(finding, s);
}

/** What an approved finding is waiting on when it isn't an email: "Ready to call". */
export function readyLabel(finding: WithPlan, s: Choices): string | undefined {
  const route = chosenRoute(finding, s);
  return route && route.kind !== "email" ? copy.routes.ready[route.kind] : undefined;
}

/** The checked figures, one per line, for pasting into a form. */
function figureLines(finding: Pick<Finding, "fix">): string {
  return (finding.fix?.haveReady ?? []).map((f) => `${f.label}: ${f.value}`).join("\n");
}

/** What Y copies for this route, or undefined when it has nothing prepared. */
export function routeText(finding: Pick<Finding, "fix" | "draft">, route: FixRoute): string | undefined {
  const plan = finding.fix;
  if (route.kind === "email") return finding.draft && `${copy.detail.subject}: ${finding.draft.subject}\n\n${finding.draft.body}`;
  if (route.kind === "chat") return plan?.chatOpener;
  if (route.kind === "online") return figureLines(finding) || undefined;
  const script = plan?.callScript;
  if (!script) return figureLines(finding) || undefined;
  return [script.opening, script.points.map((p) => `- ${p}`).join("\n"), script.ask, `${copy.routes.ifNo}: ${script.ifNo}`].filter(Boolean).join("\n\n");
}

/** A labelled stand-in for a fictional business's page or phone line. */
export type SamplePage = {
  title: string;
  provider: string;
  /** The number or web address, shown but never dialled or opened. */
  contact?: string;
  hours?: string;
  kind: RouteKind | "body";
  steps: string[];
  article?: { title: string; body: string };
  note?: string;
};

const shortLink = (href: string) => href.replace(/^https?:\/\//, "");

export function routePage(route: FixRoute): SamplePage {
  return {
    title: route.label,
    provider: route.provider,
    contact: route.phone ?? (route.href ? shortLink(route.href) : route.address),
    hours: route.hours,
    kind: route.kind,
    steps: route.steps,
    article: route.article,
    note: route.note,
  };
}

export function escalationPage(body: Escalation): SamplePage {
  return { title: body.name, provider: body.shortName, contact: shortLink(body.href), hours: body.hours, kind: "body", steps: [], note: body.whenToUse };
}
