import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { env } from "../../config/env";
import { makeQrCode } from "../../test/qrFixtures";
import { QrImageDialog } from "./QrImageDialog";

// Se mockea solo generateQrSvg para poder afirmar QUÉ URL se codifica —
// que es el punto de verificación de la guía ("la URL codificada apunta al
// Worker, ${env.qrPublicBaseUrl}/r/:qrId, nunca directo al backend ni a
// Supabase" — corregido 2026-09-04, ver docs/qr-integration.md, "Qué se
// corrigió: publicUrl.ts apunta al Worker"). composeQrImage y downloadSvg
// son los reales.
const generateQrSvgMock = vi.hoisted(() =>
  vi.fn(
    async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>',
  ),
);
vi.mock("../../lib/qrImage", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/qrImage")>();
  return { ...original, generateQrSvg: generateQrSvgMock };
});

const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";
const PUBLIC_URL = `${env.qrPublicBaseUrl}/r/${QR_ID}`;

afterEach(() => {
  vi.restoreAllMocks();
  generateQrSvgMock.mockClear();
});

describe("QrImageDialog", () => {
  it("codifica la URL pública de resolución (contra el Worker, /r/, sin /api ni /qr/resolve/) y muestra el SVG con el mensaje debajo", async () => {
    render(<QrImageDialog qr={makeQrCode({ message: "Gracias <3" })} onClose={vi.fn()} />);

    await waitFor(() => expect(generateQrSvgMock).toHaveBeenCalledWith(PUBLIC_URL));
    const imagen = await screen.findByTestId("qr-image");
    expect(imagen.querySelector("svg")).not.toBeNull();
    expect(imagen.innerHTML).toContain("Gracias &lt;3");
    expect(imagen.innerHTML).toContain("foreignObject");
    expect(PUBLIC_URL).not.toContain("/api/");
    expect(PUBLIC_URL).not.toContain("/qr/resolve/");
    expect(PUBLIC_URL).not.toContain(env.apiUrl);
    expect(PUBLIC_URL).toContain("/r/");
  });

  it("sin mensaje, no agrega el bloque de texto", async () => {
    render(<QrImageDialog qr={makeQrCode({ message: null })} onClose={vi.fn()} />);

    const imagen = await screen.findByTestId("qr-image");
    expect(imagen.innerHTML).not.toContain("foreignObject");
  });

  it("título con número y nombre; muestra el link público y lo copia", async () => {
    const user = userEvent.setup();
    render(<QrImageDialog qr={makeQrCode({ displayNumber: 3, name: "Caja" })} onClose={vi.fn()} />);

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("QR 3 — Caja")).toBeInTheDocument();
    expect(dialog.getByLabelText("Link público")).toHaveValue(PUBLIC_URL);

    await user.click(dialog.getByRole("button", { name: "Copiar link" }));
    expect(await dialog.findByRole("button", { name: "¡Copiado!" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(PUBLIC_URL);
  });

  it("Descargar imagen dispara downloadSvg con el nombre qr-<id>.svg", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe(`qr-${QR_ID}.svg`);
    });
    const user = userEvent.setup();
    render(<QrImageDialog qr={makeQrCode()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Descargar imagen" }));

    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("si generar la imagen falla, muestra el error en vez de romper", async () => {
    generateQrSvgMock.mockRejectedValueOnce(new Error("sin memoria"));
    render(<QrImageDialog qr={makeQrCode()} onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("sin memoria");
    expect(screen.queryByTestId("qr-image")).not.toBeInTheDocument();
  });

  it("Cerrar llama a onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<QrImageDialog qr={makeQrCode()} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
