import { beforeEach, describe, expect, it } from "vitest";
import { forgetLastError, lastErrorCode, noteError } from "./last-error";

describe("last error", () => {
  beforeEach(forgetLastError);

  it("is empty until an error is noted", () => {
    expect(lastErrorCode()).toBeNull();
  });

  it("keeps the code of the latest error", () => {
    noteError(400, "xes_invalid");
    noteError(429, "rate_limited");
    expect(lastErrorCode()).toBe("rate_limited");
  });

  it("names an error without a code after its status", () => {
    noteError(502);
    expect(lastErrorCode()).toBe("http_502");
  });

  it("ignores a request that a newer one replaced", () => {
    noteError(500, "compute_failed");
    noteError(409, "superseded");
    expect(lastErrorCode()).toBe("compute_failed");
  });
});
