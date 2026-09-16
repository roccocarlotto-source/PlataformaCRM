import { useCountUp } from "../lib/useCountUp";

export interface AnimatedNumberProps {
  // El número real. `null` cuando no hay número que mostrar (se pinta
  // `fallback`).
  value: number | null;
  // Formatea tanto el valor final como cada frame intermedio del conteo, así
  // que tiene que ser la MISMA función que produce el texto final — si no, el
  // último frame y el valor asentado se verían distintos.
  format: (n: number) => string;
  // Lo que se muestra mientras `value` es `null` (p. ej. el "—" de la tasa de
  // cierre sin nada cerrado).
  fallback: string;
  durationMs?: number;
  // Ver useCountUp: false hace que la llegada del número sea directa. Lo usa
  // quien sabe, mejor que esta instancia, que la animación ya ocurrió.
  animate?: boolean;
}

// ---------------------------------------------------------------------------
// Número que cuenta desde 0 la primera vez que aparece (§37 de
// docs/frontend-cambios-pendientes.md). Solo el texto: el elemento que lo
// envuelve (y su clase, p. ej. .ds-kpi-value) lo pone el consumidor, igual
// que PhoneNumber. Toda la lógica de cuándo contar vive en useCountUp.
// ---------------------------------------------------------------------------
export function AnimatedNumber({
  value,
  format,
  fallback,
  durationMs,
  animate,
}: AnimatedNumberProps) {
  const display = useCountUp(value, { durationMs, animate });
  return <>{display === null ? fallback : format(display)}</>;
}
