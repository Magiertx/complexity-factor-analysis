// The feedback form: what it may send along, and the limits it shares with the server.

import { activeTab } from "./nav";
import { parseStep } from "./steps";

export const MAX_MESSAGE = 4000;
export const MAX_CONTACT = 200;

/** GitHub refuses longer addresses; the message is shortened to fit (the sender sees the result). */
export const MAX_ISSUE_URL = 7500;
const ISSUE_KIND: Record<string, string> = { bug: "Bug", idea: "Idea", other: "Feedback" };

/**
 * The address of a new issue on GitHub, filled in from the form: the issue form
 * `.github/ISSUE_TEMPLATE/feedback.yml` (which sets the label `feedback`), a title from the kind
 * and the first line of the message, the message and the technical details. For a server without
 * mail, the desktop app above all, where a message kept on the server would reach nobody.
 */
export function issueUrl(
  repo: string,
  input: { kind: string; message: string; details: Record<string, string> | null },
): string {
  const lines = input.details ? Object.entries(input.details).map(([key, value]) => `${key}: ${value}`).join("\n") : "";
  const build = (message: string) => {
    const first = message.split("\n", 1)[0].trim();
    const title = `${ISSUE_KIND[input.kind] ?? "Feedback"}: ${first.length > 60 ? `${first.slice(0, 59)}…` : first}`;
    const query = new URLSearchParams({ template: "feedback.yml", title, message });
    if (lines) query.set("details", lines);
    return `${repo.replace(/\/+$/, "")}/issues/new?${query.toString()}`;
  };
  let message = input.message;
  let url = build(message);
  while (url.length > MAX_ISSUE_URL && message.length > 0) {
    message = message.slice(0, Math.floor(message.length * 0.9));
    url = build(`${message}…`);
  }
  return url;
}

/**
 * What "technical details" are: the page and the step, the language, the browser and the code of
 * the last error. The server adds the version and the commit of the tool. Nothing else goes
 * along, and no content of a dataset.
 */
export function technicalDetails(env: {
  pathname: string;
  search: string;
  language: string;
  userAgent: string;
  errorCode: string | null;
}): Record<string, string> {
  const page = env.pathname.length > 1 ? env.pathname.replace(/\/+$/, "") : env.pathname;
  const tab = activeTab(page);
  // The data step is the default and has no parameter; only the analyses have steps.
  const step = parseStep(new URLSearchParams(env.search).get("step")) ?? (tab === "model" || tab === "log" ? "data" : null);
  const details: Record<string, string> = { route: page, language: env.language, user_agent: env.userAgent };
  if (step) details.step = step;
  if (env.errorCode) details.error_code = env.errorCode;
  return details;
}
