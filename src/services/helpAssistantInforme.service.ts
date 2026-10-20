import type { HelpAssistantOutcome } from "@prisma/client";
import { AYUDA } from "../compartido/guia/anclas";
import {
  preguntasFrecuentes,
  preguntasPorPantalla,
  preguntasRecientes,
  totalesPorResultado,
  type FiltroDelInforme,
  type PreguntaDelInforme,
  type PreguntaFrecuente,
} from "../repositories/helpAssistantQuestion.repository";
import { guiaDeUso } from "./guiaDeUso.service";

// ---------------------------------------------------------------------------
// "Preguntas a la ayuda" (Plataforma; docs-privados/asistente-de-ayuda-diseno.md
// §7.3, local): qué le preguntan al asistente "¿Cómo se hace?" en todas las
// organizaciones, para mejorar la guía y las pantallas. Solo el platform admin.
// Nunca dice quién preguntó ni de qué organización: el repositorio no
// devuelve organization_id ni user_id.
// ---------------------------------------------------------------------------

/** Los períodos que ofrece la pantalla. 90 es la retención: más atrás no hay. */
export const DIAS_DEL_INFORME = [7, 30, 90] as const;
export type DiasDelInforme = (typeof DIAS_DEL_INFORME)[number];

const RESULTADOS: readonly HelpAssistantOutcome[] = [
  "ANSWERED",
  "NOT_COVERED",
  "DATA_REDIRECT",
  "OFF_TOPIC",
  "ERROR",
];

export interface PantallaDelInforme {
  /** La clave de AYUDA; null = sin pantalla. */
  clave: string | null;
  /** El título del tema de la guía de esa pantalla. */
  titulo: string | null;
  preguntas: number;
}

export interface InformeDePreguntas {
  dias: DiasDelInforme;
  resumen: {
    preguntas: number;
    porResultado: Record<HelpAssistantOutcome, number>;
    utiles: number;
    noUtiles: number;
    /** De las que llegaron al modelo sin error, cuántas leyeron el caché. */
    conCache: number;
    /** null: ninguna pregunta del período informó costo. */
    costoUsd: number | null;
  };
  /** Por pantalla, con todos los filtros salvo el de pantalla: también son
   *  las opciones de ese filtro. */
  pantallas: PantallaDelInforme[];
  frecuentes: PreguntaFrecuente[];
  recientes: PreguntaDelInforme[];
}

export interface DepsDelInforme {
  totalesPorResultado: typeof totalesPorResultado;
  preguntasPorPantalla: typeof preguntasPorPantalla;
  preguntasFrecuentes: typeof preguntasFrecuentes;
  preguntasRecientes: typeof preguntasRecientes;
  ahora: () => Date;
}

const depsDelInforme: DepsDelInforme = {
  totalesPorResultado,
  preguntasPorPantalla,
  preguntasFrecuentes,
  preguntasRecientes,
  ahora: () => new Date(),
};

/** El título del tema de la guía al que lleva el "?" de esa pantalla. Primero
 *  la guía de siempre; si no está (una pantalla solo de clínica), la de
 *  clínicas. */
export function tituloDePantalla(clave: string | null): string | null {
  if (!clave || !Object.hasOwn(AYUDA, clave)) return null;
  const [slug, ancla] = AYUDA[clave as keyof typeof AYUDA].split("#");
  const { raiz, clinica } = guiaDeUso();
  for (const secciones of [raiz, clinica]) {
    const titulo = secciones
      .find((s) => s.slug === slug)
      ?.encabezados.find((e) => e.ancla === ancla)?.titulo;
    if (titulo) return titulo;
  }
  return null;
}

export interface FiltrosDelInforme extends Omit<FiltroDelInforme, "desde"> {
  dias: DiasDelInforme;
}

export async function informeDePreguntas(
  { dias, ...filtros }: FiltrosDelInforme,
  deps: DepsDelInforme = depsDelInforme,
): Promise<InformeDePreguntas> {
  const filtro: FiltroDelInforme = {
    ...filtros,
    desde: new Date(deps.ahora().getTime() - dias * 24 * 60 * 60 * 1000),
  };
  const [totales, pantallas, frecuentes, recientes] = await Promise.all([
    deps.totalesPorResultado(filtro),
    deps.preguntasPorPantalla(filtro),
    deps.preguntasFrecuentes(filtro),
    deps.preguntasRecientes(filtro),
  ]);

  const porResultado = Object.fromEntries(RESULTADOS.map((r) => [r, 0])) as Record<
    HelpAssistantOutcome,
    number
  >;
  let utiles = 0;
  let noUtiles = 0;
  let conCache = 0;
  let costoUsd: number | null = null;
  for (const fila of totales) {
    porResultado[fila.outcome] = fila.preguntas;
    utiles += fila.utiles;
    noUtiles += fila.noUtiles;
    if (fila.outcome !== "ERROR") conCache += fila.conCache;
    if (fila.costoUsd !== null) costoUsd = (costoUsd ?? 0) + fila.costoUsd;
  }

  return {
    dias,
    resumen: {
      preguntas: totales.reduce((suma, fila) => suma + fila.preguntas, 0),
      porResultado,
      utiles,
      noUtiles,
      conCache,
      costoUsd,
    },
    pantallas: pantallas.map((p) => ({
      clave: p.screen,
      titulo: tituloDePantalla(p.screen),
      preguntas: p.preguntas,
    })),
    frecuentes,
    recientes,
  };
}
