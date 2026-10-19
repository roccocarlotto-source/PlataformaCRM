import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { useRegistrarAviso } from "./mutations";
import type { AvisosDeLaOrden, MedioDeAviso } from "./types";

// ---------------------------------------------------------------------------
// "Avisar al cliente" (docs/servicios.md §8.1, S12). El texto sugerido,
// editable. Con la conversación de WhatsApp y la ventana de 24 h abierta, se
// abre la conversación con el texto puesto (al mandarlo, la orden registra el
// aviso sola). Si no, el aviso de la ventana, copiar y llamar. Siempre se
// puede marcar como avisado, con el medio.
// ---------------------------------------------------------------------------

const MEDIOS: { value: MedioDeAviso; label: string }[] = [
  { value: "TELEFONO", label: "Teléfono" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EN_PERSONA", label: "En persona" },
];

export function AvisarAlClienteDialog({
  ordenId,
  avisos,
  onClose,
}: {
  ordenId: string;
  avisos: AvisosDeLaOrden;
  onClose: () => void;
}) {
  const formId = useId();
  const [texto, setTexto] = useState(avisos.sugerencia ?? "");
  const [medio, setMedio] = useState<MedioDeAviso>("TELEFONO");
  const [copiado, setCopiado] = useState(false);
  const registrar = useRegistrarAviso(ordenId);
  const conversacion = avisos.conversacion;
  const puedeEscribir = conversacion?.ventanaAbierta === true;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  function marcar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    registrar.mutate(medio, { onSuccess: onClose });
  }

  return (
    <Modal
      variant="dialog"
      title="Avisar al cliente"
      closeLabel="Cancelar"
      onClose={onClose}
      primaryAction={{
        label: "Marcar como avisado",
        formId,
        disabled: registrar.isPending,
        loading: registrar.isPending,
      }}
    >
      <form id={formId} onSubmit={marcar} className="ds-stack">
        <FormField label="Texto sugerido">
          <textarea value={texto} rows={4} onChange={(e) => setTexto(e.target.value)} />
        </FormField>

        {puedeEscribir ? (
          <p>
            <Link
              className="ds-link-button"
              to={`/conversations/${conversacion.id}?borrador=${encodeURIComponent(texto)}&orden=${ordenId}`}
            >
              Abrir la conversación
            </Link>
          </p>
        ) : (
          <p className="ds-hint">
            {conversacion
              ? "Pasaron más de 24 h desde su último mensaje: no se puede mandar por WhatsApp."
              : "El cliente no tiene una conversación de WhatsApp."}
          </p>
        )}

        <p>
          <Button type="button" onClick={() => void copiar()}>
            {copiado ? "Copiado" : "Copiar el texto"}
          </Button>{" "}
          {avisos.telefono ? (
            <a className="ds-link-button" href={`tel:${avisos.telefono}`}>
              Llamar
            </a>
          ) : null}
        </p>

        <fieldset className="ds-stack">
          <legend className="ds-field-label">Si ya le avisaste, ¿por qué medio?</legend>
          {MEDIOS.map((m) => (
            <label key={m.value}>
              <input
                type="radio"
                name="medio"
                checked={medio === m.value}
                onChange={() => setMedio(m.value)}
              />{" "}
              {m.label}
            </label>
          ))}
        </fieldset>
        {registrar.isError ? (
          <ErrorState>
            {registrar.error instanceof Error
              ? registrar.error.message
              : "No pudimos registrar el aviso."}
          </ErrorState>
        ) : null}
      </form>
    </Modal>
  );
}
