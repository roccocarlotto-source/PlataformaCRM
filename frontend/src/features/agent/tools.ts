import {
  concordancia,
  VOCABULARIO_DE_CLINICA_POR_DEFECTO,
  type VocabularioCompleto,
} from "../../auth/vocabulario";
import type { MultiSelectOption } from "../../design-system/MultiSelect";

// ---------------------------------------------------------------------------
// ESPEJO A MANO de CATALOGO_DE_TOOLS (src/services/agentTools.service.ts).
//
// No hay ningún endpoint que exponga el catálogo, y es una decisión tomada:
// las tools viven en código del backend, no en la base, y nadie las consume
// más que esta pantalla. Inventar un GET /api/agents/tools para alimentar un
// checklist de once ítems fijos sería una ruta, un controller y un test de
// integración para evitar duplicar once strings.
//
// EL PRECIO, dicho para que nadie lo descubra tarde: si alguien agrega, saca
// o renombra una tool del catálogo del backend, ESTA LISTA HAY QUE
// ACTUALIZARLA A MANO. Un nombre que sobre acá se guardaría en enabledTools y
// el loop de orquestación simplemente nunca se lo ofrecería al modelo
// (toolsHabilitadas filtra por intersección); uno que falte acá deja una tool
// real sin forma de habilitarse desde la pantalla.
//
// El `subtitle` es UNA LÍNEA para el selector, no la descripción que lee el
// modelo: esa vive solo en el catálogo del backend, y la explicación completa
// de qué hace cada acción y cuándo la usa el agente está en la guía de uso
// (docs/guia-de-uso/08-agentes-de-ia.md, «Acciones habilitadas»). Si cambia
// la descripción de una tool en el backend, hay que revisar las dos cosas.
// El `label` es el nombre corto en castellano para el botón del selector.
// ---------------------------------------------------------------------------

export const AGENT_TOOL_OPTIONS: MultiSelectOption<string>[] = [
  {
    value: "create_opportunity",
    label: "Crear oportunidad",
    subtitle: "Crea una oportunidad cuando el cliente toma la iniciativa de avanzar.",
  },
  {
    value: "update_opportunity",
    label: "Modificar oportunidad",
    subtitle: "Cambia título, monto, moneda o vehículo, o la marca como perdida.",
  },
  {
    // Ítem 175: la única tool que saca una unidad del stock. Ningún agente la
    // trae habilitada; la prende el negocio acá si quiere que su agente reserve.
    value: "reserve_vehicle",
    label: "Reservar unidad",
    subtitle: "Reserva una unidad del stock: la saca para otros clientes.",
  },
  {
    value: "get_availability",
    label: "Consultar disponibilidad",
    subtitle: "Consulta los turnos libres de un recurso.",
  },
  {
    value: "create_booking",
    label: "Reservar turno",
    subtitle: "Reserva un turno para el contacto.",
  },
  {
    value: "create_lead",
    label: "Calificar el lead",
    subtitle: "Registra la calificación inicial del contacto.",
  },
  {
    value: "update_lead",
    label: "Actualizar la calificación",
    subtitle: "Actualiza la calificación; guarda nombre y apellido.",
  },
  {
    // B6: los campos personalizados de contactos. El agente lee todos; con
    // esta tool escribe solo los marcados "editable por el agente".
    value: "update_contact_custom_fields",
    label: "Guardar campos personalizados",
    subtitle: "Completa los campos personalizados editables por el agente.",
  },
  {
    value: "get_payment_info",
    label: "Compartir datos de cobro",
    subtitle: "Comparte el link de pago o los datos de transferencia.",
  },
  {
    value: "get_contact_info",
    label: "Ver datos del contacto",
    subtitle: "Consulta los datos que ya tiene el contacto.",
  },
  {
    value: "search_vehicles",
    label: "Buscar vehículos en stock",
    subtitle: "Busca unidades publicadas con los filtros que dio el cliente.",
  },
  {
    value: "get_service_types",
    label: "Ver tipos de servicio",
    subtitle: "Lista los servicios de la sucursal.",
  },
  {
    // Ítem 185: la marca "sin interés". Ningún agente la trae habilitada.
    value: "mark_no_interest",
    label: "Marcar sin interés",
    subtitle: "Marca «sin interés» cuando el cliente dice que no quiere seguir.",
  },
  {
    value: "get_contact_activities",
    label: "Ver tareas pendientes del contacto",
    subtitle: "Lista las tareas pendientes del contacto.",
  },
];

// R11 (docs/rubros.md §5.1): las tools que solo tiene una clínica
// (MODULO_DE_LA_TOOL_DE_CLINICA en src/config/ediciones.ts, ESPEJO A MANO). No
// están en AGENT_TOOL_OPTIONS: una automotora no las ve en el selector.
export const AGENT_TOOL_OPTIONS_DE_CLINICA: MultiSelectOption<string>[] = [
  {
    value: "get_contact_bookings",
    label: "Ver turnos del paciente",
    subtitle: "Lista los próximos turnos del paciente de la conversación.",
  },
  {
    value: "reschedule_booking",
    label: "Reprogramar turno",
    subtitle: "Cambia el día, la hora o el profesional de un turno del paciente.",
  },
  {
    value: "cancel_booking",
    label: "Cancelar turno",
    subtitle: "Cancela un turno del paciente, con la anticipación mínima de la sede.",
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
// La tool del SISTEMA (REQUEST_HUMAN_HANDOFF_TOOL_NAME en
// agentOrchestration.service.ts). NO está en el catálogo de arriba y no puede
// estarlo: siempre está disponible, sin importar Agent.enabledTools, así que
// ofrecerla en el selector de tools habilitadas sería una casilla que no
// cambia nada. Pero el probador (ítem 65) SÍ la ve aparecer en las tool calls
// de un turno, y ahí necesita un nombre.
export const REQUEST_HUMAN_HANDOFF_TOOL_NAME = "request_human_handoff";

// El rótulo corto de una tool tal como llega en una tool call. Un nombre
// fuera del catálogo se muestra crudo —mismo criterio que
// modelProviderLabel—: el dato real informa más que un "—", y en una
// herramienta de diagnóstico es justamente lo que hay que poder leer.
export function toolLabel(name: string): string {
  if (name === REQUEST_HUMAN_HANDOFF_TOOL_NAME) return "Derivar a una persona";
  return (
    [...AGENT_TOOL_OPTIONS, ...AGENT_TOOL_OPTIONS_DE_CLINICA].find(
      (option) => option.value === name,
    )?.label ?? name
  );
}

// Las acciones que, antes de ejecutarse, exigen el nombre y el apellido del
// cliente (y por el widget web un teléfono o un email): el backend las frena
// con un "pedíselo y guardalo con update_lead" (datosQueFaltanParaActuar en
// agentTools.service.ts). Guardar el nombre es cosa de create_lead o
// update_lead, así que un agente con una de estas y ninguna de aquellas nunca
// va a poder crear una oportunidad ni reservar: el aviso lo dice en la
// pantalla, que es donde se decide.
export const TOOLS_QUE_EXIGEN_EL_NOMBRE = [
  "create_opportunity",
  "create_booking",
  "reserve_vehicle",
];
export const TOOLS_QUE_GUARDAN_EL_NOMBRE = ["create_lead", "update_lead"];

export function avisoDeAccionesSinGuardarElNombre(enabledTools: string[]): string | null {
  const exigen = TOOLS_QUE_EXIGEN_EL_NOMBRE.filter((tool) => enabledTools.includes(tool));
  if (exigen.length === 0 || TOOLS_QUE_GUARDAN_EL_NOMBRE.some((t) => enabledTools.includes(t))) {
    return null;
  }
  const nombres = exigen.map((tool) => `«${toolLabel(tool)}»`).join(", ");
  return `${nombres} ${exigen.length === 1 ? "exige" : "exigen"} el nombre del cliente: habilitá «${toolLabel("update_lead")}» o «${toolLabel("create_lead")}» para que pueda guardarlo.`;
}

// Las tools de AGENT_TOOL_OPTIONS que una clínica no tiene (ESPEJO A MANO de
// toolDelRubro en src/config/ediciones.ts: las de stock y oportunidades por su
// módulo, get_payment_info por TOOLS_FUERA_DEL_RUBRO). El backend no se las
// ofrece al modelo aunque estén habilitadas; el selector no las muestra.
const TOOLS_FUERA_DE_CLINICA: ReadonlySet<string> = new Set([
  "create_opportunity",
  "update_opportunity",
  "reserve_vehicle",
  "search_vehicles",
  "get_payment_info",
]);

// Los textos que nombran al contacto, al recurso o al tipo de servicio, con
// el vocabulario de la clínica (docs/rubros.md §3.1).
function conTextosDeClinica(
  option: MultiSelectOption<string>,
  v: VocabularioCompleto,
): MultiSelectOption<string> {
  switch (option.value) {
    case "get_availability":
      return {
        ...option,
        subtitle: `Consulta los turnos libres de ${concordancia(v.recurso).un} ${v.recurso.singular}.`,
      };
    case "get_service_types":
      return {
        ...option,
        label: `Ver ${v.tipoDeServicio.plural}`,
        subtitle: `Lista ${concordancia(v.tipoDeServicio).los} ${v.tipoDeServicio.plural} ${concordancia(v.sucursal).del} ${v.sucursal.singular}.`,
      };
    case "mark_no_interest":
      return {
        ...option,
        subtitle: `Marca «sin interés» cuando el ${v.contacto.singular} dice que no quiere seguir.`,
      };
    default:
      return option;
  }
}

export function agentToolOptions(
  selected: string[],
  esClinica = false,
  vocabulario: VocabularioCompleto = VOCABULARIO_DE_CLINICA_POR_DEFECTO,
): MultiSelectOption<string>[] {
  const base = esClinica
    ? [
        ...AGENT_TOOL_OPTIONS.filter((option) => !TOOLS_FUERA_DE_CLINICA.has(option.value)).map(
          (option) => conTextosDeClinica(option, vocabulario),
        ),
        ...AGENT_TOOL_OPTIONS_DE_CLINICA,
      ]
    : AGENT_TOOL_OPTIONS;
  const conocidas = new Set(base.map((option) => option.value));
  const extras = selected
    .filter((value) => !conocidas.has(value))
    .map((value) => ({
      value,
      label: value,
      subtitle: "No está en el catálogo de tools de esta versión del backend.",
    }));
  return [...base, ...extras];
}
