import type { MultiSelectOption } from "../../design-system/MultiSelect";

// ---------------------------------------------------------------------------
// ESPEJO A MANO de CATALOGO_DE_TOOLS (src/services/agentTools.service.ts).
//
// No hay ningún endpoint que exponga el catálogo, y es una decisión tomada:
// las tools viven en código del backend, no en la base, y nadie las consume
// más que esta pantalla. Inventar un GET /api/agents/tools para alimentar un
// checklist de seis ítems fijos sería una ruta, un controller y un test de
// integración para evitar duplicar seis strings.
//
// EL PRECIO, dicho para que nadie lo descubra tarde: si alguien agrega, saca
// o renombra una tool del catálogo del backend, ESTA LISTA HAY QUE
// ACTUALIZARLA A MANO. Un nombre que sobre acá se guardaría en enabledTools y
// el loop de orquestación simplemente nunca se lo ofrecería al modelo
// (toolsHabilitadas filtra por intersección); uno que falte acá deja una tool
// real sin forma de habilitarse desde la pantalla.
//
// Las descripciones son LAS MISMAS que lee el modelo, copiadas textual del
// catálogo, no un resumen: lo que la tool hace de verdad es lo que dice esa
// descripción, y un ADMIN que decide si habilitarla merece leer eso y no una
// paráfrasis que envejece por otro lado. El `label` sí es propio — un nombre
// corto en castellano para el botón cerrado del selector.
// ---------------------------------------------------------------------------

export const AGENT_TOOL_OPTIONS: MultiSelectOption<string>[] = [
  {
    value: "create_opportunity",
    label: "Crear oportunidad",
    subtitle:
      "Crea una oportunidad de venta para el contacto de esta conversación. La oportunidad queda asignada al vendedor del contacto, en la primera etapa del pipeline por defecto. Usala cuando el contacto muestra intención concreta de compra o contratación.",
  },
  {
    value: "update_opportunity",
    label: "Modificar oportunidad",
    subtitle:
      "Modifica una oportunidad existente del contacto de esta conversación: título, monto, moneda, estado (OPEN/WON/LOST), etapa o motivo de pérdida. No permite cambiar el vendedor ni el pipeline.",
  },
  {
    value: "get_availability",
    label: "Consultar disponibilidad",
    subtitle:
      "Consulta los turnos disponibles de un recurso (persona, sala o clase) para un servicio, en un rango de fechas. Devuelve los horarios libres con inicio y fin. Usala antes de reservar.",
  },
  {
    value: "create_booking",
    label: "Reservar turno",
    subtitle:
      "Reserva un turno para el contacto de esta conversación en un recurso y servicio, a partir de un horario. El horario tiene que ser uno de los que devolvió get_availability. El fin lo determina la duración del servicio.",
  },
  {
    value: "create_lead",
    label: "Calificar el lead",
    subtitle:
      "Registra la calificación inicial del contacto de esta conversación como lead: puntaje, intención, servicio de interés, urgencia, presupuesto, zona y notas. Usala la primera vez que reunís datos de calificación en la conversación. Todos los campos son opcionales; mandá los que conozcas.",
  },
  {
    value: "update_lead",
    label: "Actualizar la calificación",
    subtitle:
      "Actualiza la calificación del contacto de esta conversación cuando aparece información nueva o cambia algo (subió el presupuesto, cambió la urgencia, surgió una duda). Las notas se agregan a las anteriores. Todos los campos son opcionales; mandá solo lo que cambió.",
  },
];

// Las tools que un agente tiene habilitadas pueden incluir un nombre que no
// esté en la lista de arriba: el backend valida la forma del nombre, no su
// pertenencia al catálogo (toolNameSchema en agent.controller.ts), así que una
// tool creada por API —o una que se sacó del catálogo después— sigue guardada
// en la fila. Se ofrece como opción extra mientras sea un valor vigente, con
// el nombre crudo: mismo criterio que la zona horaria fuera de lista en
// BranchFormPage. Sin esto el selector mostraría la tool como no elegida y el
// PATCH la borraría sin que nadie lo haya pedido.
export function agentToolOptions(selected: string[]): MultiSelectOption<string>[] {
  const conocidas = new Set(AGENT_TOOL_OPTIONS.map((option) => option.value));
  const extras = selected
    .filter((value) => !conocidas.has(value))
    .map((value) => ({
      value,
      label: value,
      subtitle: "No está en el catálogo de tools de esta versión del backend.",
    }));
  return [...AGENT_TOOL_OPTIONS, ...extras];
}
