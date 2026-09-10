import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { ToastContext, type ToastContextValue } from "./useToast";

// ---------------------------------------------------------------------------
// Toast: un cartelito chico que confirma que algo se guardó ("Pipeline
// guardado", "Etapa guardada") y se va solo después de unos segundos. Es un
// primitivo de UI —aparece, se lee, desaparece— y por eso vive acá y no en el
// feature que lo estrenó, igual que Modal y ActionsMenu.
//
// POR QUÉ EXISTE: hasta ahora la confirmación de un guardado era la
// navegación misma (crear → volver a la lista). El editor de etapas integrado
// en el formulario de Pipeline (docs/frontend-cambios-pendientes.md §11) rompe
// eso dos veces: guardar un pipeline nuevo se queda en la página, y cada
// etapa se guarda al toque sin ir a ningún lado. Sin una señal explícita, el
// usuario no sabría que funcionó (§12).
//
// DOS PIEZAS. `Toast` es el cartel en sí: recibe el mensaje y llama a
// `onDismiss` cuando se vence su tiempo (o cuando se hace click en la "×").
// `ToastProvider` es quien lo monta: guarda el mensaje activo, expone `show()`
// vía contexto (useToast.ts) y renderiza el cartel en una región fija de la
// pantalla. El provider va en App.tsx, por ENCIMA del router, a propósito: un
// toast disparado justo antes de navegar (guardar un pipeline existente vuelve
// a la lista) tiene que sobrevivir al cambio de página, y un estado local a la
// página se perdería con ella.
//
// UNO A LA VEZ. Un `show()` nuevo reemplaza al toast visible y reinicia su
// tiempo; no se apilan. Alcanza para el uso actual (confirmaciones cortas y
// espaciadas por una acción de la persona) y evita una columna de carteles
// cuando alguien agrega cinco etapas seguidas. El reemplazo se logra con
// `key={id}`: el mismo mensaje dos veces seguidas ("Etapa guardada", "Etapa
// guardada") es un id nuevo, así que el cartel se remonta y el temporizador
// arranca de cero.
//
// SOLO CONFIRMACIONES. Hoy no hay variantes (error, aviso): los errores de la
// app siguen siendo un ErrorState en su lugar, que no se va solo — un error
// que desaparece a los cuatro segundos es peor que uno que se queda. Si
// aparece un consumidor que necesite otra variante, se agrega una prop
// `variant` como en Badge; no se anticipa.
//
// ACCESIBILIDAD: la región del provider es role="status" (aria-live polite
// implícito) y existe SIEMPRE, vacía o no. Un lector de pantalla anuncia lo
// que se inserta en una región viva que ya estaba en el DOM; una región que
// se monta junto con su contenido suele pasar desapercibida. La "×" es un
// cierre explícito para quien no quiere esperar; el temporizador sigue
// corriendo aunque el mouse esté encima (mantenerlo vivo con hover es una
// mejora posible, no una necesidad de hoy).
//
// POSICIÓN (design-system.css, bloque "Toast"): fijo abajo a la derecha, por
// encima del overlay de Modal (z-index 200 > 100) para que una confirmación
// disparada desde un panel también se vea. Es la única pieza del sistema con
// una animación de entrada (opacidad + 8px hacia arriba), apagada bajo
// prefers-reduced-motion.
// ---------------------------------------------------------------------------

// Tiempo de vida por defecto: lo que lleva leer un mensaje de dos o tres
// palabras con margen, sin quedarse tapando la esquina.
export const TOAST_DURATION_MS = 4000;

const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

export interface ToastProps {
  message: string;
  // Se llama cuando el toast debe desaparecer: al vencerse `duration` o al
  // click en la "×". Tiene que ser estable entre renders (el provider lo
  // memoiza): cambiarlo reinicia el temporizador.
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = TOAST_DURATION_MS }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div className="ds-toast">
      <CircleCheck {...ICON} className="ds-toast-icon" />
      <span className="ds-toast-message">{message}</span>
      <button
        type="button"
        className="ds-toast-close"
        onClick={onDismiss}
        aria-label="Cerrar aviso"
      >
        ×
      </button>
    </div>
  );
}

interface ActiveToast {
  id: number;
  message: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveToast | null>(null);
  // Contador y no Date.now(): dos show() en el mismo milisegundo tienen que
  // ser dos ids distintos igual.
  const nextIdRef = useRef(0);

  const show = useCallback((message: string) => {
    nextIdRef.current += 1;
    setActive({ id: nextIdRef.current, message });
  }, []);

  const dismiss = useCallback(() => setActive(null), []);

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* La región existe siempre, ver ACCESIBILIDAD arriba. */}
      <div className="ds-toast-region" role="status">
        {active ? <Toast key={active.id} message={active.message} onDismiss={dismiss} /> : null}
      </div>
    </ToastContext.Provider>
  );
}
