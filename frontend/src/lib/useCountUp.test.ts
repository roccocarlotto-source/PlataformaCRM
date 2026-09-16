import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { COUNT_UP_DURATION_MS, useCountUp } from "./useCountUp";

// El setup global (test/setup.ts) declara prefers-reduced-motion: reduce, así
// que para ver el conteo real hay que pisarlo con un matchMedia sin esa
// preferencia. requestAnimationFrame va con los timers falsos: cada frame
// "dura" 16ms y el tiempo avanza solo cuando el test lo pide.
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCountUp", () => {
  it("null mientras no hay número; al llegar cuenta desde 0, con valores intermedios crecientes, y termina exacto", () => {
    stubReducedMotion(false);
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: null as number | null },
    });
    expect(result.current).toBeNull();

    rerender({ target: 120 });
    // El primer render con el número ya pinta el 0: no hay un frame con el
    // valor final antes de que arranque el conteo.
    expect(result.current).toBe(0);

    const seen: number[] = [];
    for (let elapsed = 0; elapsed < COUNT_UP_DURATION_MS - 100; elapsed += 100) {
      advance(100);
      seen.push(result.current ?? Number.NaN);
    }
    expect(seen.every((value) => value > 0 && value < 120)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));

    advance(200);
    expect(result.current).toBe(120);
  });

  it("ease-out: a mitad del tiempo ya recorrió bastante más de la mitad", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useCountUp(1000));
    advance(COUNT_UP_DURATION_MS / 2);
    // 1 - (1 - 0.5)³ = 0.875; con frames de 16ms cae un poco antes.
    expect(result.current).toBeGreaterThan(800);
    expect(result.current).toBeLessThan(1000);
  });

  it("un cambio de target DESPUÉS del conteo salta directo, sin volver a animar", () => {
    stubReducedMotion(false);
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 50 as number | null },
    });
    advance(COUNT_UP_DURATION_MS + 50);
    expect(result.current).toBe(50);

    rerender({ target: 80 });
    expect(result.current).toBe(80);
    advance(100);
    expect(result.current).toBe(80);

    // Pasar por null (sin dato) y volver tampoco reinicia el conteo.
    rerender({ target: null });
    expect(result.current).toBeNull();
    rerender({ target: 30 });
    expect(result.current).toBe(30);
  });

  it("un cambio de target a MITAD del conteo también salta directo al valor nuevo", () => {
    stubReducedMotion(false);
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 100 },
    });
    advance(200);
    expect(result.current).toBeLessThan(100);

    rerender({ target: 40 });
    expect(result.current).toBe(40);
    advance(COUNT_UP_DURATION_MS);
    expect(result.current).toBe(40);
  });

  it("prefers-reduced-motion: reduce → el valor final de entrada, sin pasos intermedios", () => {
    stubReducedMotion(true);
    const { result } = renderHook(() => useCountUp(75));
    expect(result.current).toBe(75);
    advance(100);
    expect(result.current).toBe(75);
  });

  it("es el default de la suite: el mock global de test/setup.ts pide reduced motion", () => {
    const { result } = renderHook(() => useCountUp(75));
    expect(result.current).toBe(75);
  });

  it("animate: false → la llegada es directa aunque no haya reduced motion", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useCountUp(75, { animate: false }));
    expect(result.current).toBe(75);
  });

  it("sin matchMedia (navegador sin soporte) no hay preferencia declarada: cuenta", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useCountUp(75));
    expect(result.current).toBe(0);
    advance(COUNT_UP_DURATION_MS + 50);
    expect(result.current).toBe(75);
  });

  it("respeta durationMs", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useCountUp(10, { durationMs: 200 }));
    advance(100);
    expect(result.current).toBeLessThan(10);
    advance(150);
    expect(result.current).toBe(10);
  });

  it("desmontar a mitad del conteo cancela el frame pendiente", () => {
    stubReducedMotion(false);
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { unmount } = renderHook(() => useCountUp(10));
    advance(100);
    unmount();
    expect(cancel).toHaveBeenCalled();
    // Ningún frame queda vivo que actualice estado de un hook desmontado.
    expect(vi.getTimerCount()).toBe(0);
  });
});
