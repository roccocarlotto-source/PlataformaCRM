import QRCode from "qrcode";
import type {
  DiscountVoucherPublicState,
  DiscountVoucherPublicStatus,
} from "../services/discountVoucher.service";
import { buildLandingHtml } from "./qrLanding";

// ---------------------------------------------------------------------------
// Página HTML pública del cupón de descuento (ítem 178) — lo que ve el cliente
// al abrir su link. Mismo patrón que qrLanding.ts: el backend arma el HTML
// completo y el Cloudflare Worker lo reenvía tal cual. NO JSON: el Worker
// fuerza `Content-Type: text/html` en toda respuesta que no sea un redirect,
// así que un JSON le llegaría al navegador como texto crudo (ver el ítem 178
// de docs/frontend-cambios-pendientes.md).
//
// Mismo shell visual que buildLandingHtml (colores, tipografía, centrado)
// para que se sienta parte de la misma plataforma. Copiado, no compartido:
// esa página es la respuesta de DEC-007 y tiene que seguir byte a byte igual.
//
// El QR solo se muestra si el cupón está ACTIVE, y codifica `qrContent` — el
// link de esta misma página (utils/voucherPublicUrl.ts). Es lo que el empleado
// escanea desde /vouchers/scan para canjearlo. Se genera acá, del lado del
// servidor, como data URL: la página sigue siendo HTML estático, sin JS ni CDN.
//
// Un estado nulo (no existe / malformado) cae en la landing genérica del QR:
// la misma función, no una copia.
// ---------------------------------------------------------------------------

const TEXTO_DE_ESTADO: Record<DiscountVoucherPublicStatus, string> = {
  ACTIVE: "Activo",
  CONSUMED: "Ya canjeado",
  EXPIRED: "Vencido",
};

// El label es texto libre que escribió un ADMIN al configurar la regla: se
// escapa antes de meterlo en el HTML.
function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Exportada para que los tests comparen contra la imagen esperada: prueban QUÉ
// codifica el QR, no solo que haya uno.
export function voucherQrDataUrl(qrContent: string): Promise<string> {
  return QRCode.toDataURL(qrContent, { width: 480 });
}

export async function buildVoucherLandingHtml(
  state: DiscountVoucherPublicState | null,
  qrContent: string,
): Promise<string> {
  if (!state) {
    return buildLandingHtml();
  }

  const activo = state.status === "ACTIVE";
  const qr = activo
    ? `
    <img class="qr" src="${await voucherQrDataUrl(qrContent)}" alt="Código QR del cupón" width="240" height="240" />
    <p>Mostrale este código al empleado para canjearlo.</p>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tu cupón</title>
<style>
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    text-align: center;
    padding: 24px;
  }
  main { max-width: 28rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { color: #94a3b8; line-height: 1.5; }
  .estado { font-weight: 600; color: #94a3b8; }
  .estado-activo { color: #4ade80; }
  .qr { display: block; margin: 1.5rem auto 0.5rem; max-width: 100%; height: auto; border-radius: 8px; }
</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(state.label)}</h1>
    <p class="estado${activo ? " estado-activo" : ""}">${TEXTO_DE_ESTADO[state.status]}</p>${qr}
  </main>
</body>
</html>`;
}
