import { useRef, useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { MobileScreen } from "../../design-system/MobileScreen";
import { formatDateTime } from "../../design-system/detailFormat";
import { ApiError } from "../../lib/api";
import { useRedeemVoucher } from "./mutations";
import { QrCameraReader } from "./QrCameraReader";
import type { RedeemedVoucher } from "./types";
import { extractVoucherId } from "./voucherId";

// Cuánto tiene que pasar SIN ver un código para volver a procesarlo. La
// cámara lee el mismo QR varias veces por segundo mientras siga enfrente: sin
// esto, un canje exitoso se pisaría enseguida con el 409 de "ya canjeado"
// del cuadro siguiente. Se cuenta desde la última vez que se lo vio, no desde
// el canje: mientras el celular del cliente siga frente a la cámara, se
// ignora; al sacarlo, el mismo código se puede volver a escanear.
const OLVIDO_MS = 3000;

type Resultado = { tipo: "canjeado"; cupon: RedeemedVoucher } | { tipo: "error"; mensaje: string };

// El mensaje del backend tal cual (canjearDiscountVoucher). En un 409 se le
// agrega el cuándo que viene en `error` (consumedAt o expiresAt, ítem 176).
function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "No pudimos canjear el cupón.";
  }
  const cuando = error.details?.consumedAt ?? error.details?.expiresAt;
  return typeof cuando === "string"
    ? `${error.message} (${formatDateTime(cuando)})`
    : error.message;
}

// ---------------------------------------------------------------------------
// Pantalla de mostrador para canjear cupones de descuento (ítem 178; backend
// en el 176). El empleado apunta la cámara al QR que el cliente muestra en su
// celular (la página de GET /vouchers/resolve/:id), y se canjea con
// POST /api/vouchers/:id/redeem. Cualquier usuario de la organización puede:
// el backend no restringe por rol, y esta pantalla tampoco.
//
// FUERA DE AppLayout, mismo criterio que el chat del agente interno (ítem
// 180): se usa desde el celular y la sidebar no colapsa. Mismo MobileScreen.
//
// La cámara queda prendida entre canje y canje: el resultado del último queda
// a la vista y el siguiente QR se procesa apenas aparece, sin tocar nada.
// Sin cámara (o sin permiso), el link o el id se pegan a mano en el campo de
// abajo — que está siempre, por si la cámara no enfoca.
// ---------------------------------------------------------------------------
export function VoucherScanPage() {
  const canjear = useRedeemVoucher();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [sinCamara, setSinCamara] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // Refs y no estado: el lector llama a handleDecode varias veces por segundo
  // y la decisión tiene que ver el valor de este instante, no el del render.
  const enCurso = useRef(false);
  const ultimoLeido = useRef<{ texto: string; vistoEn: number } | null>(null);

  async function procesar(texto: string) {
    if (enCurso.current) return;
    const id = extractVoucherId(texto);
    if (id === null) {
      setResultado({ tipo: "error", mensaje: "Este código no es un cupón." });
      return;
    }
    enCurso.current = true;
    try {
      const cupon = await canjear.mutateAsync(id);
      setResultado({ tipo: "canjeado", cupon });
    } catch (error) {
      setResultado({ tipo: "error", mensaje: mensajeDeError(error) });
    } finally {
      enCurso.current = false;
    }
  }

  function handleDecode(texto: string) {
    const ahora = Date.now();
    const previo = ultimoLeido.current;
    if (previo && previo.texto === texto && ahora - previo.vistoEn < OLVIDO_MS) {
      previo.vistoEn = ahora;
      return;
    }
    if (enCurso.current) return;
    ultimoLeido.current = { texto, vistoEn: ahora };
    void procesar(texto);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const texto = manual.trim();
    if (texto.length === 0) return;
    setManual("");
    void procesar(texto);
  }

  return (
    <MobileScreen title="Canjear cupón">
      <div className="ds-voucher-scan">
        {sinCamara === null ? (
          <>
            <QrCameraReader onDecode={handleDecode} onUnavailable={setSinCamara} />
            <p className="ds-hint">Apuntá la cámara al QR del cupón.</p>
          </>
        ) : (
          <p className="ds-hint">{sinCamara} Pegá o tipeá el link del cupón abajo.</p>
        )}

        {canjear.isPending ? (
          <p role="status">Canjeando…</p>
        ) : resultado?.tipo === "canjeado" ? (
          <div role="status" className="ds-voucher-scan-ok">
            <strong>Cupón canjeado</strong>
            <span className="ds-voucher-scan-label">{resultado.cupon.label}</span>
          </div>
        ) : resultado?.tipo === "error" ? (
          <ErrorState>{resultado.mensaje}</ErrorState>
        ) : null}

        <form className="ds-voucher-scan-form" onSubmit={handleSubmit}>
          <FormField label="Link o código del cupón">
            <input
              type="text"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </FormField>
          <Button
            type="submit"
            variant="primary"
            disabled={canjear.isPending || manual.trim().length === 0}
          >
            Canjear
          </Button>
        </form>
      </div>
    </MobileScreen>
  );
}
