import { describe, expect, it } from "vitest";
import { technicalDetails } from "./feedback";

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
