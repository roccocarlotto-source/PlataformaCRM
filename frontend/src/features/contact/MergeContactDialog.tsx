import { useState } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { useConfirm } from "../../design-system/useConfirm";
import { ContactSelect } from "../opportunity/ContactSelect";
import {
  advertenciaDeLaUnion,
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
//
// DOS MODOS (ítem 184). Desde la ficha, `modo="queda"`: este contacto queda y
// se elige el duplicado que se le une. Desde Consultas sin identificar,
// `modo="seUne"`: esta consulta es la que se une a un contacto existente, que
// es el que se elige y el que queda. El backend es el mismo (:id es el que
// queda); acá solo cambia cuál de los dos ids es cuál.
// ---------------------------------------------------------------------------

export interface MergeContactDialogProps {
  contactId: string;
  modo?: "queda" | "seUne";
  onClose: () => void;
  onMerged: (resultado: ResultadoDeLaUnion) => void;
}

export function MergeContactDialog({
  contactId,
  modo = "queda",
  onClose,
  onMerged,
}: MergeContactDialogProps) {
  const confirm = useConfirm();
  const [otroId, setOtroId] = useState<string | undefined>(undefined);
  // Solo lo que el usuario cambió; el resto es el default del backend. Se
  // vacía al elegir otro duplicado.
  const [cambios, setCambios] = useState<Partial<Elecciones>>({});
  const seUne = modo === "seUne";
  // El que queda y el que se une, según el modo. Sin elegir todavía, el
  // propio contacto ocupa los dos lugares: useMergePreview no consulta hasta
  // que haya dos distintos, y useMergeContacts solo se usa al unir.
  const keptId = seUne ? (otroId ?? contactId) : contactId;
  const absorbedId = seUne ? contactId : otroId;
  const preview = useMergePreview(keptId, absorbedId);
  const unir = useMergeContacts(keptId);
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
    if (!vista || !elecciones || !otroId || !absorbedId) return;
    const nombre = `${vista.absorbed.firstName} ${vista.absorbed.lastName}`.trim();
    // La advertencia dice QUÉ se mueve (conversaciones, cupones, tareas,
    // oportunidades…) y qué se corta, no solo que "todo pasa acá".
    const ok = await confirm(advertenciaDeLaUnion(nombre, vista), {
      confirmLabel: "Unir",
      danger: true,
    });
    if (!ok) return;
    unir.mutate({ absorbedId, fields: elecciones }, { onSuccess: onMerged });
  }

  const aMover = vista ? Object.entries(vista.aMover).filter(([, n]) => n > 0) : [];

  return (
    <Modal
      title={seUne ? "Unir con un contacto existente" : "Unir con otro contacto"}
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
          {seUne
            ? "La consulta se da de baja y todo lo suyo pasa al contacto elegido."
            : "El contacto elegido se da de baja y todo lo suyo pasa acá."}
        </p>
        <ContactSelect
          id="merge-contact-other"
          label={seUne ? "Contacto existente" : "Contacto duplicado"}
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
                          aria-label={`${ETIQUETA_DEL_CAMPO[campo]}: ${lado === "kept" ? (seUne ? "el contacto existente" : "este contacto") : seUne ? "esta consulta" : "el duplicado"}`}
                        />{" "}
                        {lado === "kept"
                          ? seUne
                            ? "Existente: "
                            : "Este: "
                          : seUne
                            ? "Esta consulta: "
                            : "Duplicado: "}
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
