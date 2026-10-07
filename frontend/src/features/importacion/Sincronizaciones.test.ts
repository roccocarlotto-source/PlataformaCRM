import { describe, expect, it } from "vitest";
import { haceCuanto } from "./Sincronizaciones";

describe("haceCuanto", () => {
  const ahora = Date.parse("2026-10-07T12:00:00Z");
  it("minutos, horas y días, para que un atraso se vea", () => {
    expect(haceCuanto("2026-10-07T11:59:50Z", ahora)).toBe("recién");
    expect(haceCuanto("2026-10-07T11:35:00Z", ahora)).toBe("hace 25 min");
    expect(haceCuanto("2026-10-06T22:00:00Z", ahora)).toBe("hace 14 h");
    expect(haceCuanto("2026-10-04T12:00:00Z", ahora)).toBe("hace 3 días");
  });
});
