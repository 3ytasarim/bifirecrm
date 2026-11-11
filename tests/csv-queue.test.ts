import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { csvCell, toCsv } = await import("@/lib/csv");
const { backoffMs } = await import("@/lib/jobs/queue");

describe("CSV", () => {
  it("formül enjeksiyonunu etkisizleştirir", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+905321234567")).toBe("'+905321234567");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
  it("ayırıcı ve tırnak kaçışı", () => expect(csvCell('a;b"c')).toBe('"a;b""c"'));
  it("BOM + CRLF", () => {
    const out = toCsv(["Ad", "Not"], [["Ayşe", null]]);
    expect(out.startsWith("﻿Ad;Not\r\n")).toBe(true);
    expect(out.endsWith("Ayşe;\r\n")).toBe(true);
  });
});

describe("iş kuyruğu geri çekilme", () => {
  it("üstel artar ve 6 saatte sınırlanır", () => {
    expect(backoffMs(1, 0.5)).toBe(30_000);
    expect(backoffMs(2, 0.5)).toBe(60_000);
    expect(backoffMs(4, 0.5)).toBe(240_000);
    expect(backoffMs(50, 0.5)).toBe(6 * 3600_000);
  });
  it("±%10 sapma", () => {
    expect(backoffMs(1, 0)).toBe(27_000);
    expect(backoffMs(1, 1)).toBe(33_000);
  });
});
