// ---------------------------------------------------------------------------
// Capa de permisos del agente de IA — puedeEjecutarTool (docs/ai-agent-
// architecture.md §6). Es la pieza que hace cumplir CON CÓDIGO el principio de
// §1: el modelo propone, esta función decide, y recién después el loop
// ejecuta. Nunca ejecuta nada, nunca toca la base.
//
// PURA A PROPÓSITO: recibe el agente ya cargado (enabledTools + guardrails),
// el nombre de la tool, sus argumentos y lo que la conversación ya sabe. Es lo
// que permite probar las cuatro comprobaciones como test unitario
// (agentPermissions.service.test.ts), sin Postgres.
//
// `guardrails` llega tal cual está en la base: un Json de forma documentada
// pero NO impuesta (§6 y comentario del schema). Cada lectura es tolerante — una
// clave ausente o con el tipo equivocado se trata como "no configurada", nunca
// como un error que tumbe el turno. Un admin que escribió mal un guardrail
// obtiene un guardrail que no aplica, no un agente roto.
// ---------------------------------------------------------------------------

export interface AgentParaPermisos {
  enabledTools: string[];
  guardrails: unknown;
}

// Lo que la conversación YA SABE, para la comprobación (4). Lo arma el loop de
// orquestación a partir de la Conversation y del Contact (ver
// datosDisponiblesDeLaConversacion en agentOrchestration.service.ts): un
// dato está "disponible" si figura acá con un valor no vacío, o si viene en
// los `args` de la tool con un valor no vacío.
export type DatosDisponibles = Record<string, unknown>;

export interface DecisionDePermiso {
  allowed: boolean;
  // Solo cuando allowed === false: el motivo, en un texto que el loop le
  // devuelve al modelo tal cual (§4 paso 4 — nunca se le miente con un
  // resultado falso, se le dice por qué no).
  reason?: string;
}

// ---------------------------------------------------------------------------
// Lecturas tolerantes del Json de guardrails
// ---------------------------------------------------------------------------

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function comoListaDeStrings(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

// "Contact.email" → "email"; "email" → "email". Ver la nota del 12/09/2026
// bajo §6, punto 4: no hay mapeo tool→entidad, así que se compara solo el
// nombre de campo, sin distinguir mayúsculas.
function nombreDeCampo(entrada: string): string {
  const ultimoPunto = entrada.lastIndexOf(".");
  return (ultimoPunto === -1 ? entrada : entrada.slice(ultimoPunto + 1)).trim().toLowerCase();
}

function estaPresente(valor: unknown): boolean {
  if (valor === undefined || valor === null) {
    return false;
  }
  if (typeof valor === "string") {
    return valor.trim().length > 0;
  }
  if (Array.isArray(valor)) {
    return valor.length > 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// La función central
// ---------------------------------------------------------------------------

export function puedeEjecutarTool(
  agent: AgentParaPermisos,
  toolName: string,
  args: Record<string, unknown>,
  datosDisponibles: DatosDisponibles,
): DecisionDePermiso {
  const guardrails = comoObjeto(agent.guardrails);

  // (1) La tool tiene que estar habilitada para este agente. Es la primera
  // comprobación y la más barata: un agente sin create_booking en enabledTools
  // no puede reservar, diga lo que diga el modelo.
  if (!agent.enabledTools.includes(toolName)) {
    return {
      allowed: false,
      reason: `La acción "${toolName}" no está habilitada para este agente`,
    };
  }

  // (2) accionesProhibidas: la lista negra explícita del negocio. Gana sobre
  // enabledTools — una tool puede estar habilitada en general y prohibida por
  // guardrail, y en ese caso no se ejecuta.
  const accionesProhibidas = comoListaDeStrings(guardrails.accionesProhibidas);
  if (accionesProhibidas.includes(toolName)) {
    return {
      allowed: false,
      reason: `La acción "${toolName}" está prohibida por la configuración del agente`,
    };
  }

  // (3) infoNoModificable: ningún argumento de la tool puede tocar un campo
  // listado. Comparación por nombre de campo, sin el prefijo de entidad.
  const camposProtegidos = new Set(
    comoListaDeStrings(guardrails.infoNoModificable).map(nombreDeCampo),
  );
  if (camposProtegidos.size > 0) {
    const tocados = Object.keys(args).filter((clave) =>
      camposProtegidos.has(clave.trim().toLowerCase()),
    );
    if (tocados.length > 0) {
      return {
        allowed: false,
        reason: `La acción "${toolName}" intenta modificar información protegida (${tocados.join(", ")})`,
      };
    }
  }

  // (4) datosRequeridosAntesDeAccion[toolName]: todos esos datos tienen que
  // estar ya disponibles, en los args o en lo que la conversación sabe. Si
  // falta alguno la tool no se ejecuta y el modelo tiene que seguir
  // preguntando — el motivo dice exactamente qué falta para que pueda hacerlo.
  const requeridosPorTool = comoObjeto(guardrails.datosRequeridosAntesDeAccion);
  const requeridos = comoListaDeStrings(requeridosPorTool[toolName]);
  if (requeridos.length > 0) {
    const faltantes = requeridos.filter(
      (dato) => !estaPresente(args[dato]) && !estaPresente(datosDisponibles[dato]),
    );
    if (faltantes.length > 0) {
      return {
        allowed: false,
        reason: `Antes de "${toolName}" hace falta conocer: ${faltantes.join(", ")}`,
      };
    }
  }

  return { allowed: true };
}
