import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { formatDateOnly } from "../../design-system/detailFormat";
import { composeQrImage, downloadSvg, generateQrSvg } from "../../lib/qrImage";
import { BranchSelect } from "../branch/BranchSelect";
import { MAX_EXPIRES_IN_DAYS, MAX_LABEL_LENGTH } from "./labels";
import { useCreateVoucher, useSendVoucherWhatsapp } from "./mutations";
import { useVoucherWhatsappStatus } from "./queries";
import type { Voucher } from "./types";

// ---------------------------------------------------------------------------
// "Crear cupón" a mano, desde la ficha del contacto o de la oportunidad. Dos
// pasos en el mismo diálogo:
//   1. El formulario: descuento (texto), vence a los N días y sucursal. Las
//      mismas validaciones que la regla las decide el backend (400 con el
//      motivo); acá solo los topes obvios de los inputs.
//   2. El resultado: el link (copiar), el QR (ver/descargar, generado en el
//      cliente como en QrImageDialog) y "Enviar por WhatsApp", deshabilitado
//      con la explicación si no se puede (sin teléfono, ventana de 24 h
//      cerrada: no hay plantilla para envíos manuales).
// ---------------------------------------------------------------------------

const FORM_ID = "create-voucher-form";
const CONFIRMACION_MS = 2000;

export interface CreateVoucherDialogProps {
  // Una de las dos: desde la ficha del contacto, o desde la de la oportunidad
  // (el contacto es el de la oportunidad).
  contactId?: string;
  opportunityId?: string;
  // La sucursal ya elegida al abrir (B5: desde la conversación, la suya). Se
  // puede cambiar igual.
  branchIdInicial?: string;
  onClose: () => void;
}

export function CreateVoucherDialog({
  contactId,
  opportunityId,
  branchIdInicial,
  onClose,
}: CreateVoucherDialogProps) {
  const crear = useCreateVoucher();
  const [label, setLabel] = useState("");
  const [dias, setDias] = useState("30");
  const [branchId, setBranchId] = useState<string | undefined>(branchIdInicial);

  if (crear.data) {
    return <VoucherResult voucher={crear.data} onClose={onClose} />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId) return;
    crear.mutate({
      ...(contactId ? { contactId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
      label: label.trim(),
      expiresInDays: Number(dias),
      branchId,
    });
  }

  const listo = label.trim().length > 0 && Number(dias) >= 1 && branchId !== undefined;

  return (
    <Modal
      title="Crear cupón"
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: "Crear cupón",
        formId: FORM_ID,
        disabled: !listo,
        loading: crear.isPending,
      }}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="ds-stack">
        <FormField label={<span className="ds-required">Descuento</span>}>
          <input
            type="text"
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="15% de descuento en el taller"
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </FormField>
        <FormField label={<span className="ds-required">Vence a los (días)</span>}>
          <input
            type="number"
            min={1}
            max={MAX_EXPIRES_IN_DAYS}
            step={1}
            value={dias}
            onChange={(event) => setDias(event.target.value)}
            required
          />
        </FormField>
        <BranchSelect
          id="create-voucher-branch"
          label="Sucursal"
          value={branchId}
          onChange={(id) => setBranchId(id || undefined)}
          required
        />
        <p className="ds-hint">El WhatsApp con el cupón sale del número de esta sucursal.</p>
        {crear.error ? (
          <ErrorState>
            No pudimos crear el cupón
            {crear.error instanceof Error ? `: ${crear.error.message}` : "."}
          </ErrorState>
        ) : null}
      </form>
    </Modal>
  );
}

interface Imagen {
  svg: string | null;
  error: string | null;
}

function VoucherResult({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const [imagen, setImagen] = useState<Imagen | null>(null);
  const [verQr, setVerQr] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const estado = useVoucherWhatsappStatus(voucher.id);
  const enviar = useSendVoucherWhatsapp(voucher.id);

  useEffect(() => {
    let active = true;
    generateQrSvg(voucher.publicUrl)
      .then((svg) => {
        if (active) setImagen({ svg: composeQrImage(svg, voucher.label), error: null });
      })
      .catch((err: unknown) => {
        if (active) {
          setImagen({
            svg: null,
            error: err instanceof Error ? err.message : "No pudimos generar el QR.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [voucher.publicUrl, voucher.label]);

  useEffect(() => {
    if (!copiado) return;
    const timeout = setTimeout(() => setCopiado(false), CONFIRMACION_MS);
    return () => clearTimeout(timeout);
  }, [copiado]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(voucher.publicUrl);
      setCopiado(true);
    } catch {
      // Sin portapapeles: el link queda abajo como texto seleccionable.
      setCopiado(false);
    }
  }

  const enviado = enviar.data;
  const motivo = estado.data && !estado.data.disponible ? estado.data.motivo : null;

  return (
    <Modal title="Cupón creado" onClose={onClose} closeLabel="Listo">
      <div className="ds-stack">
        <p>
          <strong>{voucher.label}</strong> · vence el {formatDateOnly(voucher.expiresAt)}
        </p>

        <label className="ds-field">
          <span className="ds-field-label">Link del cupón</span>
          <input
            type="text"
            value={voucher.publicUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <div className="ds-card-actions">
          <Button onClick={() => void handleCopy()}>{copiado ? "¡Copiado!" : "Copiar link"}</Button>
          <Button onClick={() => setVerQr((v) => !v)} disabled={!imagen?.svg}>
            {verQr ? "Ocultar QR" : "Ver QR"}
          </Button>
          <Button
            onClick={() => downloadSvg(imagen?.svg ?? "", `cupon-${voucher.id}.svg`)}
            disabled={!imagen?.svg}
          >
            Descargar QR
          </Button>
        </div>
        {imagen === null ? <LoadingState>Generando QR…</LoadingState> : null}
        {imagen?.error ? <ErrorState>{imagen.error}</ErrorState> : null}
        {verQr && imagen?.svg ? (
          // Seguro: el svg viene de composeQrImage(generateQrSvg(url), label),
          // que escapa el texto; la URL la arma el backend con el id.
          <div data-testid="voucher-qr" dangerouslySetInnerHTML={{ __html: imagen.svg }} />
        ) : null}

        <div>
          <Button
            variant="primary"
            onClick={() => enviar.mutate()}
            disabled={!estado.data?.disponible || enviar.isPending || enviado !== undefined}
            loading={enviar.isPending}
          >
            {enviado ? "Enviado" : "Enviar por WhatsApp"}
          </Button>
        </div>
        {estado.isLoading ? <p className="ds-hint">Revisando si se puede mandar…</p> : null}
        {motivo ? (
          <p className="ds-hint" role="note">
            {motivo}
          </p>
        ) : null}
        {estado.data?.disponible && !enviado ? (
          <p className="ds-hint">Sale por WhatsApp como mensaje tuyo y queda en la conversación.</p>
        ) : null}
        {enviado?.deliveryStatus === "FAILED" ? (
          <ErrorState>
            WhatsApp no aceptó el mensaje
            {enviado.deliveryError ? `: ${enviado.deliveryError}` : "."} Podés reintentarlo desde la
            conversación.
          </ErrorState>
        ) : null}
        {enviado && enviado.deliveryStatus !== "FAILED" ? (
          <p className="ds-hint">Listo: el cupón quedó en la conversación.</p>
        ) : null}
        {enviar.error ? (
          <ErrorState>
            No pudimos mandarlo
            {enviar.error instanceof Error ? `: ${enviar.error.message}` : "."}
          </ErrorState>
        ) : null}
        {estado.error ? (
          <ErrorState>No pudimos revisar si se puede mandar por WhatsApp.</ErrorState>
        ) : null}
      </div>
    </Modal>
  );
}
