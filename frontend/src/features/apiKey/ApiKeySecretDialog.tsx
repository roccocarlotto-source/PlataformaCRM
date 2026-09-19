import { CopyButton } from "../../design-system/CopyButton";
import { Modal } from "../../design-system/Modal";

// ---------------------------------------------------------------------------
// El cuadro que muestra el secreto recién creado. Usa el Modal genérico y le
// pone adentro lo único que es de este dominio: la advertencia, el campo con la
// clave y el botón de copiar.
//
// La clave llega por prop: no cae en ningún QueryCache (no hay queryKey donde
// caiga) ni se persiste. Cerrar el modal la borra del árbol de React.
//
// LO QUE ESO NO ALCANZABA A LIMPIAR, hasta el hallazgo S2-4 de
// docs/review-fase2-2026-08-28.md: el resultado de useCreateApiKey queda en el
// MutationCache como `.data`, con el secreto adentro, y desmontar este
// componente no lo toca. Por eso `onClose` no es solo "cerrar": el padre
// (ApiKeyListPage) llama además a `reset()` sobre la mutación. Recién ahí no
// queda forma de volver a leer la clave, que es lo que promete el backend,
// donde solo vive el hash.
//
// EL BOTÓN DE COPIAR es design-system/CopyButton desde el ítem 63, que lo
// estrenó con dos usos más en una misma pantalla. Lo que es propio de este
// dominio —la clave, la advertencia, el rótulo femenino de la confirmación—
// se quedó acá; copiar y confirmar no era de nadie en particular.
// ---------------------------------------------------------------------------

export interface ApiKeySecretDialogProps {
  apiKey: string;
  sourceName: string;
  onClose: () => void;
}

export function ApiKeySecretDialog({ apiKey, sourceName, onClose }: ApiKeySecretDialogProps) {
  return (
    <Modal title="Clave de ingesta creada" onClose={onClose} closeLabel="Listo, ya la guardé">
      <p role="alert" className="ds-error">
        Esta es la única vez que vas a poder ver esta clave. No se guarda en ningún lado: si la
        perdés, hay que revocarla y crear otra.
      </p>

      <p>
        Fuente: <strong>{sourceName}</strong>
      </p>

      <label className="ds-field">
        <span className="ds-field-label">Clave</span>
        {/* readOnly y no disabled: un input deshabilitado no se puede
            seleccionar, y seleccionar a mano es el respaldo cuando el
            portapapeles no está disponible. */}
        <input
          type="text"
          className="ds-secret"
          value={apiKey}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>

      <CopyButton text={apiKey} confirmLabel="¡Copiada!" />
    </Modal>
  );
}
