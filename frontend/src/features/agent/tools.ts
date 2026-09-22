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
      "Crea una oportunidad de venta para el contacto de esta conversación. La oportunidad queda asignada al vendedor del contacto, en la primera etapa del pipeline por defecto. Usala cuando el contacto muestra intención concreta de compra o contratación. Si el contacto ya tiene una oportunidad abierta, no crea otra: devuelve esa con reused en true, y es sobre esa que tenés que seguir. Para cambiarle el título, el monto u otro dato usá update_opportunity con su opportunityId, no vuelvas a llamar a esta.",
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
  {
    value: "get_payment_info",
    label: "Compartir datos de cobro",
    subtitle:
      "Devuelve el link de pago y/o los datos para transferencia bancaria configurados por la sucursal. Usala cuando el cliente concretamente quiere pagar o señar, o pide el link de pago o los datos de la cuenta (CBU, alias, número de cuenta). Si solo pregunta en general qué métodos de pago aceptan, respondé con los nombres de los métodos disponibles (transferencia bancaria / link de pago) sin compartir todavía el link ni los datos de la cuenta; si ya la llamaste antes en la conversación, no hace falta volver a llamarla para eso. Si no hay ningún medio de pago configurado, decíselo al cliente: no inventes uno.",
  },
  {
    value: "get_contact_info",
    label: "Ver datos del contacto",
    subtitle:
      "Devuelve los datos que el CRM tiene cargados del contacto de esta conversación (nombre, apellido, email, teléfono). Usala para saber si ya tenés el nombre de la persona antes de preguntárselo de nuevo, o antes de derivar, para que la persona que retome tenga contexto.",
  },
  {
    value: "search_vehicles",
    label: "Buscar vehículos en stock",
    subtitle:
      'Busca vehículos disponibles en stock que están publicados para mostrar a clientes. REGLA PRINCIPAL: cada filtro que mandes tiene que poder señalarse en las palabras del cliente. Si el cliente no lo dijo, NO lo mandes — nunca lo completes con un valor que te parezca razonable. Un filtro de más esconde autos que sí hay, y le terminás diciendo al cliente que no hay stock cuando sí hay. Ejemplo: si el cliente solo dice "algo de menos de 30 mil dólares", mandá únicamente priceMaxUsd: 30000, sin carrocería, transmisión, combustible, condición ni kilometraje. Si no dio ningún dato, llamala sin filtros. Filtros disponibles: precio en USD, marca, modelo, año, tipo de carrocería, 0 km o usado, transmisión, combustible, color, kilometraje máximo, financiación, permuta, y un texto libre para cualquier otra cosa (equipamiento, versión, algo de la descripción). Devuelve como máximo 10 resultados y el total. Usala cuando el cliente pregunta por autos disponibles o pide opciones dentro de un presupuesto o con ciertas características.',
  },
  {
    value: "get_service_types",
    label: "Ver tipos de servicio",
    subtitle:
      "Lista los tipos de servicio disponibles en esta sucursal, con su duración y el recurso al que pertenecen. Usala antes de get_availability para saber qué resourceId y serviceTypeId corresponden al servicio que pide el cliente — no inventes esos UUID, salen siempre de acá.",
  },
  {
    value: "get_contact_activities",
    label: "Ver tareas pendientes del contacto",
    subtitle:
      "Lista las próximas tareas o actividades pendientes que el equipo ya tiene agendadas para el contacto de esta conversación (llamados de seguimiento, recordatorios). Usala antes de prometer un seguimiento o derivar, para no duplicar algo que ya está agendado.",
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
  return AGENT_TOOL_OPTIONS.find((option) => option.value === name)?.label ?? name;
}

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
