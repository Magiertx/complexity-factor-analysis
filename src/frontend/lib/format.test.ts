import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatInputNumber,
  formatNumber,
  formatPercent,
  formatPValue,
  formatRelative,
  formatStatistic,
  parseInputNumber,
} from "./format";

// Intl puts a narrow no-break space before units and percent signs in German.
const space = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("formatNumber", () => {
  it("writes decimals and thousands as the UI language does", () => {
    expect(formatNumber(6822.441, "en", 1)).toBe("6,822.4");
    expect(formatNumber(6822.441, "de", 1)).toBe("6.822,4");
    expect(formatNumber(0.7466, "en", 2)).toBe("0.75");
    expect(formatNumber(0.7466, "de", 2)).toBe("0,75");
  });

  it("keeps up to six decimals without a fixed number", () => {
    expect(formatNumber(2112, "en")).toBe("2,112");
    expect(formatNumber(0.1234567, "en")).toBe("0.123457");
    expect(formatNumber(1.5, "de")).toBe("1,5");
  });

  it("uses a minus sign, and none for a value that rounds to zero", () => {
    expect(formatNumber(-0.25, "en", 2)).toBe("−0.25");
    expect(formatNumber(-0.001, "en", 2)).toBe("0.00");
    expect(formatNumber(-0, "de", 1)).toBe("0,0");
  });

  it("shows a dash for what is not a finite number", () => {
    expect(formatNumber(Number.NaN, "en")).toBe(NO_VALUE);
    expect(formatNumber(Number.POSITIVE_INFINITY, "de", 2)).toBe(NO_VALUE);
  });
});

describe("formatStatistic", () => {
  it("never groups, so a separator is always the decimal mark", () => {
    // A thousand and one in one column, in both languages: they cannot be mistaken for each other.
    expect(formatStatistic(1000, "en")).toBe("1000");
    expect(formatStatistic(1, "en")).toBe("1");
    expect(formatStatistic(1000, "de")).toBe("1000");
    expect(formatStatistic(1, "de")).toBe("1");
    expect(formatStatistic(17248, "en")).toBe("17248");
    expect(formatStatistic(17.248, "en")).toBe("17.248");
    expect(formatStatistic(17.248, "de")).toBe("17,248");
    expect(formatStatistic(17248.4, "de")).toBe("17248");
  });

  it("keeps up to three decimals below a thousand and trims the zeros", () => {
    expect(formatStatistic(319.2503, "en")).toBe("319.25");
    expect(formatStatistic(0.1234, "de")).toBe("0,123");
    expect(formatStatistic(999.9996, "en")).toBe("1000");
  });

  it("writes the minus as the other numbers do, none for a value that rounds to zero", () => {
    expect(formatStatistic(-2500, "en")).toBe("−2500");
    expect(formatStatistic(-0.0001, "en")).toBe("0");
    expect(formatStatistic(Number.NaN, "en")).toBe(NO_VALUE);
  });
});

describe("number fields", () => {
  it("are written without grouping and with the decimal comma in German", () => {
    expect(formatInputNumber(1234.5, "en")).toBe("1234.5");
    expect(formatInputNumber(1234.5, "de")).toBe("1234,5");
    expect(formatInputNumber(-0, "en")).toBe("0");
    expect(formatInputNumber(Number.NaN, "en")).toBe("");
  });

  it("read a comma or a point as the decimal separator", () => {
    expect(parseInputNumber("0,35")).toBe(0.35);
    expect(parseInputNumber(" 0.35 ")).toBe(0.35);
    expect(parseInputNumber("−0,5")).toBe(-0.5);
    expect(parseInputNumber(",5")).toBe(0.5);
    expect(parseInputNumber("4,")).toBe(4);
  });

  it("read nothing that is not a plain number", () => {
    for (const text of ["", "abc", "1,000.5", "1.000,5", "1e3", "--1", "0.3.5"]) {
      expect(parseInputNumber(text), text).toBeNull();
    }
  });

  it("round-trip what they write", () => {
    for (const value of [0.35, 1234.5, -7.125, 0]) {
      for (const locale of ["en", "de"]) expect(parseInputNumber(formatInputNumber(value, locale))).toBe(value);
    }
  });
});

describe("formatPercent", () => {
  it("writes a share of 1 as a percentage", () => {
    expect(formatPercent(0.727, "en")).toBe("72.7%");
    expect(space(formatPercent(0.727, "de"))).toBe("72,7 %");
    expect(formatPercent(0.5, "en", 0)).toBe("50%");
    expect(formatPercent(Number.NaN, "en")).toBe(NO_VALUE);
  });
});

describe("formatPValue", () => {
  it("writes three decimals, and smaller values as below 0.001", () => {
    expect(formatPValue(0.0423, "en")).toBe("0.042");
    expect(formatPValue(0, "en")).toBe("< 0.001");
    expect(formatPValue(0.0004, "de")).toBe("< 0,001");
  });
});

describe("formatFileSize", () => {
  it("takes the unit from the rounded value", () => {
    expect(space(formatFileSize(512, "en"))).toBe("512 byte");
    expect(space(formatFileSize(740 * 1024, "en"))).toBe("740 kB");
    // 1,048,575 bytes round to 1,024 kB, so they read as 1.0 MB.
    expect(space(formatFileSize(1048575, "en"))).toBe("1.0 MB");
    expect(space(formatFileSize(12.5 * 1024 * 1024, "de"))).toBe("12,5 MB");
  });
});

describe("dates", () => {
  // Noon UTC: the same calendar day in every time zone the tests may run in.
  const noon = "2026-10-06T12:00:00Z";

  it("writes the date in the format of the UI language", () => {
    expect(formatDate(noon, "en")).toBe("Oct 6, 2026");
    expect(formatDate(noon, "de")).toBe("06.10.2026");
    expect(formatDateTime(noon, "de")).toMatch(/^06\.10\.2026, \d\d:\d\d$/);
  });

  it("is empty for a date that cannot be read", () => {
    expect(formatDate("not a date", "en")).toBe("");
    expect(formatDateTime(Number.NaN, "en")).toBe("");
    expect(formatRelative("not a date", "en")).toBe("");
  });

  it("says how long ago, in the UI language", () => {
    const now = Date.parse(noon);
    expect(formatRelative(now - 3 * 3600 * 1000, "en", now)).toBe("3 hours ago");
    expect(formatRelative(now - 3 * 3600 * 1000, "de", now)).toBe("vor 3 Stunden");
    expect(formatRelative(now - 2 * 24 * 3600 * 1000, "en", now)).toBe("2 days ago");
    expect(formatRelative(now - 10 * 1000, "en", now)).toBe("now");
  });
});
