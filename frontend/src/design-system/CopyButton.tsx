import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// Botón que copia un texto al portapapeles y lo confirma cambiando su propio
// rótulo por dos segundos. Nació dentro de ApiKeySecretDialog (una sola clave
// que copiar) y se promovió acá al aparecer el ítem 63, que tiene dos lugares
// más para copiar en una misma pantalla —el token de embed recién generado y
// el snippet del <script>—: tres consumidores es exactamente el umbral con
// el que se promovieron Badge y Avatar.
//
// EL FALLO DEL PORTAPAPELES NO SE MUESTRA COMO ERROR, y es la decisión que
// hay que conservar al reusarlo: navigator.clipboard no existe fuera de un
// contexto seguro y el permiso se puede denegar, pero en todos los usos de
// este botón el texto está visible y seleccionable al lado, así que copiar a
// mano sigue funcionando. Un cartel de error asustaría sobre algo que no
// impide completar la tarea. Lo único que pasa es que el botón no confirma.
// ---------------------------------------------------------------------------

// Cuánto dura la confirmación antes de volver al rótulo normal. Dos segundos:
// suficiente para leerlo, corto para no dejar el botón mintiendo si alguien
// copia otra cosa en el medio.
const CONFIRMACION_MS = 2000;

export interface CopyButtonProps {
  // El texto que se copia. No se lee del DOM a propósito: el valor mostrado
  // puede estar recortado o formateado y lo que se copia tiene que ser el
  // dato entero.
  text: string;
  label?: string;
  // El rótulo de la confirmación. Se pasa entero y no se arma con el género
  // del sustantivo: "¡Copiada!" (una clave) y "¡Copiado!" (un token) son dos
  // textos, no una regla.
  confirmLabel?: string;
  disabled?: boolean;
}

export function CopyButton({
  text,
  label = "Copiar",
  confirmLabel = "¡Copiado!",
  disabled,
}: CopyButtonProps) {
  const [copiado, setCopiado] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si el botón se desmonta mientras la confirmación está en pantalla (se
  // cierra el diálogo, se navega), el timer quedaría vivo apuntando a un
  // componente desmontado.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiado(true);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopiado(false), CONFIRMACION_MS);
    } catch {
      // Ver el bloque de arriba: sin error visible, el texto de al lado es el
      // respaldo.
      setCopiado(false);
    }
  }

  return (
    <Button onClick={() => void handleCopy()} disabled={disabled}>
      {copiado ? confirmLabel : label}
    </Button>
  );
}
