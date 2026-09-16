import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { server } from "./msw/server";

// jsdom no implementa window.matchMedia. Sin un default, los números del
// Dashboard que cuentan desde 0 (§37, useCountUp) animarían de verdad con
// requestAnimationFrame en cada test que los monte, y un getByText del valor
// final dejaría de ser inmediato. Por eso el default es "el usuario pidió
// prefers-reduced-motion: reduce" (matches: true), que salta directo al valor
// final; cualquier otra query responde matches: false, que es lo que ya
// asumía el resto de la app sin matchMedia (tema del SO = claro, §31).
//
// Los tests que prueban el conteo real, o una preferencia del SO distinta,
// pisan esto con vi.stubGlobal("matchMedia", …); vi.unstubAllGlobals()
// devuelve este mock, no el undefined original de jsdom. Para probar el caso
// "navegador sin matchMedia", vi.stubGlobal("matchMedia", undefined).
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
});

// onUnhandledRequest: "error" — cualquier request no contemplada explícitamente
// por un test falla ruidosamente en vez de intentar salir a una red real.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
