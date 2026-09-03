import { useEffect, useState } from "react";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { buildPublicResolutionUrl } from "../../lib/publicUrl";
import { composeQrImage, downloadSvg, generateQrSvg } from "../../lib/qrImage";
import type { QrCode } from "./types";

// ---------------------------------------------------------------------------
// Ver/descargar la imagen de un QR. Se genera on-demand, del lado del cliente,
// con el message ACTUAL del QR (nunca cacheado): si se edita y se vuelve a
// abrir, refleja el valor nuevo. Sin Storage, sin backend (DEC-054 original).
// El QR codifica únicamente la URL pública de resolución — editar nombre/
// destino/mensaje nunca requiere regenerarlo ni reimprimirlo.
//
// Sin mutación de TanStack Query: es una transformación pura de datos que ya
// están en el cache de useQrCodes, así que el hallazgo S2-4 (reset() de
// apiKey) no aplica; si alguna vez este diálogo hace una llamada de red
// propia, revisar ese hallazgo antes de reusar el patrón.
// ---------------------------------------------------------------------------

const CONFIRMACION_MS = 2000;

interface Imagen {
  svg: string | null;
  error: string | null;
}

export interface QrImageDialogProps {
  qr: QrCode;
  onClose: () => void;
}

export function QrImageDialog({ qr, onClose }: QrImageDialogProps) {
  const [imagen, setImagen] = useState<Imagen | null>(null);
  const [copiado, setCopiado] = useState(false);

  // buildPublicResolutionUrl tira si el id no es uuid — no puede pasar con
  // una fila del backend, pero si pasara, es un error a mostrar, no un crash
  // del listado entero.
  let publicUrl: string | null = null;
  let urlError: string | null = null;
  try {
    publicUrl = buildPublicResolutionUrl(qr.id);
  } catch (err) {
    urlError = err instanceof Error ? err.message : "No se pudo construir el link.";
  }

  useEffect(() => {
    if (publicUrl === null) return;
    let active = true;
    generateQrSvg(publicUrl)
      .then((svg) => {
        if (active) setImagen({ svg: composeQrImage(svg, qr.message), error: null });
      })
      .catch((err: unknown) => {
        if (active) {
          setImagen({
            svg: null,
            error: err instanceof Error ? err.message : "No se pudo generar la imagen del QR.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [publicUrl, qr.message]);

  useEffect(() => {
    if (!copiado) return;
    const timeout = setTimeout(() => setCopiado(false), CONFIRMACION_MS);
    return () => clearTimeout(timeout);
  }, [copiado]);

  async function handleCopy() {
    if (publicUrl === null) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopiado(true);
    } catch {
      // Sin portapapeles (contexto no seguro o permiso denegado): el link está
      // abajo como texto seleccionable, ese es el respaldo — mismo criterio
      // que ApiKeySecretDialog.
      setCopiado(false);
    }
  }

  const titulo = `QR ${qr.displayNumber ?? "—"}${qr.name ? ` — ${qr.name}` : ""}`;

  return (
    <Modal title={titulo} onClose={onClose} closeLabel="Cerrar">
      {urlError ? <ErrorState>{urlError}</ErrorState> : null}
      {publicUrl !== null && imagen === null ? (
        <LoadingState>Generando imagen…</LoadingState>
      ) : null}
      {imagen?.error ? <ErrorState>{imagen.error}</ErrorState> : null}
      {imagen?.svg ? (
        <>
          {/* Seguro: el svg viene únicamente de composeQrImage(generateQrSvg(url), message)
              — la URL la armamos nosotros y el mensaje se escapa antes de
              interpolarse, nunca markup de terceros. */}
          <div data-testid="qr-image" dangerouslySetInnerHTML={{ __html: imagen.svg }} />
          <Button onClick={() => downloadSvg(imagen.svg ?? "", `qr-${qr.id}.svg`)}>
            Descargar imagen
          </Button>
        </>
      ) : null}
      {publicUrl !== null ? (
        <>
          <label className="ds-field">
            <span className="ds-field-label">Link público</span>
            <input
              type="text"
              value={publicUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <Button onClick={() => void handleCopy()}>{copiado ? "¡Copiado!" : "Copiar link"}</Button>
        </>
      ) : null}
    </Modal>
  );
}
