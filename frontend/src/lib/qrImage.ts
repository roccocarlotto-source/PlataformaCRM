// ---------------------------------------------------------------------------
// Generación de la imagen del QR del lado del cliente — puerto de
// admin/src/lib/qrImage.ts del original (DEC-054: sin backend, sin Storage,
// sin llamada de red). Envoltorio fino sobre `qrcode`, en su propio módulo
// para que la codificación y la mecánica de descarga se prueben por separado.
// ---------------------------------------------------------------------------
import QRCode from "qrcode";

export async function generateQrSvg(url: string): Promise<string> {
  return await QRCode.toString(url, { type: "svg" });
}

// Misma disciplina de escape que escapeHtml en src/utils/qrLanding.ts del
// backend — necesaria acá tanto por validez del XML (un & o < sin escapar
// rompe el SVG) como porque el mensaje es texto cargado por el dueño del
// negocio y se incrusta en markup.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Tamaño fijo (px) del bloque del QR, independiente del viewBox por módulos
// que trae la salida de generateQrSvg (el SVG por defecto de `qrcode` no
// tiene width/height, solo `viewBox="0 0 N N"` con N = cantidad de módulos
// para esa URL) — fijarlo acá hace predecible el layout de la imagen
// compuesta sin importar qué versión de QR produzca cada URL.
const QR_SIZE = 240;
const TEXT_GAP = 16;
const LINE_HEIGHT = 20;
const CHARS_PER_LINE = 28; // estimación gruesa a 14px system-ui en 240px de ancho
const MAX_MESSAGE_LINES = 12; // tope para que un mensaje larguísimo no infle la imagen

function estimateLineCount(message: string): number {
  return message
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
}

// Compone el QR con su mensaje como texto visible DEBAJO del código — nunca
// adentro: el mensaje no se recodifica, es texto plano escapado en un
// <foreignObject> hermano, agregado solo a la representación visual. El
// contenido codificado del QR (el SVG que devuelve generateQrSvg, que solo
// recibe la URL pública de resolución) queda intacto — esta función solo lo
// reempaqueta en un envoltorio posiblemente más alto. Con `message`
// null/vacío (incluido solo espacios), devuelve el SVG original sin cambios
// más allá del tamaño fijo: sin espacio en blanco extra.
export function composeQrImage(qrSvg: string, message?: string | null): string {
  const trimmed = message?.trim();
  const sizedQr = qrSvg.replace("<svg ", `<svg width="${QR_SIZE}" height="${QR_SIZE}" `);
  if (!trimmed) {
    return sizedQr;
  }

  const escaped = escapeXml(trimmed);
  const lines = Math.min(estimateLineCount(trimmed), MAX_MESSAGE_LINES);
  const textAreaHeight = lines * LINE_HEIGHT + TEXT_GAP;
  const totalHeight = QR_SIZE + TEXT_GAP + textAreaHeight;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${QR_SIZE}" height="${totalHeight}" viewBox="0 0 ${QR_SIZE} ${totalHeight}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    sizedQr +
    `<foreignObject x="0" y="${QR_SIZE + TEXT_GAP}" width="${QR_SIZE}" height="${textAreaHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="font-family: system-ui, sans-serif; font-size: 14px; line-height: ${LINE_HEIGHT}px; color: #0f172a; text-align: center; white-space: pre-wrap; overflow-wrap: break-word;">${escaped}</div>` +
    `</foreignObject>` +
    `</svg>`
  );
}

// Dispara la descarga del SVG como archivo — sin ida al servidor, el string
// ya tiene todo lo que necesita.
export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
