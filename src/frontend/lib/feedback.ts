// The feedback form: what it may send along, and the limits it shares with the server.

import { activeTab } from "./nav";
import { parseStep } from "./steps";

/** Longest feedback message, in characters; the server applies the same limit. */
export const MAX_MESSAGE = 4000;
/** Longest issue title the sender may type, in characters. */
export const MAX_TITLE = 80;
/** Longest automatic summary in an issue title, in characters. */
const MAX_SUMMARY = 50;
/** Longest contact text, in characters; the server applies the same limit. */
export const MAX_CONTACT = 200;

/** GitHub refuses longer addresses; the message is shortened to fit (the sender sees the result). */
export const MAX_ISSUE_URL = 7500;
const ISSUE_KIND: Record<string, string> = { bug: "Bug", idea: "Idea", other: "Feedback" };

/** The first sentence of a message (ends at . ! ? or a line break), cut at a word boundary with "…". */
function summary(message: string): string {
  const first = message.trim().split(/(?<=[.!?])\s|\n/, 1)[0].trim().replace(/[.!?]+$/, "");
  if (first.length <= MAX_SUMMARY) return first;
  const cut = first.slice(0, MAX_SUMMARY - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The title of the issue: the kind, then the sender's title, or a short summary of the message. */
export function issueTitle(kind: string, message: string, title = ""): string {
  const text = title.trim().slice(0, MAX_TITLE) || summary(message);
  return `${ISSUE_KIND[kind] ?? "Feedback"}: ${text}`;
}

/**
 * The address of a new issue on GitHub, filled in from the form: the issue form
 * `.github/ISSUE_TEMPLATE/feedback.yml` (which sets the label `feedback`), a title (typed, or
 * the kind and a short summary of the message), the message and the technical details. For a
 * server without mail, the desktop app above all, where a message kept on the server would reach nobody.
 */
export function issueUrl(
  repo: string,
  input: { kind: string; title?: string; message: string; details: Record<string, string> | null },
): string {
  const lines = input.details ? Object.entries(input.details).map(([key, value]) => `${key}: ${value}`).join("\n") : "";
  const build = (message: string) => {
    const title = issueTitle(input.kind, input.message, input.title);
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
