// Rótulos de "Preguntas a la ayuda". Fuera del componente para que el archivo
// de la página exporte solo el componente (react-refresh).
import type { BadgeVariant } from "../../design-system/Badge";
import { SECCIONES, SECCIONES_DE_CLINICA } from "../guia/secciones";
import type { DiasDelInforme, ResultadoDeLaPregunta } from "./types";

export const PERIODOS: { value: `${DiasDelInforme}`; label: string }[] = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  // La retención de las preguntas: más atrás no hay nada.
  { value: "90", label: "Últimos 90 días" },
];

export const RESULTADOS: Record<ResultadoDeLaPregunta, { label: string; variant: BadgeVariant }> = {
  ANSWERED: { label: "Respondida", variant: "success" },
  // La lista de huecos de la guía: lo que más interesa mirar.
  NOT_COVERED: { label: "La guía no lo cubre", variant: "info" },
  DATA_REDIRECT: { label: "Pedía datos", variant: "neutral" },
  OFF_TOPIC: { label: "Fuera de tema", variant: "neutral" },
  ERROR: { label: "Falló", variant: "danger" },
};

export const PORCENTAJE = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 0,
});

/** "12 %" de un total; "—" sin total. */
export function porcentaje(parte: number, total: number): string {
  return total > 0 ? PORCENTAJE.format(parte / total) : "—";
}

/** El título del tema de la guía que citó una respuesta ("slug#ancla"). Si no
 *  está en la guía de siempre, en la de clínicas; si tampoco, el ancla tal
 *  cual (la guía pudo cambiar después de la pregunta). */
export function tituloDeTema(fuente: string): string {
  const [slug, ancla] = fuente.split("#");
  for (const secciones of [SECCIONES, SECCIONES_DE_CLINICA]) {
    const titulo = secciones
      .find((s) => s.slug === slug)
      ?.encabezados.find((e) => e.ancla === ancla)?.titulo;
    if (titulo) return titulo;
  }
  return fuente;
}
