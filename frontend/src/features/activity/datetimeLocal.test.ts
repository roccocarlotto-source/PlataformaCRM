import { afterEach, describe, expect, it } from "vitest";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "./datetimeLocal";

// Este paquete frontend no trae @types/node (no hay `process` en el DOM
// lib de tsconfig) — el proceso Vitest sí es Node real en tiempo de
// ejecución, así que se accede vía globalThis con un cast puntual en vez
// de agregar una dependencia nueva solo para el tipo. Node relee
// process.env.TZ en cada construcción de Date (verificado empíricamente en
// este entorno, no asumido) — se restaura la timezone original después de
// cada test para no filtrar estado entre archivos.
const nodeProcess = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process;
const originalTz = nodeProcess.env.TZ;

function withTz(tz: string, fn: () => void) {
  nodeProcess.env.TZ = tz;
  try {
    fn();
  } finally {
    nodeProcess.env.TZ = originalTz;
  }
}

describe("toDatetimeLocalValue / fromDatetimeLocalValue", () => {
  afterEach(() => {
    nodeProcess.env.TZ = originalTz;
  });

  it("round-trip conserva el instante exacto en UTC", () => {
    withTz("UTC", () => {
      const iso = "2026-01-01T15:30:00.000Z";
      const local = toDatetimeLocalValue(iso);
      expect(local).toBe("2026-01-01T15:30");
      expect(fromDatetimeLocalValue(local)).toBe(iso);
    });
  });

  it("timezone no UTC negativa (Argentina, UTC-3): hidrata restando el offset, no un slice directo", () => {
    withTz("America/Argentina/Buenos_Aires", () => {
      const iso = "2026-01-01T15:30:00.000Z";
      const local = toDatetimeLocalValue(iso);
      // 15:30 UTC - 3h = 12:30 local — NUNCA "15:30" (que sería un slice
      // directo del ISO UTC crudo, el bug explícito a evitar).
      expect(local).toBe("2026-01-01T12:30");
      expect(local).not.toBe(iso.slice(0, 16));
    });
  });

  it("timezone no UTC negativa: round-trip conserva el instante exacto", () => {
    withTz("America/Argentina/Buenos_Aires", () => {
      const iso = "2026-01-01T15:30:00.000Z";
      const local = toDatetimeLocalValue(iso);
      expect(fromDatetimeLocalValue(local)).toBe(iso);
    });
  });

  it("timezone positiva (Kiritimati, UTC+14): round-trip conserva el instante exacto", () => {
    withTz("Pacific/Kiritimati", () => {
      const iso = "2026-01-01T15:30:00.000Z";
      const local = toDatetimeLocalValue(iso);
      expect(fromDatetimeLocalValue(local)).toBe(iso);
    });
  });

  it("timezone que cruza el día calendario (Argentina, medianoche UTC): la hora local cae en el día anterior, y el round-trip sigue siendo exacto", () => {
    withTz("America/Argentina/Buenos_Aires", () => {
      const iso = "2026-01-02T01:00:00.000Z";
      const local = toDatetimeLocalValue(iso);
      // 01:00 UTC del día 2 - 3h = 22:00 local del día 1 — el día
      // calendario cambia, exactamente el tipo de corrimiento que
      // slice(0,10)/slice(0,16) directos sobre el ISO UTC no manejan.
      expect(local).toBe("2026-01-01T22:00");
      expect(fromDatetimeLocalValue(local)).toBe(iso);
    });
  });

  it("no usa slice(0,10) — el helper preserva minutos, no solo el día", () => {
    const iso = "2026-06-15T09:45:00.000Z";
    withTz("UTC", () => {
      const local = toDatetimeLocalValue(iso);
      expect(local).toHaveLength(16);
      expect(local).toBe("2026-06-15T09:45");
    });
  });
});
