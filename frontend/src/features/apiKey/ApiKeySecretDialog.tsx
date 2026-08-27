import { useEffect, useRef, useState } from "react";
import { Button } from "../../design-system/Button";
import { Modal } from "../../design-system/Modal";

// ---------------------------------------------------------------------------
// El cuadro que muestra el secreto recién creado. Usa el Modal genérico y le
// pone adentro lo único que es de este dominio: la advertencia, el campo con la
// clave y el botón de copiar.
//
// La clave llega por prop y NO se guarda en ningún lado más: ni en el cache de
// TanStack Query (no hay queryKey donde caiga), ni en estado del padre más allá
// de lo que dura este componente montado. Cerrar el modal la borra del árbol y
// no queda forma de volver a leerla — que es exactamente lo que promete el
// backend, donde solo vive el hash.
// ---------------------------------------------------------------------------

// Cuánto dura el "¡Copiada!" antes de volver a "Copiar". Dos segundos: suficiente
// para leerlo, corto para no dejar el botón mintiendo si alguien copia otra cosa
// en el medio.
const CONFIRMACION_MS = 2000;

export interface ApiKeySecretDialogProps {
  apiKey: string;
  sourceName: string;
  onClose: () => void;
}

export function ApiKeySecretDialog({ apiKey, sourceName, onClose }: ApiKeySecretDialogProps) {
  const [copiada, setCopiada] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si el modal se cierra mientras el "¡Copiada!" está en pantalla, el timer
  // quedaría vivo apuntando a un componente desmontado.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiada(true);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopiada(false), CONFIRMACION_MS);
    } catch {
      // navigator.clipboard no existe (contexto no seguro) o el permiso fue
      // denegado. NO se muestra un error: el campo de abajo es de solo lectura
      // pero seleccionable, así que copiar a mano sigue funcionando y es el
      // respaldo. Un mensaje de error acá asustaría sobre algo que no impide
      // completar la tarea.
      setCopiada(false);
    }
  }

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

      <Button onClick={() => void handleCopy()}>{copiada ? "¡Copiada!" : "Copiar"}</Button>
    </Modal>
  );
}
