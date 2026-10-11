import { describe, expect, it } from "vitest";
import { sesionIniciadaConContrasena } from "./sesionConContrasena";

function base64url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function token(payload: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: "ES256", typ: "JWT" }))}.${base64url(
    JSON.stringify(payload),
  )}.firma`;
}

describe("sesionIniciadaConContrasena — claim amr del access token", () => {
  it("signInWithPassword (amr password): true", () => {
    expect(
      sesionIniciadaConContrasena(token({ amr: [{ method: "password", timestamp: 1 }] })),
    ).toBe(true);
  });

  it("link de invitación o de recuperación: false", () => {
    expect(sesionIniciadaConContrasena(token({ amr: [{ method: "otp", timestamp: 1 }] }))).toBe(
      false,
    );
    expect(sesionIniciadaConContrasena(token({ amr: [{ method: "invite", timestamp: 1 }] }))).toBe(
      false,
    );
    expect(
      sesionIniciadaConContrasena(token({ amr: [{ method: "recovery", timestamp: 1 }] })),
    ).toBe(false);
  });

  it("con datos no ASCII en el payload (un nombre con tilde) lo sigue leyendo", () => {
    expect(
      sesionIniciadaConContrasena(
        token({ user_metadata: { nombre: "Ana Pérez" }, amr: [{ method: "password" }] }),
      ),
    ).toBe(true);
  });

  it("token raro, sin amr o ausente: false (el camino de siempre)", () => {
    expect(sesionIniciadaConContrasena(undefined)).toBe(false);
    expect(sesionIniciadaConContrasena("invite-session-token")).toBe(false);
    expect(sesionIniciadaConContrasena("a.%%%.c")).toBe(false);
    expect(sesionIniciadaConContrasena(token({ sub: "x" }))).toBe(false);
  });
});
