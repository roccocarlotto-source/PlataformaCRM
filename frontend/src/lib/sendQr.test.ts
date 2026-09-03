import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailMessageForCopy,
  buildMailtoLink,
  buildWhatsAppLink,
  normalizeWhatsAppNumber,
  openPreparedMessage,
} from "./sendQr";

// Casos portados de admin/src/lib/sendQr.test.ts del original (docs/qr-integration.md,
// Fase 3, "Verificación"). La URL pública ahora es la de /qr/resolve, no /r/.
const URL_ = "http://localhost:4000/qr/resolve/d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

describe("normalizeWhatsAppNumber", () => {
  it("saca espacios, paréntesis, guiones y el + inicial", () => {
    expect(normalizeWhatsAppNumber("+598 99 123 456")).toBe("59899123456");
    expect(normalizeWhatsAppNumber("(598) 99-123-456")).toBe("59899123456");
  });

  // DEC-063 (Cycle 23): 9 dígitos con el prefijo troncal "0" → se saca el 0 y
  // se antepone 598.
  it("antepone 598 a un número de 9 dígitos que empieza con 0", () => {
    expect(normalizeWhatsAppNumber("096468788")).toBe("59896468788");
  });

  // DEC-063: 8 dígitos (sin 0) → 598 directo.
  it("antepone 598 a un número de 8 dígitos", () => {
    expect(normalizeWhatsAppNumber("96468788")).toBe("59896468788");
  });

  // DEC-063: uno que ya trae 598 queda igual.
  it("deja intacto un número que ya empieza con 598", () => {
    expect(normalizeWhatsAppNumber("59896468788")).toBe("59896468788");
  });

  it("no agrega, saca ni asume código de país para ningún otro largo/forma", () => {
    expect(normalizeWhatsAppNumber("1112345678")).toBe("1112345678");
  });
});

describe("buildWhatsAppLink", () => {
  it("arma un link wa.me con los dígitos normalizados y la URL pública exacta", () => {
    const link = buildWhatsAppLink("+598 99 123 456", URL_);
    expect(link).toMatch(/^https:\/\/wa\.me\/59899123456\?text=/);
    expect(decodeURIComponent(link.split("text=")[1])).toContain(URL_);
  });

  it("usa el mensaje custom cuando existe, seguido de la URL pública", () => {
    const link = buildWhatsAppLink("+598 99 123 456", URL_, "Seguinos en Instagram");
    const text = decodeURIComponent(link.split("text=")[1]);
    expect(text).toContain("Seguinos en Instagram");
    expect(text).toContain(URL_);
    expect(text).not.toContain("Dejanos tu reseña en Google");
  });

  it("cae al copy fijo cuando el mensaje custom es null, undefined o blanco", () => {
    for (const customMessage of [null, undefined, "", "   "]) {
      const link = buildWhatsAppLink("+598 99 123 456", URL_, customMessage);
      const text = decodeURIComponent(link.split("text=")[1]);
      expect(text).toBe(`Dejanos tu reseña en Google: ${URL_}`);
    }
  });
});

describe("buildMailtoLink", () => {
  it("arma un mailto: al destinatario con la URL pública exacta en el cuerpo", () => {
    const link = buildMailtoLink("cliente@ejemplo.com", URL_);
    expect(link).toMatch(/^mailto:cliente%40ejemplo\.com\?/);
    const bodyParam = new URLSearchParams(link.split("?")[1]).get("body");
    expect(bodyParam).toContain(URL_);
  });

  it("usa el mensaje custom cuando existe, seguido de la URL pública, nunca el destino", () => {
    const link = buildMailtoLink("cliente@ejemplo.com", URL_, "¡Gracias por elegirnos!");
    const bodyParam = new URLSearchParams(link.split("?")[1]).get("body") ?? "";
    expect(bodyParam).toContain("¡Gracias por elegirnos!");
    expect(bodyParam).toContain(URL_);
  });
});

describe("buildEmailMessageForCopy", () => {
  it("contiene exactamente el mismo asunto y cuerpo que buildMailtoLink", () => {
    const mailto = buildMailtoLink("cliente@ejemplo.com", URL_);
    const params = new URLSearchParams(mailto.split("?")[1]);
    const mailtoSubject = decodeURIComponent(params.get("subject") ?? "");
    const mailtoBody = decodeURIComponent(params.get("body") ?? "");
    const copyText = buildEmailMessageForCopy(URL_);

    expect(copyText).toContain(URL_);
    expect(copyText).toBe(`${mailtoSubject}\n\n${mailtoBody}`);
  });

  it("es texto plano, no un mailto:, y nunca contiene al destinatario", () => {
    const copyText = buildEmailMessageForCopy(URL_);
    expect(copyText).not.toMatch(/^mailto:/);
    expect(copyText).not.toContain("cliente@ejemplo.com");
  });

  it("espeja a buildMailtoLink también con mensaje custom", () => {
    const mailto = buildMailtoLink("cliente@ejemplo.com", URL_, "Escribinos por WhatsApp.");
    const params = new URLSearchParams(mailto.split("?")[1]);
    const mailtoSubject = decodeURIComponent(params.get("subject") ?? "");
    const mailtoBody = decodeURIComponent(params.get("body") ?? "");
    const copyText = buildEmailMessageForCopy(URL_, "Escribinos por WhatsApp.");

    expect(copyText).toBe(`${mailtoSubject}\n\n${mailtoBody}`);
    expect(copyText).toContain("Escribinos por WhatsApp.");
  });
});

describe("openPreparedMessage", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clickea un anchor seguro (nueva pestaña, noopener) apuntando al link", () => {
    openPreparedMessage("https://wa.me/59899123456?text=hola");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});
