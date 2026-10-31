// The feedback form: what it may send along, and the limits it shares with the server.

import { activeTab } from "./nav";
import { parseStep } from "./steps";

export const MAX_MESSAGE = 4000;
export const MAX_CONTACT = 200;

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
