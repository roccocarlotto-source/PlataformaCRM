import { afterEach, describe, expect, it, vi } from "vitest";
import { composeQrImage, downloadSvg, generateQrSvg } from "./qrImage";

const TEST_URL = "http://localhost:4000/qr/resolve/d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

// El original decodificaba el PNG con jsqr+pngjs para afirmar que el SVG
// codifica exactamente la URL. Acá no se agregan esas dos dependencias de
// desarrollo solo para eso: `qrcode` es determinista, así que se afirma que
// el SVG es válido, que la misma URL produce el mismo QR y que una URL
// distinta produce otro. Que la URL codificada sea la pública la afirma
// QrImageDialog.test.tsx sobre el argumento que recibe generateQrSvg.

describe("generateQrSvg", () => {
  it("produce markup SVG y es determinista para la misma URL", async () => {
    const svg = await generateQrSvg(TEST_URL);
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(await generateQrSvg(TEST_URL)).toBe(svg);
  });

  it("una URL distinta produce un QR distinto", async () => {
    const a = await generateQrSvg(TEST_URL);
    const b = await generateQrSvg(`${TEST_URL}x`);
    expect(a).not.toBe(b);
  });
});

describe("composeQrImage", () => {
  const BASE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h1"/></svg>';

  function alto(svg: string): number {
    return Number(/<svg[^>]*height="(\d+)"/.exec(svg)?.[1]);
  }

  it("sin mensaje (null, vacío o solo espacios) devuelve el QR con tamaño fijo y nada más", () => {
    for (const message of [null, undefined, "", "   "]) {
      const out = composeQrImage(BASE_SVG, message);
      expect(out).toBe(
        '<svg width="240" height="240" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h1"/></svg>',
      );
      expect(out).not.toContain("foreignObject");
    }
  });

  it("con mensaje, lo agrega DEBAJO como texto escapado y conserva el QR intacto", () => {
    const out = composeQrImage(BASE_SVG, 'Gracias <por> "elegirnos" & volver');
    expect(out).toContain('<path d="M0 0h1"/>');
    expect(out).toContain("<foreignObject");
    expect(out).toContain("Gracias &lt;por&gt; &quot;elegirnos&quot; &amp; volver");
    expect(out).not.toContain("<por>");
    expect(alto(out)).toBeGreaterThan(240);
  });

  it("un mensaje larguísimo no infla la imagen sin tope", () => {
    const corto = composeQrImage(BASE_SVG, "hola");
    const largo = composeQrImage(BASE_SVG, "x".repeat(10_000));
    expect(alto(largo)).toBeGreaterThan(alto(corto));
    // 12 líneas máx * 20px + los dos gaps de 16: nunca crece más allá de eso.
    expect(alto(largo)).toBe(240 + 16 + 12 * 20 + 16);
  });
});

describe("downloadSvg", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("crea un object URL, clickea un <a download> y lo revoca", () => {
    // jsdom no implementa createObjectURL/revokeObjectURL.
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadSvg("<svg/>", "qr-1.svg");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
