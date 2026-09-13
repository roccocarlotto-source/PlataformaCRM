import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSessionId, getOrCreateSessionId } from "./session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = "plataforma-crm-widget:session:agent-1";

describe("getOrCreateSessionId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("la primera vez genera un UUID y lo persiste bajo la clave scopeada por agentId", () => {
    const id = getOrCreateSessionId("agent-1");

    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem(KEY)).toBe(id);
  });

  it("la segunda lectura devuelve el mismo id", () => {
    const first = getOrCreateSessionId("agent-1");
    const second = getOrCreateSessionId("agent-1");

    expect(second).toBe(first);
  });

  it("dos agentes distintos tienen sesiones distintas", () => {
    const a = getOrCreateSessionId("agent-1");
    const b = getOrCreateSessionId("agent-2");

    expect(a).not.toBe(b);
    expect(localStorage.getItem("plataforma-crm-widget:session:agent-2")).toBe(b);
  });

  it("si localStorage tira al leer, no rompe y devuelve un id utilizable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage bloqueado");
    });

    let id: string | undefined;
    expect(() => {
      id = getOrCreateSessionId("agent-1");
    }).not.toThrow();
    expect(id).toMatch(UUID_RE);
  });

  it("si solo falla la escritura, igual devuelve el id generado", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cuota agotada");
    });

    expect(getOrCreateSessionId("agent-1")).toMatch(UUID_RE);
  });
});

describe("generateSessionId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("usa crypto.randomUUID cuando existe", () => {
    expect(generateSessionId()).toMatch(UUID_RE);
  });

  it("sin crypto.randomUUID (contexto no seguro, http plano) arma un UUID v4 con getRandomValues", () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });

    const id = generateSessionId();

    expect(id).toMatch(UUID_RE);
    expect(generateSessionId()).not.toBe(id);
  });
});
