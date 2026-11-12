// Unit tests for feedback.ts.

import { describe, expect, it } from "vitest";
import { MAX_ISSUE_URL, issueUrl, technicalDetails } from "./feedback";

const base = { search: "", language: "de", userAgent: "UA/1.0", errorCode: null };

describe("technicalDetails", () => {
  it("names the page, language and browser, and nothing else", () => {
    expect(technicalDetails({ ...base, pathname: "/settings" })).toEqual({
      route: "/settings",
      language: "de",
      user_agent: "UA/1.0",
    });
  });

  it("takes the step from the address, and the data step where an analysis has none", () => {
    expect(technicalDetails({ ...base, pathname: "/", search: "?step=loadings" }).step).toBe("loadings");
    expect(technicalDetails({ ...base, pathname: "/log/" }).step).toBe("data");
  });

  it("does not pass on an address parameter that is no step, or the rest of the query", () => {
    const details = technicalDetails({ ...base, pathname: "/", search: "?step=../x&dataset=abc123" });
    expect(details.step).toBe("data");
    expect(JSON.stringify(details)).not.toContain("abc123");
  });

  it("adds the last error code when there is one", () => {
    expect(technicalDetails({ ...base, pathname: "/", errorCode: "xes_invalid" }).error_code).toBe("xes_invalid");
  });
});

describe("issueUrl", () => {
  const repo = "https://github.com/owner/tool/";
  const read = (url: string) => new URL(url).searchParams;

  it("fills in the issue form: title from the kind and the first line, the message, the details", () => {
    const url = issueUrl(repo, { kind: "bug", message: "It crashed\non the loadings", details: { route: "/", step: "loadings" } });
    expect(url.startsWith("https://github.com/owner/tool/issues/new?")).toBe(true);
    const q = read(url);
    expect(q.get("template")).toBe("feedback.yml");
    expect(q.get("title")).toBe("Bug: It crashed");
    expect(q.get("message")).toBe("It crashed\non the loadings");
    expect(q.get("details")).toBe("route: /\nstep: loadings");
  });

  it("leaves the details out when the sender declined them, and shortens a long title", () => {
    const q = read(issueUrl(repo, { kind: "other", message: "x".repeat(80), details: null }));
    expect(q.has("details")).toBe(false);
    expect(q.get("title")).toBe(`Feedback: ${"x".repeat(59)}…`);
  });

  it("shortens a message that would make the address too long for GitHub, and says so", () => {
    const url = issueUrl(repo, { kind: "idea", message: "ä".repeat(4000), details: { route: "/" } });
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(read(url).get("message")!.endsWith("…")).toBe(true);
  });
});
