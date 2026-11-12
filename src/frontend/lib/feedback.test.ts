// Unit tests for feedback.ts.

import { describe, expect, it } from "vitest";
import { MAX_ISSUE_URL, issueTitle, issueUrl, technicalDetails } from "./feedback";

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

  it("fills in the issue form: title from the kind and the first sentence, the message, the details", () => {
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
    expect(q.get("title")).toBe(`Feedback: ${"x".repeat(49)}…`);
    expect(q.get("message")).toBe("x".repeat(80));
  });

  it("takes the typed title for the issue and keeps the whole message in the body", () => {
    const q = read(issueUrl(repo, { kind: "bug", title: "  Crash on upload ", message: "Es stürzt ab. Immer.", details: null }));
    expect(q.get("title")).toBe("Bug: Crash on upload");
    expect(q.get("message")).toBe("Es stürzt ab. Immer.");
  });

  it("shortens a message that would make the address too long for GitHub, and says so", () => {
    const url = issueUrl(repo, { kind: "idea", message: "ä".repeat(4000), details: { route: "/" } });
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(read(url).get("message")!.endsWith("…")).toBe(true);
  });
});

describe("issueTitle", () => {
  it("uses a one-line message as the summary, without its closing full stop", () => {
    expect(issueTitle("idea", "Bitte eine dunkle Karte ergänzen.")).toBe("Idea: Bitte eine dunkle Karte ergänzen");
  });

  it("stops at the first sentence or line", () => {
    expect(issueTitle("bug", "Der Upload hängt! Danach geht nichts mehr. Bitte helfen.")).toBe("Bug: Der Upload hängt");
    expect(issueTitle("bug", "Wieso geht das nicht? Ich weiß es nicht")).toBe("Bug: Wieso geht das nicht");
    expect(issueTitle("other", "Erste Zeile ohne Punkt\nzweite Zeile")).toBe("Feedback: Erste Zeile ohne Punkt");
    // A dot inside a number or a name is no sentence end.
    expect(issueTitle("bug", "Version 1.2 stürzt ab. Immer")).toBe("Bug: Version 1.2 stürzt ab");
  });

  it("cuts a long sentence at a word boundary with an ellipsis, at most 50 characters", () => {
    const title = issueTitle("bug", "Die Ladungen der Faktoren werden im Schritt Eignung nicht angezeigt, obwohl alles gerechnet wurde");
    expect(title).toBe("Bug: Die Ladungen der Faktoren werden im Schritt…");
    expect(title.slice("Bug: ".length).length).toBeLessThanOrEqual(50);
  });

  it("cuts a sentence without spaces hard, and counts umlauts as one character each", () => {
    expect(issueTitle("bug", "ü".repeat(70))).toBe(`Bug: ${"ü".repeat(49)}…`);
  });

  it("prefers the typed title, shortened to 80 characters, and falls back when it is blank", () => {
    expect(issueTitle("idea", "Lange Nachricht. Mit Details.", "Dunkle Karte")).toBe("Idea: Dunkle Karte");
    expect(issueTitle("idea", "x".repeat(200), "ä".repeat(100))).toBe(`Idea: ${"ä".repeat(80)}`);
    expect(issueTitle("idea", "Nur dies", "   ")).toBe("Idea: Nur dies");
  });
});
