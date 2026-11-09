import { soloDigitos } from "../lib/telefono";
import type { LlmToolDefinition } from "../services/llmProvider.service";

// ---------------------------------------------------------------------------
// TRANSFERIR Y COLGAR (PR 7). Las dos las ejecuta la plataforma de voz con sus
// herramientas de sistema (`transfer_to_number` y `end_call`): nuestro
// endpoint se las devuelve como una llamada a herramienta al final del turno.
// La plataforma las manda en `tools` de cada pedido solo si están prendidas en
// el agente; si no vienen, no se usan.
//
// QUIÉN DECIDE QUÉ:
//   - Transferir: el modelo solo pide derivar (request_human_handoff, como en
//     cualquier canal: la tarea se crea igual). El backend decide si además se
//     transfiere y a qué número: el de la sucursal (Branch.transferPhone), solo
//     con la sucursal abierta y solo si ese número está entre los que la
//     plataforma tiene cargados (si no, la plataforma rechaza la transferencia).
//   - Colgar: lo pide el modelo con END_CALL_TOOL, y el backend lo frena si lo
//     último que dijo es una pregunta: nunca se corta mientras el cliente puede
//     estar por hablar.
// ---------------------------------------------------------------------------

export const TRANSFERIR_DE_LA_PLATAFORMA = "transfer_to_number";
export const COLGAR_DE_LA_PLATAFORMA = "end_call";

// Lo que la plataforma ofrece en esta llamada.
export interface HerramientasDeLaPlataforma {
  // null: no ofrece transferir. `numeros`: los destinos que tiene cargados, si
  // vinieron en la definición (un enum); null si no vinieron.
  transferir: { numeros: string[] | null } | null;
  colgar: boolean;
  // Solo los nombres, para el log.
  nombres: string[];
}

export const SIN_HERRAMIENTAS_DE_LA_PLATAFORMA: HerramientasDeLaPlataforma = {
  transferir: null,
  colgar: false,
  nombres: [],
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// La definición de una herramienta en el formato de OpenAI
// ({ type: "function", function: { name, parameters } }) o plana.
function nombreYParametros(tool: unknown): { nombre: string; parametros: unknown } | null {
  if (!esObjeto(tool)) return null;
  const funcion = esObjeto(tool.function) ? tool.function : tool;
  return typeof funcion.name === "string"
    ? { nombre: funcion.name, parametros: funcion.parameters }
    : null;
}

// Los destinos cargados, si la definición de transfer_to_number los trae como
// enum de `transfer_number`. La documentación no muestra la forma exacta: si no
// vienen, null, y se confía en el número de la sucursal.
function numerosDeLaTransferencia(parametros: unknown): string[] | null {
  if (!esObjeto(parametros) || !esObjeto(parametros.properties)) return null;
  const campo = parametros.properties.transfer_number;
  if (!esObjeto(campo) || !Array.isArray(campo.enum)) return null;
  const numeros = campo.enum.filter((n): n is string => typeof n === "string");
  return numeros.length > 0 ? numeros : null;
}

/** Lo que ofrece la plataforma, leído de `tools` del pedido. Nunca falla: lo que no entiende, no lo usa. */
export function leerHerramientasDeLaPlataforma(tools: unknown): HerramientasDeLaPlataforma {
  if (!Array.isArray(tools)) {
    return SIN_HERRAMIENTAS_DE_LA_PLATAFORMA;
  }
  const leidas = tools.map(nombreYParametros).filter((t) => t !== null);
  const transferencia = leidas.find((t) => t.nombre === TRANSFERIR_DE_LA_PLATAFORMA);
  return {
    transferir: transferencia
      ? { numeros: numerosDeLaTransferencia(transferencia.parametros) }
      : null,
    colgar: leidas.some((t) => t.nombre === COLGAR_DE_LA_PLATAFORMA),
    nombres: leidas.map((t) => t.nombre.slice(0, 60)).slice(0, 20),
  };
}

// El número a mandarle a la plataforma: el de la sucursal tal cual, o el de su
// lista que tiene los mismos dígitos (puede estar escrito con espacios). null
// si la lista vino y el número no está.
export function numeroParaTransferir(
  transferPhone: string,
  numeros: readonly string[] | null,
): string | null {
  if (numeros === null) {
    return transferPhone;
  }
  const digitos = soloDigitos(transferPhone);
  return numeros.find((n) => soloDigitos(n) === digitos) ?? null;
}

export type AccionDeLaLlamada = { tipo: "transferir"; numero: string } | { tipo: "colgar" };

// Por qué una derivación no terminó en transferencia: para el log.
export type MotivoSinTransferencia =
  | "fuera-de-horario"
  | "sin-numero"
  | "plataforma-sin-transferencia"
  | "numero-no-cargado-en-la-plataforma";

// Cómo terminó el turno, según el turno del agente.
export interface DesenlaceDelTurno {
  derivar: boolean;
  // La sucursal tiene horario cargado y ahora está cerrada.
  fueraDeHorario: boolean;
  // El modelo pidió colgar (y el turno lo dejó pasar).
  colgar: boolean;
}

export function decidirAccion(
  desenlace: DesenlaceDelTurno,
  respuesta: string,
  transferPhone: string | null,
  plataforma: HerramientasDeLaPlataforma,
): { accion: AccionDeLaLlamada | null; sinTransferencia?: MotivoSinTransferencia } {
  if (desenlace.derivar) {
    if (desenlace.fueraDeHorario) return { accion: null, sinTransferencia: "fuera-de-horario" };
    if (transferPhone === null) return { accion: null, sinTransferencia: "sin-numero" };
    if (plataforma.transferir === null) {
      return { accion: null, sinTransferencia: "plataforma-sin-transferencia" };
    }
    const numero = numeroParaTransferir(transferPhone, plataforma.transferir.numeros);
    if (numero === null) {
      return { accion: null, sinTransferencia: "numero-no-cargado-en-la-plataforma" };
    }
    return { accion: { tipo: "transferir", numero } };
  }
  if (desenlace.colgar && plataforma.colgar && !terminaEnPregunta(respuesta)) {
    return { accion: { tipo: "colgar" } };
  }
  return { accion: null };
}

// Si lo último que dijo el agente es una pregunta, el cliente va a contestar:
// no se corta.
export function terminaEnPregunta(texto: string): boolean {
  return /\?\s*$/.test(texto.trim());
}

// Los argumentos de la herramienta de la plataforma, como texto JSON (el
// formato de OpenAI). Sin datos del cliente: el detalle está en la tarea del CRM.
// Lo dice la plataforma mientras llama: el "te paso con alguien" ya lo dijo el agente.
export const MENSAJE_AL_CLIENTE_AL_TRANSFERIR = "Aguardá un momento en línea, por favor.";
export const MENSAJE_A_QUIEN_ATIENDE =
  "Te paso una llamada del asistente virtual. El detalle quedó en una tarea del CRM.";

export function argumentosDeLaAccion(accion: AccionDeLaLlamada): {
  nombre: string;
  argumentos: string;
} {
  if (accion.tipo === "transferir") {
    return {
      nombre: TRANSFERIR_DE_LA_PLATAFORMA,
      argumentos: JSON.stringify({
        reason: "El cliente pidió hablar con una persona",
        transfer_number: accion.numero,
        client_message: MENSAJE_AL_CLIENTE_AL_TRANSFERIR,
        agent_message: MENSAJE_A_QUIEN_ATIENDE,
      }),
    };
  }
  return {
    nombre: COLGAR_DE_LA_PLATAFORMA,
    argumentos: JSON.stringify({ reason: "El cliente se despidió" }),
  };
}

// ---------------------------------------------------------------------------
// Lo que ve nuestro modelo.
// ---------------------------------------------------------------------------

export const END_CALL_TOOL_NAME = "end_call";

export const END_CALL_TOOL: LlmToolDefinition = {
  name: END_CALL_TOOL_NAME,
  description:
    "Corta la llamada. Usala SOLO en uno de estos dos casos: el cliente se despidió («chau», «gracias, nada más», «hasta luego»), o le preguntaste si necesitaba algo más y te dijo que no. En cualquier otro caso no la uses: si dudás, preguntá «¿Te ayudo con algo más?» y esperá la respuesta. Junto con la herramienta escribí una despedida corta y sin preguntas (por ejemplo: «Gracias por llamar, que tengas un buen día.»). No la uses en el mismo turno que otra herramienta.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

// La despedida si el modelo pidió colgar sin escribir nada.
export const DESPEDIDA_FIJA = "Gracias por llamar, que tengas un buen día.";

// Por qué no se le deja colgar en este turno (va al modelo como resultado).
export const COLGAR_CON_OTRA_HERRAMIENTA =
  "No cortes la llamada en el mismo turno que otra herramienta: contale al cliente lo que hiciste y esperá su respuesta.";

// Solo si la plataforma ofrece transferir y la sucursal tiene número.
export const INSTRUCCION_DE_TRANSFERENCIA =
  "Si derivás con request_human_handoff mientras la sucursal está abierta, la llamada pasa en ese momento a una persona del equipo: en mensajeAlCliente decí solo algo como «Te paso con alguien del equipo». Si la sucursal está cerrada, no hay a quién pasarla: decile cuándo lo van a llamar.";
