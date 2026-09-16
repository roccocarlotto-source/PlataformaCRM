import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Conteo progresivo ("odómetro") de 0 hasta un número. Nace para los números
// grandes del Dashboard (§37 de docs/frontend-cambios-pendientes.md): que
// suban contando en vez de aparecer de golpe. Mismo espíritu que
// useContainerWidth: comportamiento de navegador, nada de estilo — el formato
// del número lo pone quien lo consume.
//
// Reglas:
//   - Devuelve `null` mientras `target` es `null` (nada que mostrar todavía).
//   - Solo la PRIMERA vez que `target` deja de ser `null` en la vida de la
//     instancia se cuenta, y solo si `animate` es true en ese momento y el
//     usuario no pidió `prefers-reduced-motion: reduce`. Cualquier cambio
//     posterior —incluido uno a mitad de un conteo— salta directo al valor
//     nuevo: la animación es de llegada, no de cada cambio de dato.
//   - `animate` existe para el consumidor que desmonta el número mientras
//     carga (las KPI del Dashboard, al cambiar de período): una instancia
//     nueva no sabe que la fila ya animó una vez, el padre sí.
//
// La decisión de contar se toma DURANTE el render (ajuste de estado en render,
// el patrón que documenta React para derivar estado de props) y no en un
// efecto: así el primer frame ya pinta el 0 y no hay un parpadeo del valor
// final antes de que arranque el conteo.
// ---------------------------------------------------------------------------

export const COUNT_UP_DURATION_MS = 900;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Mismo guard que theme.ts: sin matchMedia (navegador sin soporte) no hay
// preferencia declarada, y se anima.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// ease-out cubic: arranca rápido y frena al llegar, que es como se lee un
// cuentakilómetros que "se asienta" en el número.
function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

type CountUp =
  // Todavía no llegó ningún número.
  | { phase: "waiting" }
  // Contando hacia `to`; `current` es el valor del último frame.
  | { phase: "counting"; to: number; current: number }
  // Ya contó (o decidió no contar): se devuelve `target` tal cual.
  | { phase: "settled" };

export interface CountUpOptions {
  durationMs?: number;
  animate?: boolean;
}

export function useCountUp(
  target: number | null,
  { durationMs = COUNT_UP_DURATION_MS, animate = true }: CountUpOptions = {},
): number | null {
  const [state, setState] = useState<CountUp>({ phase: "waiting" });

  if (state.phase === "waiting" && target !== null) {
    setState(
      animate && !prefersReducedMotion()
        ? { phase: "counting", to: target, current: 0 }
        : { phase: "settled" },
    );
  } else if (state.phase === "counting" && target !== state.to) {
    // El dato cambió a mitad del conteo: se salta al nuevo, como cualquier
    // cambio posterior a la llegada.
    setState({ phase: "settled" });
  }

  const countingTo = state.phase === "counting" ? state.to : null;

  useEffect(() => {
    if (countingTo === null) return;
    let frameId = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / durationMs);
      if (progress < 1) {
        setState({
          phase: "counting",
          to: countingTo,
          current: countingTo * easeOutCubic(progress),
        });
        frameId = requestAnimationFrame(tick);
      } else {
        setState({ phase: "settled" });
      }
    };
    frameId = requestAnimationFrame(tick);
    // Desmontar a mitad del conteo no deja un frame pendiente.
    return () => cancelAnimationFrame(frameId);
  }, [countingTo, durationMs]);

  if (target === null) return null;
  return state.phase === "counting" ? state.current : target;
}
