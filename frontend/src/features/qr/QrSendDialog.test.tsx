import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { env } from "../../config/env";
import { makeQrCode } from "../../test/qrFixtures";
import { QrSendDialog } from "./QrSendDialog";

const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
// Corregido 2026-09-04: el link público sale contra el Worker
// (env.qrPublicBaseUrl + /r/), no contra el backend directo — ver
// docs/qr-integration.md, "Qué se corrigió: publicUrl.ts apunta al Worker".
const PUBLIC_URL = `${env.qrPublicBaseUrl}/r/${QR_ID}`;

// openPreparedMessage clickea un <a target=_blank>; se captura el href en
// vez de dejar que jsdom intente navegar.
let hrefs: string[];
beforeEach(() => {
  hrefs = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    hrefs.push(this.href);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderDialog(message: string | null = null) {
  const onClose = vi.fn();
  render(<QrSendDialog qr={makeQrCode({ displayNumber: 2, message })} onClose={onClose} />);
  return { onClose, dialog: within(screen.getByRole("dialog")) };
}

describe("QrSendDialog — WhatsApp", () => {
  it("normaliza un número UY de 9 dígitos con 0 inicial y abre wa.me con el link público; cierra al abrir", async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = renderDialog();

    await user.type(dialog.getByLabelText(/Número de WhatsApp/), "096468788");
    await user.click(dialog.getByRole("button", { name: "Abrir WhatsApp" }));

    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toMatch(/^https:\/\/wa\.me\/59896468788\?text=/);
    expect(decodeURIComponent(hrefs[0].split("text=")[1])).toBe(
      `Dejanos tu reseña en Google: ${PUBLIC_URL}`,
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("un número de 8 dígitos también recibe 598; el mensaje custom va antes del link", async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog("Seguinos en Instagram");

    await user.type(dialog.getByLabelText(/Número de WhatsApp/), "96468788");
    await user.click(dialog.getByRole("button", { name: "Abrir WhatsApp" }));

    expect(hrefs[0]).toMatch(/^https:\/\/wa\.me\/59896468788\?text=/);
    const text = decodeURIComponent(hrefs[0].split("text=")[1]);
    expect(text).toBe(`Seguinos en Instagram\n\n${PUBLIC_URL}`);
    // El destino real del QR nunca viaja en el mensaje.
    expect(text).not.toContain("g.page");
  });

  it("sin número, error y no abre nada", async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = renderDialog();

    await user.click(dialog.getByRole("button", { name: "Abrir WhatsApp" }));

    expect(dialog.getByRole("alert")).toHaveTextContent("Ingresá un número de WhatsApp.");
    expect(hrefs).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("QrSendDialog — Email", () => {
  it("abre un mailto: al destinatario con el link público y NO cierra (para dejar 'Copiar mensaje' a mano)", async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = renderDialog();

    await user.click(dialog.getByRole("radio", { name: "Email" }));
    await user.type(dialog.getByRole("textbox", { name: "Email" }), "cliente@ejemplo.com");
    await user.click(dialog.getByRole("button", { name: "Abrir email" }));

    expect(hrefs[0]).toMatch(/^mailto:cliente%40ejemplo\.com\?/);
    const body = new URLSearchParams(hrefs[0].split("?")[1]).get("body") ?? "";
    expect(body).toContain(PUBLIC_URL);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.getByRole("button", { name: "Copiar mensaje" })).toBeInTheDocument();
  });

  it("sin email, error", async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog();

    await user.click(dialog.getByRole("radio", { name: "Email" }));
    await user.click(dialog.getByRole("button", { name: "Abrir email" }));

    expect(dialog.getByRole("alert")).toHaveTextContent("Ingresá un email.");
    expect(hrefs).toHaveLength(0);
  });

  it("Copiar mensaje copia el texto plano con asunto + cuerpo y el link público, sin destinatario", async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog("¡Gracias por elegirnos!");

    await user.click(dialog.getByRole("radio", { name: "Email" }));
    await user.type(dialog.getByRole("textbox", { name: "Email" }), "cliente@ejemplo.com");
    await user.click(dialog.getByRole("button", { name: "Copiar mensaje" }));

    expect(await dialog.findByRole("button", { name: "¡Copiado!" })).toBeInTheDocument();
    const copiado = await navigator.clipboard.readText();
    expect(copiado.startsWith("Te invitamos a dejarnos una reseña")).toBe(true);
    expect(copiado).toContain("¡Gracias por elegirnos!");
    expect(copiado).toContain(PUBLIC_URL);
    expect(copiado).not.toContain("cliente@ejemplo.com");
    expect(copiado).not.toMatch(/^mailto:/);
  });

  it("'Copiar mensaje' no existe en el canal WhatsApp", () => {
    const { dialog } = renderDialog();
    expect(dialog.queryByRole("button", { name: "Copiar mensaje" })).not.toBeInTheDocument();
  });
});
