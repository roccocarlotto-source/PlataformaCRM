import type { MultiSelectOption } from "../../design-system/MultiSelect";

// ---------------------------------------------------------------------------
// ESPEJO A MANO de CATALOGO_DE_TOOLS_INTERNAS
// (src/services/internalAgentTools.service.ts), mismo patrón y mismo motivo
// que features/agent/tools.ts: no hay endpoint que exponga el catálogo, y son
// dos strings fijos.
//
// EL PRECIO, igual que allá: si alguien agrega, saca o renombra una tool del
// catálogo interno del backend, ESTA LISTA HAY QUE ACTUALIZARLA A MANO. Un
// nombre de más se guardaría en enabledTools y el loop nunca se lo ofrecería al
// modelo (toolsHabilitadasInternas filtra por intersección); uno de menos deja
// una tool real sin forma de habilitarse desde la pantalla.
//
// El `subtitle` es UNA LÍNEA para el selector, no la descripción que lee el
// modelo (esa vive en el catálogo del backend); la explicación completa está
// en docs/guia-de-uso/08-agentes-de-ia.md, «Agente interno del equipo». El
// `label` es propio.
// ---------------------------------------------------------------------------

export const INTERNAL_AGENT_TOOL_OPTIONS: MultiSelectOption<string>[] = [
  {
    value: "create_internal_task",
    label: "Crear tarea",
    subtitle: "Crea una tarea ligada a un contacto u oportunidad, asignada a quien la pide.",
  },
  {
    value: "get_agenda",
    label: "Ver agenda",
    subtitle: "Lista los turnos agendados en un rango de fechas.",
  },
];

// Una tool guardada que ya no está en esta lista se ofrece como opción extra
// mientras siga elegida, con el nombre crudo — mismo criterio que
// agentToolOptions: sin esto el PUT (reemplazo completo) la borraría sin que
// nadie lo haya pedido.
export function internalAgentToolOptions(selected: string[]): MultiSelectOption<string>[] {
  const conocidas = new Set(INTERNAL_AGENT_TOOL_OPTIONS.map((option) => option.value));
  const extras = selected
    .filter((value) => !conocidas.has(value))
    .map((value) => ({
      value,
      label: value,
      subtitle: "No está en el catálogo de tools de esta versión del backend.",
    }));
  return [...INTERNAL_AGENT_TOOL_OPTIONS, ...extras];
}
