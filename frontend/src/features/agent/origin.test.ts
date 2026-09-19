import { describe, expect, it } from "vitest";
import { ORIGENES_MAX_ITEMS, normalizeOrigin, validarOrigen } from "./origin";

// Este archivo es la prueba de que el espejo sigue siendo un espejo: los
// casos son los mismos que documenta src/utils/origin.ts, escritos contra la
// copia del frontend. Si alguna de las dos cambia sin la otra, acá se nota.
describe("normalizeOrigin", () => {
  it("normaliza esquema y host a minúsculas y saca la barra final", () => {
    expect(normalizeOrigin("HTTPS://Ejemplo.com/")).toBe("https://ejemplo.com");
    expect(normalizeOrigin("  https://ejemplo.com  ")).toBe("https://ejemplo.com");
  });

  it("conserva el puerto cuando no es el default del esquema", () => {
    expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    // 443 en https es el default: el navegador no lo manda en el header Origin
    // y acá tampoco queda.
    expect(normalizeOrigin("https://ejemplo.com:443")).toBe("https://ejemplo.com");
  });

  it("rechaza lo que no es un origen", () => {
    // Con path: el navegador nunca manda el path en Origin, así que aceptarlo
    // haría creer que autoriza algo distinto de lo que autoriza.
    expect(normalizeOrigin("https://ejemplo.com/contacto")).toBeNull();
    expect(normalizeOrigin("https://ejemplo.com/?utm=1")).toBeNull();
    expect(normalizeOrigin("https://ejemplo.com/#chat")).toBeNull();
    expect(normalizeOrigin("https://ejemplo.com/?")).toBeNull();
    // Sin esquema no parsea; ftp/javascript parsean pero no son http/https.
    expect(normalizeOrigin("ejemplo.com")).toBeNull();
    expect(normalizeOrigin("ftp://ejemplo.com")).toBeNull();
    // Credenciales.
    expect(normalizeOrigin("https://user:pass@ejemplo.com")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("   ")).toBeNull();
  });

  it("un subdominio es OTRO origen, no el mismo", () => {
    expect(normalizeOrigin("https://www.ejemplo.com")).toBe("https://www.ejemplo.com");
    expect(normalizeOrigin("https://ejemplo.com")).toBe("https://ejemplo.com");
  });
});

describe("validarOrigen", () => {
  it("devuelve el origen ya normalizado, que es lo que se guarda", () => {
    expect(validarOrigen("HTTPS://Ejemplo.com/", [])).toEqual({
      ok: true,
      origen: "https://ejemplo.com",
    });
  });

  it("el duplicado se compara YA NORMALIZADO", () => {
    // El backend lo deduplicaría en silencio; acá se avisa en vez de que el
    // dominio desaparezca sin explicación al guardar.
    const resultado = validarOrigen("https://EJEMPLO.com/", ["https://ejemplo.com"]);
    expect(resultado).toEqual({ ok: false, error: "https://ejemplo.com ya está en la lista." });
  });

  it("el mensaje de formato dice qué se espera, con el texto que se escribió", () => {
    const resultado = validarOrigen("ejemplo.com/contacto", []);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toContain('"ejemplo.com/contacto"');
    expect(resultado.error).toContain("https://ejemplo.com");
  });

  it("el largo se chequea ANTES que la forma, igual que en originSchema", () => {
    // Una URL válida pero de más de 255 caracteres: el backend la rechaza por
    // el .max(255) del string, no por la forma, y el mensaje tiene que decir
    // eso y no "no es un dominio válido".
    const largo = `https://${"a".repeat(260)}.com`;
    const resultado = validarOrigen(largo, []);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toContain("255");
  });

  it("no deja pasar el tope de 50 entradas", () => {
    const llena = Array.from({ length: ORIGENES_MAX_ITEMS }, (_, i) => `https://sitio${i}.com`);
    expect(validarOrigen("https://otro.com", llena)).toEqual({
      ok: false,
      error: "No se pueden agregar más de 50 dominios.",
    });
  });

  it("un duplicado con la lista llena avisa del duplicado, no del tope", () => {
    const llena = Array.from({ length: ORIGENES_MAX_ITEMS }, (_, i) => `https://sitio${i}.com`);
    const resultado = validarOrigen("https://sitio0.com", llena);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toContain("ya está en la lista");
  });

  it("el vacío pide un dominio en vez de acusar un formato inválido", () => {
    const resultado = validarOrigen("   ", []);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toContain("Escribí un dominio");
  });
});
