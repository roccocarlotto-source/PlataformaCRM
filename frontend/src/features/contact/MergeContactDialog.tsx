import { useState } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { useConfirm } from "../../design-system/useConfirm";
import { ContactSelect } from "../opportunity/ContactSelect";
import {
  CAMPOS_DE_LA_UNION,
  ETIQUETA_DEL_CAMPO,
  ETIQUETA_DE_LO_QUE_SE_MUEVE,
  useMergeContacts,
  useMergePreview,
  valorParaMostrar,
  type Elecciones,
  type ResultadoDeLaUnion,
} from "./merge";

// ---------------------------------------------------------------------------
// "Unir con otro contacto", desde la ficha (solo ADMIN). Tres pasos en el
// mismo diálogo:
//   1. Buscar el duplicado (ContactSelect, la búsqueda de siempre).
//   2. Vista previa lado a lado: para cada campo, qué valor queda (por
//      defecto el más reciente no vacío, lo decide el backend), y qué se va a
//      mover al contacto que queda.
//   3. "Unir", con ConfirmDialog: no se puede deshacer desde la pantalla.
// El contacto de esta ficha es el que QUEDA; el otro se da de baja.
// ---------------------------------------------------------------------------

export interface MergeContactDialogProps {
  contactId: string;
  onClose: () => void;
  onMerged: (resultado: ResultadoDeLaUnion) => void;
}

export function MergeContactDialog({ contactId, onClose, onMerged }: MergeContactDialogProps) {
  const confirm = useConfirm();
  const [otroId, setOtroId] = useState<string | undefined>(undefined);
  // Solo lo que el usuario cambió; el resto es el default del backend. Se
  // vacía al elegir otro duplicado.
  const [cambios, setCambios] = useState<Partial<Elecciones>>({});
  const preview = useMergePreview(contactId, otroId);
  const unir = useMergeContacts(contactId);
  const elecciones: Elecciones | null = preview.data
    ? { ...preview.data.defaults, ...cambios }
    : null;

  function elegirOtro(id: string) {
    setOtroId(id);
    setCambios({});
  }

  const mismo = otroId === contactId;
  const vista = preview.data;

  async function handleUnir() {
    if (!vista || !elecciones || !otroId) return;
    const nombre = `${vista.absorbed.firstName} ${vista.absorbed.lastName}`.trim();
    const ok = await confirm(
      `Se va a unir "${nombre}" a este contacto: todo lo suyo pasa acá y "${nombre}" se da de baja. No se puede deshacer desde la pantalla.`,
      { confirmLabel: "Unir", danger: true },
    );
    if (!ok) return;
    unir.mutate({ absorbedId: otroId, fields: elecciones }, { onSuccess: onMerged });
  }

  const aMover = vista ? Object.entries(vista.aMover).filter(([, n]) => n > 0) : [];

  return (
    <Modal
      title="Unir con otro contacto"
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: "Unir",
        onClick: () => void handleUnir(),
        disabled: !vista || !elecciones || mismo,
        loading: unir.isPending,
        variant: "danger",
      }}
    >
      <div className="ds-stack">
        <p className="ds-hint">
          Este contacto es el que queda. El que elijas se da de baja y todo lo suyo pasa acá.
        </p>
        <ContactSelect
          id="merge-contact-other"
          label="Contacto duplicado"
          value={otroId}
          onChange={elegirOtro}
        />
        {mismo ? <ErrorState>Elegí otro contacto: es el mismo de esta ficha.</ErrorState> : null}
        {preview.isLoading && otroId && !mismo ? <LoadingState variant="lines" /> : null}
        {preview.error ? (
          <ErrorState>
            No pudimos cargar la vista previa
            {preview.error instanceof Error ? `: ${preview.error.message}` : "."}
          </ErrorState>
        ) : null}

        {vista && elecciones ? (
          <>
            {/* Un bloque por campo, con las dos opciones una debajo de la otra: el
                panel es angosto y una tabla de tres columnas no entra. */}
            <div className="ds-stack" role="group" aria-label="Qué valor queda en cada campo">
              {CAMPOS_DE_LA_UNION.map((campo) => (
                <div
                  key={campo}
                  className="ds-field"
                  role="radiogroup"
                  aria-label={ETIQUETA_DEL_CAMPO[campo]}
                >
                  <span className="ds-field-label">{ETIQUETA_DEL_CAMPO[campo]}</span>
                  {(["kept", "absorbed"] as const).map((lado) => {
                    const valor = valorParaMostrar(
                      lado === "kept" ? vista.kept : vista.absorbed,
                      campo,
                    );
                    return (
                      <label key={lado}>
                        <input
                          type="radio"
                          name={`merge-${campo}`}
                          checked={elecciones[campo] === lado}
                          onChange={() => setCambios({ ...cambios, [campo]: lado })}
                          aria-label={`${ETIQUETA_DEL_CAMPO[campo]}: ${lado === "kept" ? "este contacto" : "el duplicado"}`}
                        />{" "}
                        {lado === "kept" ? "Este: " : "Duplicado: "}
                        {valor || "—"}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="ds-hint">
              Las notas y los datos extra que juntó el agente no se eligen: se suman.
            </p>
            {aMover.length > 0 ? (
              <div>
                <p>Pasan a este contacto:</p>
                <ul>
                  {aMover.map(([clave, n]) => (
                    <li key={clave}>
                      {n} {ETIQUETA_DE_LO_QUE_SE_MUEVE[clave] ?? clave}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="ds-hint">El duplicado no tiene registros asociados.</p>
            )}
          </>
        ) : null}

        {unir.error ? (
          <ErrorState>
            No pudimos unir los contactos
            {unir.error instanceof Error ? `: ${unir.error.message}` : "."}
          </ErrorState>
        ) : null}
      </div>
    </Modal>
  );
}
