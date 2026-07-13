import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { server } from "./msw/server";

// onUnhandledRequest: "error" — cualquier request no contemplada explícitamente
// por un test falla ruidosamente en vez de intentar salir a una red real.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
