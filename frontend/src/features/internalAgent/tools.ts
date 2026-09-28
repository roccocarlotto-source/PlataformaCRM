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
// Las descripciones son LAS MISMAS que lee el modelo, copiadas textual de las
// `definition.description` del catálogo (la de get_agenda con
// MAX_DIAS_DE_RANGO = 62 ya resuelto), no una paráfrasis. El `label` sí es
// propio.
// ---------------------------------------------------------------------------

export const INTERNAL_AGENT_TOOL_OPTIONS: MultiSelectOption<string>[] = [
  {
    value: "create_internal_task",
    label: "Crear tarea",
    subtitle:
      "Crea una tarea en el CRM, ligada a un contacto y/o a una oportunidad que YA existen, y asignada a la persona que te la pide. Mandá `contacto` (nombre y apellido o email) u `oportunidad` (su título), o los dos; con los dos, la oportunidad se busca entre las de ese contacto. Si la persona no dijo a quién o a qué va ligada, preguntale antes de llamarla. Si dijo una fecha límite, mandala en `fechaLimite`.",
  },
  {
    value: "get_agenda",
    label: "Ver agenda",
    subtitle:
      "Lista los turnos agendados de la organización en un rango de fechas, opcionalmente de una sola sucursal. Devuelve fecha, hora (en la zona de cada sucursal), contacto, servicio, sucursal y estado de cada turno. Sin `hasta` se miran las 24 horas siguientes a `desde`; el rango máximo es de 62 días. Si la agenda viene vacía, decilo tal cual: no inventes turnos.",
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
