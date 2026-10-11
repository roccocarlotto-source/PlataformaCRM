import { describe, expect, it } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { esMismaContrasena, MENSAJE_GENERICO_DE_AUTH, mensajeDeAuth } from "./mensajesDeAuth";

describe("mensajeDeAuth — errores de Supabase Auth en castellano", () => {
  it("por código: credenciales inválidas", () => {
    const error = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(mensajeDeAuth(error)).toBe("El email o la contraseña no son correctos.");
  });

  it("por código: misma contraseña", () => {
    const error = new AuthApiError(
      "New password should be different from the old password.",
      422,
      "same_password",
    );
    expect(mensajeDeAuth(error)).toBe(
      "La contraseña nueva tiene que ser distinta de la que ya tenés.",
    );
  });

  it("por código: límite de emails y de pedidos", () => {
    expect(
      mensajeDeAuth(
        new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"),
      ),
    ).toBe("Ya te enviamos varios emails. Esperá unos minutos antes de pedir otro.");
    expect(
      mensajeDeAuth(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")),
    ).toBe("Demasiados intentos. Probá de nuevo en unos minutos.");
  });

  it("por código: contraseña débil, link vencido, email sin confirmar", () => {
    expect(
      mensajeDeAuth(
        new AuthApiError("Password should be at least 8 characters.", 422, "weak_password"),
      ),
    ).toMatch(/^La contraseña es demasiado débil/);
    expect(
      mensajeDeAuth(new AuthApiError("Email link is invalid or has expired", 403, "otp_expired")),
    ).toBe("Este enlace no es válido o expiró. Pedí uno nuevo.");
    expect(
      mensajeDeAuth(new AuthApiError("Email not confirmed", 400, "email_not_confirmed")),
    ).toMatch(/^Todavía no confirmaste tu email/);
  });

  it("sin código, por el texto de GoTrue", () => {
    const casos: [string, string | RegExp][] = [
      ["Invalid login credentials", "El email o la contraseña no son correctos."],
      [
        "New password should be different from the old password.",
        "La contraseña nueva tiene que ser distinta de la que ya tenés.",
      ],
      ["Password should be at least 6 characters", /^La contraseña es demasiado débil/],
      [
        "Email rate limit exceeded",
        "Ya te enviamos varios emails. Esperá unos minutos antes de pedir otro.",
      ],
      [
        "For security purposes, you can only request this after 42 seconds.",
        "Demasiados intentos. Probá de nuevo en unos minutos.",
      ],
      [
        "Email link is invalid or has expired",
        "Este enlace no es válido o expiró. Pedí uno nuevo.",
      ],
    ];
    for (const [mensaje, esperado] of casos) {
      const traducido = mensajeDeAuth(new AuthApiError(mensaje, 400, undefined));
      if (typeof esperado === "string") expect(traducido).toBe(esperado);
      else expect(traducido).toMatch(esperado);
    }
  });

  it("un error de Auth desconocido da el genérico de la pantalla, nunca el inglés", () => {
    const error = new AuthApiError("Something unexpected happened", 500, "unexpected_failure");
    expect(mensajeDeAuth(error)).toBe(MENSAJE_GENERICO_DE_AUTH);
    expect(mensajeDeAuth(error, "No pudimos iniciar sesión.")).toBe("No pudimos iniciar sesión.");
  });

  it("sin conexión (AuthRetryableFetchError) y 429 sin código", () => {
    expect(mensajeDeAuth(new AuthRetryableFetchError("Failed to fetch", 0))).toBe(
      "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.",
    );
    expect(mensajeDeAuth(new AuthApiError("Too Many Requests", 429, undefined))).toBe(
      "Demasiados intentos. Probá de nuevo en unos minutos.",
    );
  });

  it("un error propio (en castellano) se muestra tal cual", () => {
    expect(mensajeDeAuth(new Error("Esta invitación ya fue aceptada"))).toBe(
      "Esta invitación ya fue aceptada",
    );
    expect(mensajeDeAuth("no es un Error")).toBe(MENSAJE_GENERICO_DE_AUTH);
  });
});

describe("esMismaContrasena", () => {
  it("reconoce same_password por código y por texto", () => {
    expect(esMismaContrasena(new AuthApiError("x", 422, "same_password"))).toBe(true);
    expect(
      esMismaContrasena(new Error("New password should be different from the old password.")),
    ).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(esMismaContrasena(new AuthApiError("weak", 422, "weak_password"))).toBe(false);
    expect(esMismaContrasena(null)).toBe(false);
  });
});
