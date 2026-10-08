import {
  ConversationChannel,
  LeadUrgency,
  OpportunityStatus,
  type OpportunityLeadSource,
  VehicleBodyType,
  VehicleCondition,
  VehicleFuelType,
  VehicleTransmission,
} from "@prisma/client";
import { z } from "zod";
import { logger } from "../lib/logger";
import { findManyActivities } from "../repositories/activity.repository";
import { countFutureConfirmedBookingsOfContact } from "../repositories/booking.repository";
import { findBranchById } from "../repositories/branch.repository";
import {
  findContactById,
  setLeadIntentIfEmpty,
  updateContactCustomFields,
} from "../repositories/contact.repository";
import { findManyOpportunities, findOpportunityById } from "../repositories/opportunity.repository";
import { findDefaultPipeline } from "../repositories/pipeline.repository";
import { findResourceById } from "../repositories/resource.repository";
import { findManyServiceTypes, findServiceTypeById } from "../repositories/serviceType.repository";
import { findStageById, findStagesByPipeline } from "../repositories/stage.repository";
import {
  countVehicles,
  findManyVehicles,
  findNombresDeVehiculosPublicados,
  findVehicleById,
  type VehicleFilters,
} from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { buscarPorMarcaYModelo, idsDelMismoModelo } from "../utils/busquedaDeVehiculo";
import {
  asuntoDeLaNotaDeMotivo,
  CONSULTAS_QUE_NO_SON_INICIATIVA,
  enumerarIniciativas,
  INICIATIVAS_DEL_CLIENTE,
  MOTIVOS_DE_OPORTUNIDAD,
  PREFIJO_NOTA_DE_MOTIVO,
  type IniciativaDelCliente,
} from "../utils/iniciativaDelCliente";
import { esNombreProvisorio, tieneLetras } from "../utils/nombreProvisorio";
import { isoEnZona } from "../utils/timezone";
import {
  BODY_TYPE_LABELS,
  CONDITION_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
} from "../utils/vehicleLabels";
import { currencySchema } from "../utils/validation";
import { createActivity } from "./activity.service";
import { MAX_DIAS_DE_RANGO, obtenerDisponibilidad } from "./availability.service";
import { createBooking, relojDeReservas } from "./booking.service";
import {
  asignarVehiculoDeInteresDesdeElAgente,
  camposPersonalizadosParaGuardar,
  getContactById,
  qualifyLead,
  marcarSinInteres,
} from "./contact.service";
import type { LlmToolDefinition } from "./llmProvider.service";
import { createOpportunity, updateOpportunity } from "./opportunity.service";
import { resolverOwnerDelContacto } from "./ownership.service";

// ---------------------------------------------------------------------------
// Catálogo de tools del agente de IA (docs/ai-agent-architecture.md §7) y sus
// wrappers. Paso 2b: las cuatro que ya tenían toda su base construida; paso
// 3: create_lead / update_lead sobre las columnas de calificación de Contact.
//
// CADA WRAPPER ES FINO A PROPÓSITO: valida los argumentos que vienen del
// modelo, resuelve lo que el modelo NO debe controlar, y llama al MISMO service
// que usa un humano desde el panel (§5: "el agente nunca salta la validación
// de negocio"). Nada de lógica de negocio acá.
//
// LO QUE EL MODELO NO PUEDE ELEGIR (nota del 12/09/2026 bajo §6):
//   - contactId: siempre el Contact de la conversación. En ninguna tool es un
//     argumento.
//   - ownerId de una oportunidad: el ownerId del Contact (el vendedor ya
//     asignado a ese lead), o —desde el ítem 69— el vendedor por defecto de la
//     sucursal de la conversación si el contacto todavía no tenía ninguno, en
//     cuyo caso el Contact queda asignado a esa persona de verdad. Sin ninguno
//     de los dos, la tool falla con un error claro — no se inventa un dueño.
//   - pipelineId/stageId de una oportunidad nueva: el Pipeline con isDefault y
//     su Stage de menor order. Sin pipeline por defecto, error claro.
//   - update_opportunity no expone ownerId/contactId/pipelineId: un agente no
//     reasigna vendedores ni mueve oportunidades de pipeline.
//
// LOS ERRORES DE NEGOCIO SON RESULTADOS, NO EXCEPCIONES. Un AppError del
// service (turno fuera de horario, sin cupo, contacto sin vendedor…) se
// devuelve como `{ ok: false, error }` para que el modelo lea "no se pudo, por
// esto" y siga la conversación con eso. Cualquier OTRO error (un bug, la base
// caída) sí se propaga: eso no es algo que el modelo tenga que resolver.
// ---------------------------------------------------------------------------

export interface ContextoDeEjecucionDeTool {
  organizationId: string;
  conversation: {
    id: string;
    contactId: string;
    branchId: string;
    agentId: string;
    // El canal por el que escribe el cliente. Lo miran las reglas que
    // dependen de qué tan identificada está la persona (un visitante del
    // widget es anónimo; alguien de WhatsApp ya llega con su número) y el
    // origen de la oportunidad.
    channel: ConversationChannel;
  };
}

// ---------------------------------------------------------------------------
// QUÉ HACE FALTA DEL CLIENTE ANTES DE RESERVAR O CREAR UNA OPORTUNIDAD.
//
// EN TODOS LOS CANALES, EL NOMBRE Y EL APELLIDO (decisión de Rocco,
// 08/10/2026). Rocco quedó en el CRM como "Messenger …08366039" después de
// pedir un test drive: el agente nunca preguntó cómo se llamaba. Un nombre
// completo es nombre y apellido con letras (tieneNombreCompleto): un
// provisorio, un perfil de WhatsApp de una sola palabra ("Martín") o sin
// letras ("Juancho 🚗", ".") no alcanzan. Si el perfil ya trae nombre y
// apellido, no se pregunta. Y ante una consulta de información no se pide
// nada: esto corre solo en las tools que actúan.
//
// EN EL CANAL WEB, ADEMÁS, UN TELÉFONO O UN EMAIL (D3, decisión de Rocco,
// 05/10/2026; FABLE-B-02 y OPUS-A-06, docs-privados, local). El visitante del
// widget es anónimo: cualquiera, con cualquier sessionId. Antes podía pedir
// "reservame cuatro test drives para mañana" sin decir quién era y el agente
// los reservaba: agenda bloqueada y nadie a quien llamar. Solo WEB: por
// WhatsApp, Messenger e Instagram la persona ya llega atada a una cuenta suya
// por la que el negocio le puede contestar.
//
// SE VALIDA ACÁ, EN LA TOOL, y no en el prompt: una instrucción el modelo la
// puede saltear; un resultado ok: false no. El modelo lee qué falta, se lo
// pide al cliente, lo guarda con update_lead y vuelve a intentar. Si
// update_lead no está habilitada, la pantalla del agente lo avisa (frontend,
// AgentFormPage): la exigencia no tiene cómo cumplirse.
// ---------------------------------------------------------------------------
export function datosQueFaltanParaActuar(
  contacto: {
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  },
  canal: ConversationChannel,
): string[] {
  const faltan: string[] = [];
  if (esNombreProvisorio(contacto) || !tieneLetras(contacto.firstName)) {
    faltan.push("el nombre y el apellido");
  } else if (!tieneLetras(contacto.lastName)) {
    faltan.push("el apellido");
  }
  const tiene = (valor: string | null) => valor !== null && valor.trim().length > 0;
  if (canal === ConversationChannel.WEB && !tiene(contacto.email) && !tiene(contacto.phone)) {
    faltan.push("un teléfono o un email");
  }
  return faltan;
}

export function mensajeFaltanDatos(faltan: string[]): string {
  return `Todavía no se puede: antes de reservar o registrar la oportunidad hace falta ${faltan.join(" y ")} del cliente. Pedíselo, guardalo con update_lead (firstName, lastName, phone, email) y recién después volvé a llamar a esta herramienta. No le digas que quedó reservado ni registrado: todavía no se hizo nada.`;
}

// FABLE-A-02 (B3, 05/10/2026): por WEB las tools no devuelven el email ni el
// teléfono guardados del contacto. El visitante del widget es anónimo (una
// cookie de sesión), y detrás puede haber un contacto unido, importado o de
// otra persona que usó el mismo navegador: afirmarle "tu mail es tal" es
// filtrar un dato personal. Lo que el visitante escribe en esta conversación
// sí se usa (y se guarda con update_lead).
export const NOTA_DATOS_RESERVADOS_EN_WEB =
  "Por el canal web no se devuelven el email ni el teléfono guardados. No afirmes que los tenés: si los necesitás, pedíselos al cliente y usá solo los que te dé en esta conversación.";

// null = se puede seguir. Lee el contacto vigente: el update_lead de la misma
// ronda ya quedó guardado.
async function bloqueoPorIdentidad(
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool | null> {
  const contacto = await findContactById(contexto.conversation.contactId, contexto.organizationId);
  if (!contacto) {
    return fallo("El contacto de esta conversación ya no existe");
  }
  const faltan = datosQueFaltanParaActuar(contacto, contexto.conversation.channel);
  return faltan.length > 0 ? fallo(mensajeFaltanDatos(faltan)) : null;
}

// ---------------------------------------------------------------------------
// D4 (decisión de Rocco, 05/10/2026; FABLE-B-02, docs-privados, local): como
// máximo 2 reservas futuras activas por contacto desde el agente. Una persona
// que quiere una tercera, o cambiar una, habla con alguien del equipo. Lo que
// carga una persona desde el CRM no tiene este tope.
// ---------------------------------------------------------------------------
export const MAX_RESERVAS_FUTURAS_POR_CONTACTO = 2;
export const MENSAJE_TOPE_DE_RESERVAS = `Este cliente ya tiene ${String(MAX_RESERVAS_FUTURAS_POR_CONTACTO)} reservas futuras activas, que es el máximo que se puede agendar desde el chat. No reservaste nada nuevo: decíselo, y si necesita otra o quiere cambiar una, derivá la conversación a una persona.`;

// FABLE-I-06 / B-15 (docs-privados, local): de dónde vino la oportunidad que
// crea el agente. Desde B2 (migración 20261022120000) el enum tiene valor para
// los cuatro canales. Exportado para fijarlo con un test.
export const ORIGEN_POR_CANAL: Record<ConversationChannel, OpportunityLeadSource> = {
  WEB: "WEBSITE",
  WHATSAPP: "WHATSAPP",
  MESSENGER: "MESSENGER",
  INSTAGRAM: "INSTAGRAM",
};

// Serializable: va a Message.toolCalls y, como string JSON, de vuelta al
// modelo.
export type ResultadoDeTool = { ok: true; data: unknown } | { ok: false; error: string };

export interface ToolDelAgente {
  definition: LlmToolDefinition;
  ejecutar(
    args: Record<string, unknown>,
    contexto: ContextoDeEjecucionDeTool,
  ): Promise<ResultadoDeTool>;
}

// Ítem 179: exportados —junto con validarArgs, conErroresDeNegocio y los
// helpers de argumentos opcionales de más abajo— para el catálogo del agente
// interno (internalAgentTools.service.ts). Es la misma mecánica de
// validación y de errores de negocio; lo que NO se comparte es el catálogo.
export function fallo(error: string): ResultadoDeTool {
  return { ok: false, error };
}

export function exito(data: unknown): ResultadoDeTool {
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// EL RESULTADO VACÍO ES EL MOMENTO DE MÁXIMO RIESGO DE INVENCIÓN (ítem 91).
//
// Casos reales de producción: `get_service_types` devolvió `{serviceTypes: []}`
// y el agente le ofreció al cliente "Test Drive" y "Visita a Concesionario",
// dos servicios que no existen en el sistema. `get_payment_info` devolvió
// `{hasPaymentLink: false, hasBankTransfer: false}` y el agente contestó que
// aceptaban transferencia y link de pago, y se ofreció a generarlo.
//
// La description de get_payment_info YA decía "Si no hay ningún medio de pago
// configurado, decíselo al cliente: no inventes uno" — y el modelo la ignoró.
// Esa es la lección del ítem 87: una instrucción lejana, leída una vez al
// principio, no compite con un resultado vacío que el modelo interpreta como
// "esta tool no me sirvió, contesto con lo que sé del mundo".
//
// Por eso la instrucción viaja EN EL RESULTADO, que es lo que el modelo está
// leyendo en el momento exacto en que decide qué contestar. `sinResultados`
// hace el vacío explícito (un array vacío es fácil de pasar por alto entre
// llaves) y `queHacer` dice, en imperativo y en el idioma del agente, qué
// corresponde contestar.
//
// No es una garantía —nada que dependa de un LLM lo es— pero es la mitigación
// más fuerte disponible sin cambiar de modelo, y es acumulativa con el prompt.
// ---------------------------------------------------------------------------

function exitoVacio(
  data: Record<string, unknown>,
  queHacer: string,
  extra: Record<string, unknown> = {},
): ResultadoDeTool {
  return exito({ ...data, sinResultados: true, queHacer, ...extra });
}

// Un error de validación es del MODELO, no del negocio (ítem 101).
//
// Caso real: el modelo llamó a get_availability con `desde` y `hasta` en el
// mismo instante. La validación lo rechazó correctamente ("hasta debe ser
// posterior a desde") y el modelo le contestó al cliente:
//
//   "Disculpá, el próximo miércoles a las 11:00 ya no está disponible.
//    ¿Te gustaría buscar otra hora o día?"
//
// Ese horario estaba perfectamente libre. El modelo leyó "la tool falló" y lo
// tradujo a un hecho sobre la agenda del negocio, que es lo que el cliente se
// lleva. La misma trampa que los resultados vacíos del ítem 91: un resultado
// que el modelo no sabe interpretar lo completa con lo que suena razonable.
//
// El texto del error se lo dice de frente y le prohíbe la conclusión. Va acá,
// en el único lugar por donde pasan los argumentos inválidos de las once
// tools, en vez de repetirlo en cada description.
export const SUFIJO_ERROR_DE_ARGUMENTOS =
  " — Este es un error TUYO al armar la llamada, no una respuesta del negocio. Corregí los argumentos y volvé a llamarla. NO le informes nada de esto al cliente ni saques ninguna conclusión: no le digas que no hay disponibilidad, que algo no existe, que está ocupado ni que no se pudo hacer.";

// Los argumentos vienen del modelo, así que son tan poco confiables como un
// body HTTP: se validan con Zod igual que en un controller. Un fallo de
// validación es un resultado de tool, no un 400 — el modelo puede corregirse.
//
// `sufijo` existe por el agente interno (ítem 179): SUFIJO_ERROR_DE_ARGUMENTOS
// habla de "el cliente", y del otro lado de ese agente hay un empleado.
export function validarArgs<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  args: unknown,
  sufijo: string = SUFIJO_ERROR_DE_ARGUMENTOS,
) {
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { ok: true as const, value: parsed.data };
  }
  const detalle = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
    .join("; ");
  return {
    ok: false as const,
    resultado: fallo(`Argumentos inválidos — ${detalle}${sufijo}`),
  };
}

// Ejecuta `fn` y traduce un AppError del service a un resultado de tool. Todo
// lo demás se propaga (ver el encabezado).
export async function conErroresDeNegocio(
  fn: () => Promise<ResultadoDeTool>,
): Promise<ResultadoDeTool> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.isOperational) {
      return fallo(err.message);
    }
    throw err;
  }
}

const uuid = (campo: string) => z.string().uuid(`${campo} debe ser un UUID`);

// ---------------------------------------------------------------------------
// "NO VINO" DICHO CON UN VALOR VACÍO (ítem 86).
//
// Un modelo chico (el caso real fue openai/gpt-4.1-nano) no siempre omite un
// argumento opcional que no tiene: manda la clave con un valor "vacío" —"",
// "   ", null—. Con un schema estricto eso es un error de validación, y el
// modelo, al leerlo, le pide al cliente justo el dato que el cliente no dio.
// Estos helpers tratan esos valores como ausentes en TODOS los argumentos
// opcionales de las tools, no solo en el que se rompió.
//
// Solo para OPCIONALES: un requerido vacío sigue siendo un error, y el modelo
// tiene que leerlo.
// ---------------------------------------------------------------------------

function esVacio(v: unknown): boolean {
  return v === null || (typeof v === "string" && v.trim() === "");
}

export function vacioComoAusente<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (esVacio(v) ? undefined : v), schema.optional());
}

export function textoOpcional(max: number) {
  return vacioComoAusente(z.string().trim().min(1).max(max));
}

// Para números opcionales donde 0 no puede ser un filtro con sentido (un
// precio máximo de 0, un kilometraje máximo de 0 como "sin tope"): el modelo
// que manda 0 está diciendo "no vino". NO se usa donde 0 es un valor real
// (score de un lead, un monto de presupuesto).
function ceroComoAusente<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (esVacio(v) || v === 0 ? undefined : v), schema.optional());
}

// Cuenta los argumentos que vinieron DE VERDAD. Con los helpers de arriba una
// clave que llegó como "" queda en el objeto con valor undefined, y un
// Object.keys la seguiría contando.
function cantidadDeArgumentos(data: Record<string, unknown>): number {
  return Object.values(data).filter((v) => v !== undefined).length;
}

// Un instante ISO 8601 con zona (el modelo tiene que ser explícito: una fecha
// "flotante" se interpretaría con la zona del servidor, que no es la de la
// sucursal).
export const instanteIso = z
  .string()
  .datetime({
    offset: true,
    message: "debe ser una fecha-hora ISO 8601 con zona (ej. 2026-09-14T15:00:00-03:00)",
  })
  .transform((v) => new Date(v));

// ---------------------------------------------------------------------------
// LA OPORTUNIDAD SE VINCULA AL VEHÍCULO (ítem 107)
// ---------------------------------------------------------------------------
// El agente no mandaba `amount`, así que las oportunidades quedaban en 0: en
// producción, 4 de 6 de las que creó valían cero pesos para el pipeline,
// después de conversaciones que giraban enteras alrededor de un auto concreto
// de 38.000 dólares. Un pipeline que no suma no le sirve a nadie.
//
// EL VEHÍCULO SE RESUELVE PARA LEER SU PRECIO, NO PARA VINCULARLO.
// `Opportunity.vehicleId` existe y parecía el lugar natural, pero vincular una
// unidad a una oportunidad abierta LA RESERVA (opportunity.service.ts:
// "abierta la reserva" — y "mientras una oportunidad la tiene reservada
// ninguna otra puede vincularla"). Eso saca el auto del stock para todos los
// demás.
//
// Que un agente de IA reserve una unidad porque alguien escribió "me interesa
// la Hilux" es exactamente lo que el producto dice que la IA no hace sola, y
// lo mismo que el ítem 92 le prohíbe en materia comercial. Así que acá se lee
// el precio y nada más. Si el negocio quiere que el agente reserve, es una
// decisión suya y necesita su propia tool, explícita: es reserve_vehicle
// (ítem 175), apagada salvo que el negocio la habilite en su agente.
//
// Se resuelve por TEXTO ("Hilux SRV"), no por id, por la misma razón del ítem
// 106: acarrear UUIDs es lo que el modelo hace mal, y el nombre del auto es lo
// que la conversación ya tiene a mano.
//
// SOLO SE BUSCA ENTRE LAS UNIDADES PUBLICADAS Y DISPONIBLES — el mismo recorte
// que search_vehicles. Una oportunidad no puede quedar apuntando a una unidad
// que el agente no tenía derecho a mencionar.
const MAX_VEHICULOS_PARA_RESOLVER = 50;

function palabrasNormalizadas(texto: string): string[] {
  return normalizarNombre(texto)
    .split(" ")
    .filter((p) => p.length > 0);
}

interface VehiculoNombrable {
  internalCode: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
}

function etiquetaDeVehiculo(v: VehiculoNombrable): string {
  return [v.make, v.model, v.trim, v.year].filter(Boolean).join(" ");
}

// Todas las palabras que dijo el cliente tienen que aparecer: "Hilux SRV"
// encuentra la SRV y no la DX, y "Hilux" solo devolvería las dos (y pide
// desambiguar, que es lo correcto). Ítem 175: fuera de resolverVehiculo para
// que reserve_vehicle reconozca con el mismo criterio la unidad que la
// oportunidad ya tiene reservada.
function coincideConTexto(v: VehiculoNombrable, texto: string): boolean {
  const heno = normalizarNombre(`${v.internalCode} ${etiquetaDeVehiculo(v)}`);
  return palabrasNormalizadas(texto).every((palabra) => heno.includes(palabra));
}

// ---------------------------------------------------------------------------
// B-17 (docs-privados/auditoria-2026-09-30-corta.md, local): el precio de una
// unidad "a consultar" no puede llegarle al modelo por el monto de la
// oportunidad.
//
// Vincular una unidad (reserve_vehicle, o un vendedor desde el panel) le copia
// a la oportunidad el precio de lista de la unidad —priceFromVehicle, en
// opportunity.service.ts—, sin mirar si el negocio decidió no publicarlo. Y
// create_opportunity/update_opportunity devolvían ese amount tal cual: en el
// turno siguiente el modelo tenía el precio que el negocio no publica (ítem
// 123).
//
// Regla: si la oportunidad tiene una unidad vinculada cuyo precio en ESA
// moneda no se publica —priceOnRequest, o publicationCurrency que excluye la
// moneda del monto—, el resultado va con amount y currency en null y
// precioAConsultar: true. Si no tiene unidad vinculada, el monto sale tal cual:
// o lo mandó el propio modelo, o salió de resolverVehiculo, que ya filtra el
// precio publicado.
// ---------------------------------------------------------------------------

export const NOTA_PRECIO_A_CONSULTAR =
  "La unidad de esta oportunidad es a consultar: su precio no se publica y vos no lo sabés. No le digas al cliente un monto; ofrecele que alguien del equipo se lo confirme.";

// Pura y exportada para probarla sin base.
export function precioOcultoParaElModelo(
  unidad: { priceOnRequest: boolean; publicationCurrency: string },
  currency: string | null,
): boolean {
  if (unidad.priceOnRequest) {
    return true;
  }
  if (currency === null) {
    return false;
  }
  return currency === "USD"
    ? unidad.publicationCurrency === "LOCAL_ONLY"
    : unidad.publicationCurrency === "USD_ONLY";
}

async function montoParaElModelo(
  oportunidad: { amount: unknown; currency: string | null; vehicleId: string | null },
  contexto: ContextoDeEjecucionDeTool,
): Promise<
  | { amount: unknown; currency: string | null }
  | { amount: null; currency: null; precioAConsultar: true; notaDePrecio: string }
> {
  if (oportunidad.vehicleId) {
    const unidad = await findVehicleById(oportunidad.vehicleId, contexto.organizationId);
    if (unidad && precioOcultoParaElModelo(unidad, oportunidad.currency)) {
      return {
        amount: null,
        currency: null,
        precioAConsultar: true,
        notaDePrecio: NOTA_PRECIO_A_CONSULTAR,
      };
    }
  }
  return { amount: oportunidad.amount, currency: oportunidad.currency };
}

async function resolverVehiculo(
  texto: string,
  contexto: ContextoDeEjecucionDeTool,
): Promise<
  | { ok: true; vehiculo: { id: string; etiqueta: string; priceListUsd: number | null } }
  | { ok: false; resultado: ResultadoDeTool }
> {
  const publicados = await findManyVehicles(
    contexto.organizationId,
    { status: ["AVAILABLE"], publishOnWebsite: true },
    { skip: 0, take: MAX_VEHICULOS_PARA_RESOLVER },
    { sortBy: "priceListUsd", sortOrder: "asc" },
  );

  const candidatos = publicados.filter((v) => coincideConTexto(v, texto));

  if (candidatos.length === 1) {
    const v = candidatos[0];
    return {
      ok: true,
      vehiculo: {
        id: v.id,
        etiqueta: etiquetaDeVehiculo(v),
        // Solo el precio que el negocio publica (ítem 98), y nunca el de una
        // unidad "a consultar".
        priceListUsd:
          v.priceOnRequest || v.publicationCurrency === "LOCAL_ONLY"
            ? null
            : decimalANumero(v.priceListUsd),
      },
    };
  }
  if (candidatos.length === 0) {
    return {
      ok: false,
      resultado: fallo(
        `No hay ninguna unidad publicada que coincida con "${texto}". Buscá primero en el stock y usá la marca y el modelo tal cual figuran ahí.`,
      ),
    };
  }
  return {
    ok: false,
    resultado: fallo(
      `"${texto}" coincide con más de una unidad: ${candidatos.map((v) => `"${etiquetaDeVehiculo(v)}"`).join(", ")}. Preguntale al cliente cuál es y volvé a intentarlo con esa.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// create_opportunity
// ---------------------------------------------------------------------------

const createOpportunityArgs = z.object({
  title: z.string().trim().min(1, "title es requerido").max(255),
  // Decisión de Rocco (08/10/2026): OBLIGATORIO, y uno de la lista de
  // utils/iniciativaDelCliente.ts. Es lo que hace que una oportunidad exista
  // solo con iniciativa del cliente: sin un motivo de la lista, el argumento
  // no valida, y el modelo no puede inventar uno porque es un enum.
  motivo: z.enum(MOTIVOS_DE_OPORTUNIDAD, {
    errorMap: () => ({
      message: `motivo es requerido y tiene que ser uno de: ${MOTIVOS_DE_OPORTUNIDAD.join(", ")}`,
    }),
  }),
  amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
  currency: vacioComoAusente(currencySchema),
  // Ítem 107: por texto, no por id (mismo criterio que `servicio` en el 106).
  vehiculo: textoOpcional(255),
});

// ---------------------------------------------------------------------------
// El motivo queda EN LA OPORTUNIDAD, como una nota (Activity NOTE colgada de la
// oportunidad y del contacto, con el vendedor como autor): sin migración, y es
// lo que el vendedor ve en Actividades. En el reuso (ítem 84) también se anota,
// porque es una iniciativa nueva sobre la misma venta; si la última nota de
// motivo ya dice lo mismo, no se repite. Si la nota no se puede guardar, la
// oportunidad queda igual y el modelo se entera por `motivoRegistrado`.
// ---------------------------------------------------------------------------

const CANAL_EN_PROSA: Record<ConversationChannel, string> = {
  WEB: "el widget web",
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
};

async function anotarMotivoEnLaOportunidad(
  oportunidad: { id: string; ownerId: string },
  motivo: IniciativaDelCliente,
  contexto: ContextoDeEjecucionDeTool,
): Promise<boolean> {
  const subject = asuntoDeLaNotaDeMotivo(motivo);
  try {
    const [ultima] = await findManyActivities(
      contexto.organizationId,
      { opportunityId: oportunidad.id, type: "NOTE", search: PREFIJO_NOTA_DE_MOTIVO },
      { skip: 0, take: 1 },
      { sortBy: "createdAt", sortOrder: "desc" },
    );
    if (ultima && ultima.subject === subject) {
      return true;
    }
    await createActivity(contexto.organizationId, oportunidad.ownerId, {
      type: "NOTE",
      subject,
      body: `Lo registró el agente de IA desde la conversación por ${CANAL_EN_PROSA[contexto.conversation.channel]}.`,
      contactId: contexto.conversation.contactId,
      opportunityId: oportunidad.id,
    });
    return true;
  } catch (err) {
    logger.warn(
      { err, organizationId: contexto.organizationId, opportunityId: oportunidad.id, motivo },
      "No se pudo guardar la nota con el motivo de la oportunidad",
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// F2 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub) — la unidad de interés NO se vincula.
//
// La prueba en vivo vio `create_opportunity {vehiculo: "Honda Civic EXL"}`
// devolver `unidad: "Honda Civic EXL 2018"` con la oportunidad guardada sin
// vehicleId: el modelo entendía "unidad vinculada" y el vendedor veía una
// oportunidad sin la unidad. Guardar el vehicleId NO es el arreglo: en este
// sistema vincular una unidad a una oportunidad abierta la RESERVA (queda
// RESERVED y sale del stock para todos, vehicleStatusForOpportunityStatus), y
// el ítem 175 decidió que reservar desde el agente es otra tool
// (reserve_vehicle), apagada por defecto y solo para un cliente que confirmó
// esa unidad — nunca para un "me interesa". Decisión de Rocco (29/09):
//   - la unidad queda NOMBRADA EN EL TÍTULO, siempre, para que el vendedor la
//     vea en el pipeline aunque el modelo no la haya escrito;
//   - el resultado le dice al modelo que es de interés y NO quedó reservada.
// Desde la migración 20261020120000 existe además el vehículo de interés del
// CONTACTO, separado de la reserva: create_lead/update_lead lo anotan
// (vehiculoDeInteres, más abajo).
// ---------------------------------------------------------------------------

export const NOTA_UNIDAD_DE_INTERES =
  "La unidad quedó registrada como de interés en el título de la oportunidad, pero NO está reservada: sigue disponible para otros clientes. No le digas al cliente que se la reservaste. Reservarla es reserve_vehicle (si la tenés entre tus herramientas y el cliente confirmó que quiere avanzar con esa unidad); si no, lo hace una persona del equipo.";

const MAX_TITULO = 255;

// El título con la etiqueta de la unidad. Si ya la nombra —todas las palabras
// de la etiqueta aparecen, sin importar el orden ni los acentos— se deja como
// está; si no, se le agrega al final. Recorta el título del modelo, nunca la
// etiqueta, para no pasarse de los 255 de la columna. Exportada para testearla.
export function tituloConUnidad(titulo: string, etiqueta: string): string {
  const normalizado = normalizarNombre(titulo);
  if (palabrasNormalizadas(etiqueta).every((palabra) => normalizado.includes(palabra))) {
    return titulo;
  }
  const sufijo = ` — ${etiqueta}`;
  return `${titulo.slice(0, Math.max(0, MAX_TITULO - sufijo.length)).trimEnd()}${sufijo}`;
}

export function mensajeReusoConOtraUnidadReservada(etiqueta: string): string {
  return `La oportunidad abierta de este contacto ya tiene reservada otra unidad ("${etiqueta}"): no se cambió nada. Cambiar la unidad lo hace una persona del equipo, no vos; si el cliente ahora quiere otra, decile que alguien del equipo lo va a gestionar, y derivá si hace falta.`;
}

// La oportunidad abierta del contacto de la conversación: la que create_opportunity
// reusa (ítem 84), la que update_opportunity y reserve_vehicle toman sin id
// (ítem 112) y a la que create_booking vincula la reserva (F3). Con más de una
// OPEN (datos de antes del ítem 84) gana la más reciente. Un único criterio
// para las cuatro tools: si divergieran, la reserva quedaría colgada de una
// oportunidad distinta de la que el modelo acaba de crear.
async function oportunidadAbiertaDelContacto(organizationId: string, contactId: string) {
  const [abierta] = await findManyOpportunities(
    organizationId,
    { contactId, status: "OPEN" },
    { skip: 0, take: 1 },
    { sortBy: "createdAt", sortOrder: "desc" },
  );
  return abierta ?? null;
}

export const MENSAJE_CONTACTO_SIN_VENDEDOR =
  "No se puede crear la oportunidad: el contacto no tiene un vendedor asignado";
export const MENSAJE_SIN_PIPELINE_POR_DEFECTO =
  "No se puede crear la oportunidad: la organización no tiene un pipeline por defecto configurado";
export const MENSAJE_PIPELINE_SIN_ETAPAS =
  "No se puede crear la oportunidad: el pipeline por defecto no tiene etapas";

// Ítem 124: existe el pipeline, tiene etapas, y TODAS son de cierre. Es una
// configuración rota del negocio, no un error del modelo: no hay ninguna etapa
// donde poner algo que recién empieza. Se dice qué pasa y qué hacer —seguir la
// conversación— para que el modelo no lo traduzca a "no te puedo atender".
export const MENSAJE_PIPELINE_SIN_ETAPA_ABIERTA =
  "No se puede crear la oportunidad: el pipeline por defecto no tiene ninguna etapa abierta (todas marcan ganado o perdido). Es un problema de configuración del negocio, no algo que el cliente hizo mal ni algo que puedas arreglar reintentando: seguí la conversación normalmente y NO le menciones nada de esto.";

// La descripción, con la lista de iniciativas y lo que NO lo es, tomadas del
// único lugar donde viven (utils/iniciativaDelCliente.ts). Exportada porque el
// frontend la espeja a mano (frontend/src/features/agent/tools.ts) y los tests
// comprueban que diga lo mismo que el prompt.
export const DESCRIPCION_DE_CREATE_OPPORTUNITY = `Crea una oportunidad de venta para el contacto de esta conversación, asignada al vendedor del contacto en la primera etapa del pipeline por defecto. Se llama SOLO cuando el cliente toma la iniciativa de avanzar, y eso es exactamente una de estas cosas (es el \`motivo\`, obligatorio): ${enumerarIniciativas()}. NO la llames ante una consulta de información: ${CONSULTAS_QUE_NO_SON_INICIATIVA} no es tomar la iniciativa, y tampoco lo son un «me interesa mucho la Hilux SRV», un «qué lindo» o un «lo voy a pensar»; ahí contestás y el interés queda anotado en la ficha del contacto (la búsqueda guarda lo que busca y update_lead anota la unidad de interés), sin crear ninguna oportunidad. Antes de llamarla necesitás el nombre Y el apellido del cliente: si el CRM no los tiene, o tiene solo uno, pedíselos en ese momento, guardalos con update_lead (firstName y lastName) y recién después llamala; si faltan, esta herramienta no registra nada y te lo dice. Cuando hay iniciativa y tenés el nombre, llamala en ese mismo turno y sin pedirle permiso: registrar la oportunidad no compromete al cliente a nada ni cierra ninguna venta, es lo que hace que un vendedor lo vea y lo atienda. Si la conversación es por un vehículo concreto, mandá \`vehiculo\` con su marca y modelo: el monto se completa con su precio de lista, que es lo que el equipo de ventas necesita ver en el pipeline, y la unidad queda nombrada en el título; registrar la oportunidad NO la reserva. Si el contacto ya tiene una oportunidad abierta, no crea otra: devuelve esa con reused en true y le anota el motivo nuevo, y es sobre esa que tenés que seguir. Para cambiarle el título, el monto u otro dato usá update_opportunity con su opportunityId, no vuelvas a llamar a esta.`;

const createOpportunityTool: ToolDelAgente = {
  definition: {
    name: "create_opportunity",
    description: DESCRIPCION_DE_CREATE_OPPORTUNITY,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título corto de la oportunidad (qué quiere el contacto).",
        },
        motivo: {
          type: "string",
          enum: MOTIVOS_DE_OPORTUNIDAD,
          description: `OBLIGATORIO: la iniciativa que tomó el cliente, la que justifica esta oportunidad. ${Object.entries(
            INICIATIVAS_DEL_CLIENTE,
          )
            .map(([clave, etiqueta]) => `${clave} = ${etiqueta}`)
            .join(
              "; ",
            )}. Si lo que hizo el cliente no es ninguna de estas, NO llames a esta herramienta.`,
        },
        vehiculo: {
          type: "string",
          description:
            'Marca y modelo del vehículo que le interesa al cliente, como figura en el stock (por ejemplo "Hilux SRV"). Mandalo siempre que la conversación sea por una unidad concreta. La unidad queda anotada en la ficha del contacto como su vehículo de interés; NO la reserva.',
        },
        amount: {
          type: "number",
          description:
            "Monto estimado. NO hace falta si mandás `vehiculo`: se completa con el precio de lista. Mandalo solo si el cliente dijo un monto distinto (por ejemplo lo que ofrece pagar).",
        },
        currency: {
          type: "string",
          description:
            "Moneda del monto, código ISO 4217 de 3 letras (USD, UYU, ARS). Solo si hay monto.",
        },
      },
      required: ["title", "motivo"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(createOpportunityArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const input = validacion.value;

    return conErroresDeNegocio(async () => {
      const contact = await findContactById(
        contexto.conversation.contactId,
        contexto.organizationId,
      );
      if (!contact) {
        return fallo("El contacto de esta conversación ya no existe");
      }
      // Primero la identidad: nombre y apellido en todos los canales, y por
      // WEB además un teléfono o un email (D3). Ver datosQueFaltanParaActuar.
      const faltan = datosQueFaltanParaActuar(contact, contexto.conversation.channel);
      if (faltan.length > 0) {
        return fallo(mensajeFaltanDatos(faltan));
      }

      // Ítem 84: una sola oportunidad OPEN por contacto desde el agente. Si ya
      // hay una, se devuelve esa con `reused: true` —un dato, no solo un texto,
      // para que el modelo sepa que no creó nada— y el modelo sigue sobre ella
      // (update_opportunity para cambiarla). Con más de una OPEN (datos de
      // antes de este ítem) gana la más reciente: arreglar duplicados
      // históricos no es trabajo de esta tool.
      //
      // VA ANTES de resolver el vendedor, a propósito: resolverOwnerDelContacto
      // puede ESCRIBIR (asigna el vendedor por defecto de la sucursal al
      // Contact, ítem 69), y devolver algo que ya existe no tiene por qué tener
      // ese efecto — ni fallar porque el contacto no tenga vendedor.
      //
      // No es un candado: dos turnos concurrentes del mismo contacto podrían
      // crear dos. Los turnos de una conversación no corren en paralelo en la
      // práctica, y lo que este ítem arregla es el caso secuencial.
      const existente = await oportunidadAbiertaDelContacto(contexto.organizationId, contact.id);
      if (existente) {
        // Ítem 112. El reuso tal como estaba DESCARTABA el auto nuevo en
        // silencio. Caso real contra el modelo: el cliente pasó de la Amarok a
        // la Hilux SRV, el modelo volvió a llamar a create_opportunity con
        // `vehiculo: "Hilux SRV"`, la tool devolvió ok con la oportunidad de la
        // Amarok intacta —título "Interés en Amarok", monto 42.000— y el
        // agente le dijo al cliente "ya registré tu interés por la Hilux SRV".
        // No había registrado nada de la Hilux.
        //
        // El resultado decía la verdad (`reused: true`) y aun así el modelo
        // entendió que había funcionado, lo cual es razonable: la tool contestó
        // que sí. Con un `ok` de por medio, la instrucción del ítem 100 no
        // tiene con qué defenderse; el que mintió fue el backend primero.
        //
        // Así que cuando la llamada trae un vehículo, el reuso APLICA el
        // cambio en vez de ignorarlo: es exactamente lo que hace
        // update_opportunity con `vehiculo`, y es lo que el cliente pidió. El
        // reuso sin vehículo no cambia: devuelve lo que hay, como siempre.
        const cambios: { title?: string; amount?: number; currency?: string } = {};
        let unidadDelReuso: string | null = null;
        if (input.vehiculo !== undefined && existente.vehicleId) {
          // F2: la oportunidad ya tiene una unidad VINCULADA (reservada por un
          // vendedor o por reserve_vehicle). Esa manda: el reuso no le cambia
          // el título ni el monto por los de otra unidad —quedarían hablando
          // de un auto mientras el reservado es otro— y no la suelta. Si el
          // modelo nombró justo la reservada, es la misma: se devuelve tal
          // cual. resolverVehiculo no serviría para reconocerla: solo ve las
          // AVAILABLE.
          const reservada = await findVehicleById(existente.vehicleId, contexto.organizationId);
          const etapa = await findStageById(existente.stageId, contexto.organizationId);
          const etiquetaReservada = reservada ? etiquetaDeVehiculo(reservada) : null;
          const esLaMisma = reservada !== null && coincideConTexto(reservada, input.vehiculo);
          return exito({
            opportunityId: existente.id,
            title: existente.title,
            ...(await montoParaElModelo(existente, contexto)),
            status: existente.status,
            stage: etapa?.name ?? null,
            reused: true,
            actualizada: false,
            unidadReservada: etiquetaReservada,
            ...(esLaMisma
              ? {}
              : {
                  nota: mensajeReusoConOtraUnidadReservada(
                    etiquetaReservada ?? "una unidad del stock",
                  ),
                }),
          });
        }
        let interesDelReuso: Record<string, unknown> = {};
        if (input.vehiculo !== undefined) {
          const resuelto = await resolverVehiculo(input.vehiculo, contexto);
          if (!resuelto.ok) {
            return resuelto.resultado;
          }
          unidadDelReuso = resuelto.vehiculo.etiqueta;
          // B1: también como vehículo de interés en la ficha.
          interesDelReuso = await anotarInteresEnLaUnidad(resuelto.vehiculo, contexto);
          // F2: la unidad siempre nombrada en el título, sin duplicarla.
          cambios.title = tituloConUnidad(input.title, unidadDelReuso);
          if (input.amount === undefined && resuelto.vehiculo.priceListUsd !== null) {
            cambios.amount = resuelto.vehiculo.priceListUsd;
            cambios.currency = input.currency ?? "USD";
          } else if (input.amount !== undefined) {
            cambios.amount = input.amount;
            cambios.currency = input.currency ?? existente.currency;
          }
        }

        const vigente =
          Object.keys(cambios).length > 0
            ? await updateOpportunity(
                contexto.organizationId,
                existente.ownerId,
                existente.id,
                cambios,
              )
            : existente;

        const etapa = await findStageById(vigente.stageId, contexto.organizationId);
        const motivoRegistrado = await anotarMotivoEnLaOportunidad(vigente, input.motivo, contexto);
        return exito({
          opportunityId: vigente.id,
          title: vigente.title,
          ...(await montoParaElModelo(vigente, contexto)),
          status: vigente.status,
          stage: etapa?.name ?? null,
          reused: true,
          motivo: INICIATIVAS_DEL_CLIENTE[input.motivo],
          motivoRegistrado,
          // Para que el modelo pueda contar lo que de verdad pasó: si es false,
          // la oportunidad quedó como estaba y no registró nada nuevo.
          actualizada: Object.keys(cambios).length > 0,
          ...(unidadDelReuso !== null
            ? { unidad: unidadDelReuso, unidadReservada: false, nota: NOTA_UNIDAD_DE_INTERES }
            : {}),
          ...interesDelReuso,
        });
      }

      // El ownerId del contacto, o el vendedor por defecto de la sucursal si
      // no tenía ninguno (ítem 69). Si lo resolvió por la sucursal, el Contact
      // ya quedó asignado a esa persona dentro de esta llamada — no hace falta
      // releerlo, alcanza con el id devuelto. `null` es el caso residual
      // aceptado: la sucursal tampoco tiene un vendedor por defecto, y entonces
      // esto falla exactamente como fallaba antes de este ítem.
      const ownerId = await resolverOwnerDelContacto(
        contexto.organizationId,
        contexto.conversation.branchId,
        contact,
      );
      if (!ownerId) {
        return fallo(MENSAJE_CONTACTO_SIN_VENDEDOR);
      }

      const pipeline = await findDefaultPipeline(contexto.organizationId);
      if (!pipeline) {
        return fallo(MENSAJE_SIN_PIPELINE_POR_DEFECTO);
      }
      // Ordenados por `order` asc, solo activos.
      const etapas = await findStagesByPipeline(pipeline.id);
      if (etapas.length === 0) {
        return fallo(MENSAJE_PIPELINE_SIN_ETAPAS);
      }
      // Ítem 124: la primera ABIERTA, no la primera a secas.
      //
      // Un pipeline puede tener "Ganado" o "Perdido" en el primer lugar —el
      // orden lo arma el negocio y nadie le prohíbe eso—. Antes se creaba una
      // oportunidad OPEN parada en una etapa de cierre, que es un dato
      // incoherente que después nadie entiende; desde el ítem 154 de la matriz
      // del CRM eso además da 400, y el modelo ve el error y se lo come el
      // cliente. Ninguna de las dos cosas tiene que pasar: una oportunidad que
      // recién nace está abierta, y la etapa donde se para tiene que decir eso.
      const primeraEtapa = etapas.find((e) => !e.isWon && !e.isLost);
      if (!primeraEtapa) {
        return fallo(MENSAJE_PIPELINE_SIN_ETAPA_ABIERTA);
      }

      // actorUserId = el vendedor efectivo del contacto (el suyo, o el de la
      // sucursal): es a quien se le atribuye la oportunidad. resolveOwnerId lo
      // revalida adentro de createOpportunity; si no estuviera activo, el
      // AppError vuelve como resultado.
      //
      // SIN vehicleId, a propósito (F2, ver NOTA_UNIDAD_DE_INTERES): vincular
      // la unidad la reservaría y la sacaría del stock, y eso es reserve_vehicle
      // (ítem 175), no un "me interesa". La unidad queda nombrada en el título.
      // Ítem 107: el vehículo y, si el modelo no mandó monto, su precio de
      // lista. Un monto explícito del modelo SIEMPRE gana — puede ser lo que
      // el cliente ofreció, y registrarlo es correcto (ítem 92: registrar no
      // es aceptar).
      let unidad: string | undefined;
      let amount = input.amount;
      let currency = input.currency;
      let title = input.title;
      // B1: la unidad elegida queda además como vehículo de interés en la
      // ficha del contacto (ver anotarInteresEnLaUnidad).
      let interes: Record<string, unknown> = {};
      if (input.vehiculo !== undefined) {
        const resuelto = await resolverVehiculo(input.vehiculo, contexto);
        if (!resuelto.ok) {
          return resuelto.resultado;
        }
        unidad = resuelto.vehiculo.etiqueta;
        title = tituloConUnidad(input.title, unidad);
        if (amount === undefined && resuelto.vehiculo.priceListUsd !== null) {
          amount = resuelto.vehiculo.priceListUsd;
          currency = currency ?? "USD";
        }
        interes = await anotarInteresEnLaUnidad(resuelto.vehiculo, contexto);
      }

      const opportunity = await createOpportunity(contexto.organizationId, ownerId, {
        title,
        amount,
        currency,
        contactId: contact.id,
        ownerId,
        pipelineId: pipeline.id,
        stageId: primeraEtapa.id,
        // FABLE-I-06: el origen, según el canal de la conversación.
        leadSource: ORIGEN_POR_CANAL[contexto.conversation.channel],
      });

      const motivoRegistrado = await anotarMotivoEnLaOportunidad(
        opportunity,
        input.motivo,
        contexto,
      );

      return exito({
        opportunityId: opportunity.id,
        title: opportunity.title,
        ...(await montoParaElModelo(opportunity, contexto)),
        status: opportunity.status,
        motivo: INICIATIVAS_DEL_CLIENTE[input.motivo],
        motivoRegistrado,
        ...(unidad === undefined
          ? {}
          : { unidad, unidadReservada: false, nota: NOTA_UNIDAD_DE_INTERES }),
        ...interes,
        stage: primeraEtapa.name,
        reused: false,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// update_opportunity
// ---------------------------------------------------------------------------

// Ítem 128 (B-01 de docs/auditoria-2026-09-24-punta-a-punta.md): el agente
// puede dar una oportunidad por PERDIDA, con el motivo que dio el cliente, pero
// no puede ganarla, reabrirla ni moverla de etapa. Antes el schema aceptaba
// status WON y stageId, y un "ya la compré, cerrala" (o una inyección) bastaba
// para que el modelo marcara la venta ganada: el contacto pasaba a CUSTOMER,
// salía opportunity.won al outbox y corrían las automatizaciones de la
// organización. INSTRUCCION_SIN_AUTORIDAD_COMERCIAL lo prohibía, pero era
// prompt, no candado. Ganar y mover de etapa quedan para personas.
//
// .strict(): Zod descarta en silencio las claves que no declara (B-06), así
// que sin esto un stageId o un ownerId desaparecerían sin que el modelo se
// entere. Con strict, cualquier clave de más es un error de argumentos que el
// modelo lee.
const updateOpportunityArgs = z
  .object({
    // Ítem 112: OPCIONAL. Ver resolverOportunidad().
    opportunityId: vacioComoAusente(uuid("opportunityId")),
    title: textoOpcional(255),
    amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
    currency: vacioComoAusente(currencySchema),
    status: vacioComoAusente(z.enum(["LOST"])),
    lostReason: textoOpcional(255),
    // Ítem 107: para cuando el cliente cambia de auto a mitad de la charla.
    vehiculo: textoOpcional(255),
  })
  .strict()
  .refine((data) => cantidadDeArgumentos(data) - (data.opportunityId === undefined ? 0 : 1) > 0, {
    message: "Hay que indicar al menos un campo a modificar",
  });

export const MENSAJE_CIERRE_LO_HACE_UNA_PERSONA =
  "Ganar una oportunidad, reabrirla o moverla de etapa lo hace una persona del equipo, no vos: no se cambió nada. Si el cliente dice que ya compró o que quiere cerrar, no le digas que quedó registrado como venta; decile que alguien del equipo lo va a confirmar con él, y derivá si hace falta.";

export const MENSAJE_PERDIDA_SIN_MOTIVO =
  "Para marcar la oportunidad como perdida hace falta el motivo que dio el cliente (lostReason): no se cambió nada. Si el cliente no lo dijo, preguntáselo; no lo inventes.";

export const MENSAJE_MOTIVO_SIN_PERDIDA =
  "El motivo de pérdida (lostReason) va solo junto con status LOST: no se cambió nada. Si el cliente desistió, mandá los dos juntos; si no, no mandes el motivo.";

// Lo que el modelo ya no puede pedir (ítem 128), mirado en los argumentos
// CRUDOS, antes de Zod: tiene que ser un rechazo de negocio que le diga qué
// hacer, no un "argumentos inválidos, corregilos" que lo invite a reintentar.
// Un status vacío o un stageId vacío siguen contando como no enviados (ítem
// 86); cualquier otro status desconocido lo rechaza Zod como siempre.
function pideCierreReservadoAPersonas(args: Record<string, unknown>): boolean {
  const status = typeof args.status === "string" ? args.status.trim().toUpperCase() : args.status;
  return status === "WON" || status === "OPEN" || !esVacio(args.stageId ?? null);
}

export const MENSAJE_OPORTUNIDAD_DE_OTRO_CONTACTO =
  "La oportunidad indicada no pertenece al contacto de esta conversación";

export const MENSAJE_SIN_OPORTUNIDAD_ABIERTA =
  "El contacto de esta conversación no tiene ninguna oportunidad abierta, así que no hay nada que actualizar.";

// Ítem 112. Caso real, en producción: el modelo creó una oportunidad, recibió
// su id en el resultado —e2909afe-…— y en el turno siguiente llamó a
// update_opportunity con 60155209-…, un UUID que se inventó. El backend
// contestó "La oportunidad indicada no existe" y el agente le dijo al cliente
// "hubo un problema al actualizar la información del vehículo, indicame la
// marca y modelo exacto del Territory": le pidió un dato que ya tenía, por un
// error que no tenía nada que ver con el vehículo.
//
// Es el ítem 106 otra vez —ahí el UUID inventado era el del serviceType— y la
// solución es la misma: QUE NO TENGA QUE ACARREAR EL UUID. El contacto de la
// conversación tiene a lo sumo una oportunidad abierta (el ítem 84 hace que
// create_opportunity reuse la que haya en vez de crear otra), así que el
// backend puede resolverla solo.
//
// El id sigue aceptándose por si el modelo lo tiene bien, pero uno que no
// existe o es de otro contacto ya no es un callejón sin salida: el error se
// marca como error de argumentos (ítem 101) y le dice que vuelva a llamar sin
// el id, que es el camino que siempre funciona.
async function resolverOportunidad(
  opportunityId: string | undefined,
  contexto: ContextoDeEjecucionDeTool,
): Promise<
  | {
      ok: true;
      opportunity: {
        id: string;
        contactId: string | null;
        ownerId: string;
        status: OpportunityStatus;
        vehicleId: string | null;
      };
    }
  | { ok: false; resultado: ResultadoDeTool }
> {
  if (opportunityId !== undefined) {
    const opportunity = await findOpportunityById(opportunityId, contexto.organizationId);
    if (!opportunity) {
      return {
        ok: false,
        resultado: fallo(
          `La oportunidad indicada no existe. Volvé a llamarla SIN opportunityId: así se toma la oportunidad abierta del contacto.${SUFIJO_ERROR_DE_ARGUMENTOS}`,
        ),
      };
    }
    // Un agente solo toca las oportunidades del contacto con el que está
    // hablando. Que la organización coincida no alcanza: eso lo garantiza el
    // repositorio, pero no impide que el modelo pase el id de otro cliente.
    if (opportunity.contactId !== contexto.conversation.contactId) {
      return {
        ok: false,
        resultado: fallo(
          `${MENSAJE_OPORTUNIDAD_DE_OTRO_CONTACTO}. Volvé a llamarla SIN opportunityId.${SUFIJO_ERROR_DE_ARGUMENTOS}`,
        ),
      };
    }
    return { ok: true, opportunity };
  }

  // Sin id: la oportunidad abierta del contacto, la misma que devuelve
  // create_opportunity cuando reusa (ítem 84).
  const abierta = await oportunidadAbiertaDelContacto(
    contexto.organizationId,
    contexto.conversation.contactId,
  );
  if (!abierta) {
    // No es un error de argumentos: es un estado legítimo del negocio, y el
    // modelo tiene que saber qué hacer con él en vez de improvisar.
    return {
      ok: false,
      resultado: exitoVacio(
        { opportunityId: null },
        `${MENSAJE_SIN_OPORTUNIDAD_ABIERTA} Si el cliente tomó la iniciativa de avanzar (${enumerarIniciativas()}), usá create_opportunity con su motivo; si solo consultó información, no hay nada que registrar.`,
      ),
    };
  }
  return { ok: true, opportunity: abierta };
}

const updateOpportunityTool: ToolDelAgente = {
  definition: {
    name: "update_opportunity",
    description:
      "Modifica la oportunidad abierta del contacto de esta conversación: título, monto, moneda o vehículo, o la marca como PERDIDA (status LOST) con el motivo que dio el cliente (lostReason, obligatorio en ese caso). No hace falta que sepas su id: si no mandás opportunityId, se toma la que el contacto tiene abierta. NO puede ganarla, reabrirla ni moverla de etapa: eso lo hace una persona del equipo. Tampoco cambia el vendedor ni el pipeline.",
    parameters: {
      type: "object",
      properties: {
        opportunityId: {
          type: "string",
          description:
            "OPCIONAL, y casi siempre sobra: si no lo mandás se toma la oportunidad abierta del contacto de esta conversación, que es la que corresponde. Mandalo SOLO si tenés el id exacto que te devolvió una herramienta en esta misma conversación. Nunca lo inventes ni lo deduzcas.",
        },
        title: { type: "string" },
        amount: { type: "number", description: "Monto, mayor o igual a 0." },
        currency: { type: "string", description: "Código ISO 4217 de 3 letras." },
        status: {
          type: "string",
          enum: ["LOST"],
          description:
            "Solo LOST, cuando el cliente desistió de la compra. Va siempre con lostReason.",
        },
        lostReason: {
          type: "string",
          description:
            "Motivo de pérdida, con las palabras del cliente. Obligatorio con status LOST, y solo va con status LOST.",
        },
        vehiculo: {
          type: "string",
          description:
            "Marca y modelo del vehículo que le interesa al cliente, como figura en el stock. Usalo cuando el cliente cambia de unidad: el monto se reajusta al precio de lista de la nueva, y la nueva queda anotada en la ficha del contacto como su vehículo de interés (NO la reserva).",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    if (pideCierreReservadoAPersonas(args)) {
      return Promise.resolve(fallo(MENSAJE_CIERRE_LO_HACE_UNA_PERSONA));
    }
    // Un stageId vacío es "no vino" (ítem 86), no una clave de más para el
    // .strict(): se saca antes de validar.
    const argsSinEtapa = { ...args };
    delete argsSinEtapa.stageId;
    const validacion = validarArgs(updateOpportunityArgs, argsSinEtapa);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const { opportunityId, vehiculo, ...cambios } = validacion.value;
    if (cambios.status === "LOST" && cambios.lostReason === undefined) {
      return Promise.resolve(fallo(MENSAJE_PERDIDA_SIN_MOTIVO));
    }
    if (cambios.lostReason !== undefined && cambios.status !== "LOST") {
      return Promise.resolve(fallo(MENSAJE_MOTIVO_SIN_PERDIDA));
    }

    return conErroresDeNegocio(async () => {
      const resuelta = await resolverOportunidad(opportunityId, contexto);
      if (!resuelta.ok) {
        return resuelta.resultado;
      }
      const { opportunity } = resuelta;

      // Ítem 107: cambiar de auto a mitad de la conversación. Se resuelve
      // igual que al crear, y el monto se reajusta al precio de la unidad
      // nueva salvo que el modelo mande uno explícito.
      const cambiosConVehiculo = { ...cambios };
      // B1: la unidad nueva queda además como vehículo de interés en la ficha.
      let interes: Record<string, unknown> = {};
      if (vehiculo !== undefined) {
        const resuelto = await resolverVehiculo(vehiculo, contexto);
        if (!resuelto.ok) {
          return resuelto.resultado;
        }
        if (cambiosConVehiculo.amount === undefined && resuelto.vehiculo.priceListUsd !== null) {
          cambiosConVehiculo.amount = resuelto.vehiculo.priceListUsd;
          cambiosConVehiculo.currency = cambiosConVehiculo.currency ?? "USD";
        }
        interes = await anotarInteresEnLaUnidad(resuelto.vehiculo, contexto);
      }

      // actorUserId = el ownerId que la oportunidad ya tiene. Es inerte en este
      // camino: updateOpportunity solo lo usa para resolver un ownerId nuevo
      // (que acá nunca se manda) y para el historial de una unidad vinculada.
      const actualizada = await updateOpportunity(
        contexto.organizationId,
        opportunity.ownerId,
        opportunity.id,
        cambiosConVehiculo,
      );

      return exito({
        opportunityId: actualizada.id,
        title: actualizada.title,
        ...(await montoParaElModelo(actualizada, contexto)),
        status: actualizada.status,
        lostReason: actualizada.lostReason,
        ...interes,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// reserve_vehicle (ítem 175)
// ---------------------------------------------------------------------------
// La tool que el ítem 107 dejó pendiente a propósito: vincular la unidad a la
// oportunidad, que la RESERVA (queda RESERVED y sale del stock para todos).
// Es una decisión del negocio, así que la configurabilidad es la de siempre:
// Agent.enabledTools. Ningún agente la tiene habilitada hasta que un ADMIN la
// prenda desde la pantalla del agente — no hay campo ni flag aparte.
//
// El wrapper no reimplementa nada de la reserva: llama al mismo
// updateOpportunity del panel, que toma el lock de organización, exige que la
// unidad esté AVAILABLE (409 si no, que conErroresDeNegocio devuelve como
// resultado) y le pasa el precio de la unidad a la oportunidad.
//
// Lo que SÍ decide este wrapper, porque el service se lo permitiría a un
// humano pero no a un agente:
//   - Solo sobre una oportunidad ABIERTA. Vincular una unidad a una ganada la
//     pasa a SOLD (vehicleStatusForOpportunityStatus): eso sería vender un auto.
//   - No cambia una unidad ya reservada por otra. El service liberaría la
//     anterior, y esa reserva pudo haberla hecho un vendedor: soltarla es
//     decisión de una persona.
//   - Pedir de nuevo la unidad que ya tiene reservada es un éxito idempotente,
//     no un "no hay ninguna unidad que coincida" (resolverVehiculo solo ve las
//     AVAILABLE) que el modelo le traduciría al cliente como "ya no está".

const reserveVehicleArgs = z
  .object({
    vehiculo: z.string().trim().min(1, "vehiculo es requerido").max(255),
    opportunityId: vacioComoAusente(uuid("opportunityId")),
  })
  .strict();

export const MENSAJE_RESERVA_SOLO_OPORTUNIDAD_ABIERTA =
  "Solo se puede reservar una unidad para una oportunidad abierta: no se reservó nada. Volvé a llamarla SIN opportunityId para usar la oportunidad abierta del contacto.";

export function mensajeYaTieneOtraUnidadReservada(etiqueta: string): string {
  return `La oportunidad de este contacto ya tiene reservada otra unidad ("${etiqueta}"): no se reservó nada. Cambiar la unidad reservada lo hace una persona del equipo, no vos. Si el cliente quiere cambiar de unidad, decile que alguien del equipo lo va a gestionar, y derivá si hace falta.`;
}

const reserveVehicleTool: ToolDelAgente = {
  definition: {
    name: "reserve_vehicle",
    description:
      "Reserva una unidad del stock para el contacto de esta conversación, vinculándola a su oportunidad abierta. Esto SACA LA UNIDAD DEL STOCK para cualquier otro cliente hasta que el equipo la libere. Usala SOLO cuando el cliente confirmó que quiere avanzar con ESA unidad puntual («quiero reservar la Hilux SRV», «apartámela», «vamos con esa»); NO ante un «¿tenés esa camioneta?», una pregunta de precio o un «me interesa»: eso se contesta y no se registra en ninguna parte más que en la ficha del contacto. Si el contacto no tiene una oportunidad abierta, primero llamá a create_opportunity con motivo RESERVA_O_SENA. Hasta que esta tool no devuelva un resultado exitoso, la unidad NO está reservada y no se lo podés confirmar al cliente. Si la unidad ya no está disponible, se te va a avisar: no la presentes como disponible. No cambia una unidad que ya esté reservada por otra.",
    parameters: {
      type: "object",
      properties: {
        vehiculo: {
          type: "string",
          description:
            "Marca y modelo (y versión si hace falta para distinguirla) de la unidad a reservar, tal como figura en el stock.",
        },
        opportunityId: {
          type: "string",
          description:
            "OPCIONAL, y casi siempre sobra: si no lo mandás se toma la oportunidad abierta del contacto de esta conversación, que es la que corresponde. Mandalo SOLO si tenés el id exacto que te devolvió una herramienta en esta misma conversación. Nunca lo inventes ni lo deduzcas.",
        },
      },
      required: ["vehiculo"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(reserveVehicleArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const { vehiculo, opportunityId } = validacion.value;

    return conErroresDeNegocio(async () => {
      // Primero la identidad: nombre y apellido en todos los canales, y por
      // WEB además un teléfono o un email (D3). Ver datosQueFaltanParaActuar.
      const bloqueo = await bloqueoPorIdentidad(contexto);
      if (bloqueo) {
        return bloqueo;
      }
      const resuelta = await resolverOportunidad(opportunityId, contexto);
      if (!resuelta.ok) {
        return resuelta.resultado;
      }
      const { opportunity } = resuelta;
      if (opportunity.status !== "OPEN") {
        return fallo(`${MENSAJE_RESERVA_SOLO_OPORTUNIDAD_ABIERTA}${SUFIJO_ERROR_DE_ARGUMENTOS}`);
      }

      if (opportunity.vehicleId) {
        const reservada = await findVehicleById(opportunity.vehicleId, contexto.organizationId);
        if (reservada && coincideConTexto(reservada, vehiculo)) {
          return exito({
            opportunityId: opportunity.id,
            vehicleId: reservada.id,
            vehiculo: etiquetaDeVehiculo(reservada),
            status: opportunity.status,
            yaEstabaReservada: true,
          });
        }
        return fallo(
          mensajeYaTieneOtraUnidadReservada(
            reservada ? etiquetaDeVehiculo(reservada) : "una unidad del stock",
          ),
        );
      }

      const resuelto = await resolverVehiculo(vehiculo, contexto);
      if (!resuelto.ok) {
        return resuelto.resultado;
      }

      // Sin amount ni currency: el service le pasa a la oportunidad el precio
      // de la unidad, igual que cuando un vendedor la vincula desde el panel.
      // Ese monto NO va en el resultado: es el precio interno, no
      // necesariamente el publicado (ítem 98).
      const actualizada = await updateOpportunity(
        contexto.organizationId,
        opportunity.ownerId,
        opportunity.id,
        { vehicleId: resuelto.vehiculo.id },
      );

      return exito({
        opportunityId: actualizada.id,
        vehicleId: resuelto.vehiculo.id,
        vehiculo: resuelto.vehiculo.etiqueta,
        status: actualizada.status,
        yaEstabaReservada: false,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// get_availability / create_booking
//
// EL RECURSO TIENE QUE SER DE LA SUCURSAL DEL AGENTE. Un Agent es de una
// sucursal (§3) y sus conversaciones llevan ese branchId: el agente de la
// sucursal Centro no ofrece ni reserva turnos de la sucursal Norte, aunque
// las dos sean de la misma organización. Es el mismo invariante que
// validateResourceId de serviceType.service.ts, del lado del agente.
// ---------------------------------------------------------------------------

export const MENSAJE_RECURSO_DE_OTRA_SUCURSAL =
  "El recurso indicado no pertenece a la sucursal de este agente";

async function resolverRecursoDeLaSucursal(
  resourceId: string,
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool | undefined> {
  const resource = await findResourceById(resourceId, contexto.organizationId);
  if (!resource) {
    return fallo("El recurso indicado no existe");
  }
  if (resource.branchId !== contexto.conversation.branchId) {
    return fallo(MENSAJE_RECURSO_DE_OTRA_SUCURSAL);
  }
  return undefined;
}

// La zona horaria de la sucursal de la conversación (ítem 104). Todo horario
// que el agente le muestre al cliente se escribe en ESTA zona, nunca en UTC.
// Si la sucursal no se pudiera leer —caso residual, mismo criterio que
// get_payment_info— se cae a UTC, que al menos es explícito y no una hora
// local inventada.
async function zonaDeLaSucursal(contexto: ContextoDeEjecucionDeTool): Promise<string> {
  const branch = await findBranchById(contexto.conversation.branchId, contexto.organizationId);
  return branch?.timezone ?? "UTC";
}

// ---------------------------------------------------------------------------
// UN SOLO UUID PARA AGENDAR (ítem 102)
// ---------------------------------------------------------------------------
// `ServiceType.resourceId` es obligatorio y único: dado el servicio, el recurso
// que lo provee está completamente determinado. Y el backend YA exige que el
// par sea consistente (resolverContexto: "El servicio indicado no lo provee
// ese recurso"). O sea que pedirle al modelo los dos UUID no le da ninguna
// libertad real — solo le da una forma más de equivocarse, y cada error le
// quema una ronda del turno.
//
// Con `resourceId` opcional, el modelo tiene que acarrear UN identificador en
// vez de dos y emparejarlos bien. Si lo manda igual, se respeta y se valida
// como antes: este cambio no saca ninguna verificación, solo deja de exigir un
// dato que el backend puede deducir.
// ---------------------------------------------------------------------------
// EL SERVICIO SE PUEDE PEDIR POR NOMBRE (ítem 106)
// ---------------------------------------------------------------------------
// Caso real de producción, con el flujo de turnos ya encadenando: el modelo
// consultó disponibilidad con serviceTypeId "7358bbb9-…" y dos mensajes
// después intentó reservar con "8a176846-…" — un UUID que no existe, generado
// de memoria en vez de copiado. La guarda del ítem 102 lo frenó y no se creó
// una reserva falsa, pero la reserva tampoco se hizo.
//
// Acarrear un UUID opaco entre turnos es justo lo que un LLM hace mal, y no
// hay ninguna razón para pedírselo: los servicios de una sucursal son tres o
// cuatro y tienen nombres cortos que el modelo repite sin problema ("Test
// drive"). Así que se acepta el NOMBRE como alternativa, y el backend resuelve
// el id — que es lo que el backend sabe hacer y el modelo no.
//
// El id sigue aceptándose: si el modelo lo copió bien, mejor todavía.
//
// Ítem 122: qué pasa cuando NO manda ninguno de los dos. Antes, un mensaje
// seco —"hay que indicar el servicio"— sin decirle cuáles existen. El modelo
// no tenía entre qué elegir, así que le trasladaba la pregunta al cliente:
//
//   👤 ¿Tenés lugar el viernes para ver un auto?
//   🤖 Para poder ver los horarios, ¿a qué servicio te referís? ¿Querés
//      hacer un test drive o ver un auto en particular?
//
// El cliente vino a preguntar cuándo puede ir y se lleva una pregunta. Ahora:
// si la sucursal tiene UN solo servicio no hay nada que elegir y se resuelve
// solo, y si tiene varios la falla viaja CON la lista de nombres reales, así
// el modelo elige —o pregunta nombrando los que de verdad existen— en el mismo
// turno, sin adivinar. Mismo criterio que la rama de "no existe ese servicio",
// que ya devolvía la lista.
export const MENSAJE_SERVICIO_SIN_IDENTIFICAR =
  'Hay que indicar el servicio: mandá `servicio` con el nombre (por ejemplo "Test drive") o `serviceTypeId` con el id exacto que devolvió la lista de servicios.';

export const SIN_SERVICIOS_CONFIGURADOS =
  "Esta sucursal no tiene ningún servicio configurado, así que no hay nada que agendar.";

function nombresDe(tipos: { name: string }[]): string {
  return tipos.map((t) => `"${t.name}"`).join(", ");
}

export function normalizarNombre(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Devuelve el serviceTypeId, o un fallo con la lista de nombres reales para
// que el modelo pueda corregirse sin adivinar.
async function resolverServicio(
  args: { serviceTypeId?: string; servicio?: string },
  contexto: ContextoDeEjecucionDeTool,
): Promise<{ ok: true; serviceTypeId: string } | { ok: false; resultado: ResultadoDeTool }> {
  if (args.serviceTypeId !== undefined) {
    return { ok: true, serviceTypeId: args.serviceTypeId };
  }

  const tipos = await findManyServiceTypes(
    contexto.organizationId,
    { branchId: contexto.conversation.branchId },
    { skip: 0, take: MAX_TIPOS_DE_SERVICIO },
    { sortBy: "name", sortOrder: "asc" },
  );

  // Ítem 122: sin servicio indicado. Con uno solo configurado no hay nada que
  // elegir; con varios, la lista va en la falla para que el modelo no tenga
  // que preguntarle al cliente algo que el backend sabe.
  if (args.servicio === undefined) {
    if (tipos.length === 1) {
      return { ok: true, serviceTypeId: tipos[0].id };
    }
    return {
      ok: false,
      resultado: fallo(
        tipos.length === 0
          ? SIN_SERVICIOS_CONFIGURADOS
          : `${MENSAJE_SERVICIO_SIN_IDENTIFICAR} Los de esta sucursal son: ${nombresDe(tipos)}. Elegí el que corresponda a lo que pidió el cliente y volvé a llamar en este mismo turno; si de verdad ninguno encaja o hay dos que podrían, preguntale al cliente NOMBRÁNDOLE esos, nunca "¿qué servicio querés?" a secas.`,
      ),
    };
  }

  const buscado = normalizarNombre(args.servicio);
  const coincidencias = tipos.filter((t) => normalizarNombre(t.name) === buscado);

  if (coincidencias.length === 1) {
    return { ok: true, serviceTypeId: coincidencias[0].id };
  }
  const disponibles = nombresDe(tipos);
  if (coincidencias.length === 0) {
    return {
      ok: false,
      resultado: fallo(
        tipos.length === 0
          ? SIN_SERVICIOS_CONFIGURADOS
          : `No existe ningún servicio llamado "${args.servicio}". Los que existen son: ${disponibles}. Usá uno de esos, tal cual está escrito.`,
      ),
    };
  }
  return {
    ok: false,
    resultado: fallo(
      `Hay más de un servicio que se llama "${args.servicio}". Preguntale al cliente cuál quiere entre: ${disponibles}.`,
    ),
  };
}

async function resolverRecursoDelServicio(
  serviceTypeId: string,
  resourceIdExplicito: string | undefined,
  contexto: ContextoDeEjecucionDeTool,
): Promise<{ ok: true; resourceId: string } | { ok: false; resultado: ResultadoDeTool }> {
  if (resourceIdExplicito !== undefined) {
    const rechazo = await resolverRecursoDeLaSucursal(resourceIdExplicito, contexto);
    return rechazo
      ? { ok: false, resultado: rechazo }
      : { ok: true, resourceId: resourceIdExplicito };
  }

  const serviceType = await findServiceTypeById(serviceTypeId, contexto.organizationId);
  if (!serviceType) {
    return {
      ok: false,
      resultado: fallo(
        "El tipo de servicio indicado no existe. Los serviceTypeId salen de la tool que lista los servicios: no los inventes.",
      ),
    };
  }
  // La misma comprobación de sucursal que el camino explícito: deducir el
  // recurso no puede ser una puerta para agendar en otra sucursal.
  const rechazo = await resolverRecursoDeLaSucursal(serviceType.resourceId, contexto);
  return rechazo
    ? { ok: false, resultado: rechazo }
    : { ok: true, resourceId: serviceType.resourceId };
}

// Ítem 103: "el miércoles a las 11" es un INSTANTE para el cliente, no un
// rango. El modelo lo traducía literal —`desde` y `hasta` en el mismo
// momento—, la validación lo rechazaba con razón, y el turno se quemaba en un
// error que el cliente terminaba leyendo como "no hay lugar". Pasó con dos
// modelos distintos, así que no es una torpeza de uno: es la API pidiéndole
// algo antinatural.
//
// `hasta` pasa a ser opcional, y un `hasta` igual a `desde` se trata como
// ausente (mismo criterio que el ítem 86 con los vacíos: lo que el modelo
// quiso decir es claro). Por defecto se consultan las 24 horas siguientes, que
// cubre tanto "¿qué horarios tenés el martes?" como "el miércoles a las 11".
//
// Un `hasta` ANTERIOR a `desde` sigue siendo un error: ahí el modelo no
// expresó mal un instante, se equivocó de orden, y taparlo escondería el bug.
const VENTANA_POR_DEFECTO_MS = 24 * 60 * 60 * 1000;

const getAvailabilityArgs = z
  .object({
    // Ítem 102: opcional. Si no viene, se deduce del serviceTypeId.
    resourceId: vacioComoAusente(uuid("resourceId")),
    // Ítem 106: uno de los dos. El nombre es lo que el modelo maneja bien.
    serviceTypeId: vacioComoAusente(uuid("serviceTypeId")),
    servicio: textoOpcional(255),
    desde: instanteIso,
    hasta: vacioComoAusente(instanteIso),
  })
  .transform((q) => ({
    ...q,
    hasta:
      q.hasta === undefined || q.hasta.getTime() === q.desde.getTime()
        ? new Date(q.desde.getTime() + VENTANA_POR_DEFECTO_MS)
        : q.hasta,
  }))
  .refine((q) => q.hasta.getTime() > q.desde.getTime(), {
    message: "hasta debe ser posterior a desde",
  })
  .refine((q) => q.hasta.getTime() - q.desde.getTime() <= MAX_DIAS_DE_RANGO * 24 * 60 * 60 * 1000, {
    message: `El rango no puede superar los ${MAX_DIAS_DE_RANGO} días`,
  });

const getAvailabilityTool: ToolDelAgente = {
  definition: {
    name: "get_availability",
    description:
      "Consulta los turnos disponibles para un servicio. Devuelve los horarios libres con inicio y fin. Alcanza con el serviceTypeId y el desde: el recurso se deduce del servicio y, sin hasta, se miran las 24 horas siguientes. Si el cliente dijo un día o una hora puntual, mandá ese momento como desde y nada más. Usala antes de reservar, y usá el serviceTypeId tal cual vino de la lista de servicios — no lo inventes. Y usala TAMBIÉN, en ese mismo turno, cuando el cliente pregunta cuándo puede ir: «¿cuándo puedo pasar?», «¿qué días atienden?», «¿tenés lugar esta semana?». Esa pregunta la contesta esta herramienta, no el cliente: no le pidas que proponga él un día ni un horario antes de mirar la agenda. Si no dijo cuándo, mandá el momento actual como desde y ofrecele los primeros turnos libres que devuelva.",
    parameters: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description:
            "UUID del recurso. NO hace falta mandarlo: se deduce del servicio. Mandalo solo si lo tenés y estás seguro de que es el que provee ese servicio.",
        },
        servicio: {
          type: "string",
          description:
            'Nombre del servicio, tal cual aparece en la lista de servicios (por ejemplo "Test drive"). Es la forma preferida: mandá esto y no te preocupes por ids.',
        },
        serviceTypeId: {
          type: "string",
          description:
            "Id del tipo de servicio. Alternativa a `servicio`. Solo si lo tenés copiado EXACTO de la lista de servicios — nunca lo escribas de memoria.",
        },
        desde: { type: "string", description: "Inicio del rango, ISO 8601 con zona." },
        hasta: {
          type: "string",
          description: `Fin del rango, ISO 8601 con zona. OPCIONAL: si no lo mandás se consultan las 24 horas siguientes a desde, que es lo que querés cuando el cliente dijo un día o un horario puntual. Máximo ${MAX_DIAS_DE_RANGO} días después de desde.`,
        },
      },
      required: ["desde"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(getAvailabilityArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const params = validacion.value;

    return conErroresDeNegocio(async () => {
      const servicio = await resolverServicio(params, contexto);
      if (!servicio.ok) {
        return servicio.resultado;
      }
      const recurso = await resolverRecursoDelServicio(
        servicio.serviceTypeId,
        params.resourceId,
        contexto,
      );
      if (!recurso.ok) {
        return recurso.resultado;
      }

      const turnos = await obtenerDisponibilidad(contexto.organizationId, {
        ...params,
        serviceTypeId: servicio.serviceTypeId,
        resourceId: recurso.resourceId,
      });

      // Ítem 104: en la zona de la sucursal, no en UTC.
      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        zonaHoraria: zona,
        turnos: turnos.map((t) => ({
          inicio: isoEnZona(t.inicio, zona),
          fin: isoEnZona(t.fin, zona),
          lugaresDisponibles: t.lugaresDisponibles,
        })),
      });
    });
  },
};

const createBookingArgs = z.object({
  // Ítem 102: opcional, igual que en get_availability.
  resourceId: vacioComoAusente(uuid("resourceId")),
  serviceTypeId: vacioComoAusente(uuid("serviceTypeId")),
  servicio: textoOpcional(255),
  startsAt: instanteIso,
});

const createBookingTool: ToolDelAgente = {
  definition: {
    name: "create_booking",
    description:
      "Reserva de verdad un turno para el contacto de esta conversación: hasta que esta tool no devuelva un resultado exitoso, el turno NO existe y no se lo podés confirmar al cliente. RESERVÁ EN EL MISMO TURNO EN QUE EL CLIENTE ACEPTA, sin volver a pedirle que confirme: «dale», «me viene bien», «sí, reservame ese», «el primero que tengas me sirve» ya son un sí. Volver a preguntarle «¿te lo reservo?» a alguien que acaba de aceptar lo hace esperar por nada, y muchos no contestan: el turno no se agenda nunca y la visita se pierde. Y si te delegó la elección del horario, elegilo vos —el primero libre de los que devolvió la disponibilidad— y reservalo; no le devuelvas la decisión que te acaba de dar. Alcanza con el serviceTypeId, el recurso se deduce solo. El horario tiene que ser uno de los que ya devolvió la consulta de disponibilidad. El fin lo determina la duración del servicio.",
    parameters: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description:
            "UUID del recurso. NO hace falta mandarlo: se deduce del servicio. Mandalo solo si lo tenés y estás seguro de que es el que provee ese servicio.",
        },
        servicio: {
          type: "string",
          description:
            'Nombre del servicio, tal cual aparece en la lista de servicios (por ejemplo "Test drive"). Es la forma preferida: mandá esto y no te preocupes por ids.',
        },
        serviceTypeId: {
          type: "string",
          description:
            "Id del tipo de servicio. Alternativa a `servicio`. Solo si lo tenés copiado EXACTO de la lista de servicios — nunca lo escribas de memoria.",
        },
        startsAt: { type: "string", description: "Inicio del turno, ISO 8601 con zona." },
      },
      required: ["startsAt"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(createBookingArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const input = validacion.value;

    return conErroresDeNegocio(async () => {
      // Primero la identidad: nombre y apellido en todos los canales, y por
      // WEB además un teléfono o un email (D3). Ver datosQueFaltanParaActuar.
      const bloqueo = await bloqueoPorIdentidad(contexto);
      if (bloqueo) {
        return bloqueo;
      }
      // D4: el tope de reservas futuras del contacto. Bajo el lock de la
      // conversación (un turno a la vez por contacto y canal), así que dos
      // reservas de la misma ronda se cuentan una después de la otra.
      const futuras = await countFutureConfirmedBookingsOfContact(
        contexto.conversation.contactId,
        contexto.organizationId,
        // El mismo reloj con el que createBooking decide qué es pasado.
        relojDeReservas.ahora(),
      );
      if (futuras >= MAX_RESERVAS_FUTURAS_POR_CONTACTO) {
        return fallo(MENSAJE_TOPE_DE_RESERVAS);
      }

      const servicio = await resolverServicio(input, contexto);
      if (!servicio.ok) {
        return servicio.resultado;
      }
      const recurso = await resolverRecursoDelServicio(
        servicio.serviceTypeId,
        input.resourceId,
        contexto,
      );
      if (!recurso.ok) {
        return recurso.resultado;
      }

      // F3 de docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub): la reserva queda vinculada a
      // la oportunidad abierta del contacto —la misma que create_opportunity
      // reusa—, para que el vendedor vea el test drive dentro de la venta. En
      // la prueba en vivo el agente creó la oportunidad y la reserva en la
      // misma conversación y la reserva quedó con opportunityId null. Sin
      // oportunidad abierta queda sin vínculo, como antes: no se crea una solo
      // para colgarle un turno.
      const oportunidad = await oportunidadAbiertaDelContacto(
        contexto.organizationId,
        contexto.conversation.contactId,
      );

      const booking = await createBooking(contexto.organizationId, {
        resourceId: recurso.resourceId,
        serviceTypeId: servicio.serviceTypeId,
        // Siempre el contacto de la conversación.
        contactId: contexto.conversation.contactId,
        ...(oportunidad ? { opportunityId: oportunidad.id } : {}),
        startsAt: input.startsAt,
      });

      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        bookingId: booking.id,
        zonaHoraria: zona,
        startsAt: isoEnZona(booking.startsAt, zona),
        endsAt: isoEnZona(booking.endsAt, zona),
        status: booking.status,
        // F3: null si el contacto no tenía una oportunidad abierta.
        opportunityId: booking.opportunityId,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// create_lead / update_lead — paso 3 (nota fechada del paso 3 bajo §6).
//
// DOS TOOLS, UN SOLO WRAPPER, UNA SOLA FUNCIÓN DE SERVICIO (qualifyLead). Los
// nombres vienen del catálogo del documento de visión y las descripciones
// orientan al modelo sobre cuál usar; el comportamiento es idéntico e
// idempotente. contactId sale siempre de la conversación, como en todas las
// demás.
//
// Los nombres de los argumentos son los de las columnas sin el prefijo `lead`
// (score, budgetAmount…): son los que un guardrail infoNoModificable tiene
// que listar (`Contact.budgetAmount`), y es la primera vez que ese chequeo
// tiene un caso real.
// ---------------------------------------------------------------------------

const leadArgs = z
  .object({
    // Ítem 116: identidad. No son calificación, pero llegan en la misma frase
    // ("soy Diego Ramírez, mi mail es...") y sin esto no había NINGUNA forma
    // de guardarlos. qualifyLead decide si se aplican.
    firstName: textoOpcional(100),
    lastName: textoOpcional(100),
    email: vacioComoAusente(z.string().email("email no tiene formato de correo").max(255)),
    // D3: el teléfono que el cliente dio en el chat. La forma la valida y
    // normaliza qualifyLead, con el país de la organización.
    phone: textoOpcional(30),
    // Mismo rango que el CHECK contacts_lead_score_range_check: se falla acá,
    // con mensaje, y no en el UPDATE.
    score: vacioComoAusente(
      z
        .number()
        .int("score debe ser un entero")
        .min(0, "score debe estar entre 0 y 100")
        .max(100, "score debe estar entre 0 y 100"),
    ),
    intent: textoOpcional(200),
    serviceOfInterest: textoOpcional(200),
    urgency: vacioComoAusente(z.nativeEnum(LeadUrgency)),
    // budgetAmount y score quedan estrictos: 0 es un valor real para los dos
    // (el comentario de leadBudgetAmount en el schema: 0 no es "sin
    // presupuesto"). Solo null cuenta como ausente.
    budgetAmount: vacioComoAusente(z.number().min(0, "budgetAmount debe ser mayor o igual a 0")),
    budgetCurrency: vacioComoAusente(currencySchema),
    location: textoOpcional(200),
    notes: textoOpcional(4000),
    aiData: vacioComoAusente(z.record(z.string(), z.unknown())),
    // Vehículo de interés (F2): por TEXTO, como `vehiculo` en
    // create_opportunity (ítem 107), y resuelto con el mismo criterio: solo
    // entre las unidades publicadas y disponibles, y una sola.
    vehiculoDeInteres: textoOpcional(255),
  })
  .refine((data) => cantidadDeArgumentos(data) > 0, {
    message: "Hay que indicar al menos un dato de calificación",
  })
  // Presupuesto como PAR: un monto sin moneda no se puede interpretar, y una
  // moneda sin monto no dice nada (comentario de leadBudgetAmount en el
  // schema: sin defaults, 0 no es "sin presupuesto").
  .refine((data) => (data.budgetAmount === undefined) === (data.budgetCurrency === undefined), {
    message: "budgetAmount y budgetCurrency van juntos: si viene uno, tiene que venir el otro",
  });

const LEAD_PARAMETERS = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Puntaje de calificación del lead, de 0 (frío) a 100 (listo para comprar).",
    },
    intent: {
      type: "string",
      description: "Qué quiere hacer el contacto, en sus palabras (ej. comprar un auto usado).",
    },
    serviceOfInterest: {
      type: "string",
      description: "Producto o servicio concreto que le interesa.",
    },
    urgency: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "Urgencia." },
    budgetAmount: {
      type: "number",
      description:
        "Presupuesto disponible, mayor o igual a 0. Va SIEMPRE junto con budgetCurrency.",
    },
    budgetCurrency: {
      type: "string",
      description:
        "Moneda del presupuesto, código ISO 4217 de 3 letras. Va SIEMPRE junto con budgetAmount.",
    },
    firstName: {
      type: "string",
      description:
        "Nombre del contacto, SOLO si te lo dijo en esta conversación. No lo deduzcas del mail ni lo inventes.",
    },
    lastName: {
      type: "string",
      description:
        "Apellido del contacto, con el mismo criterio que firstName: solo si te lo dijo.",
    },
    email: {
      type: "string",
      description:
        "Mail que el contacto te dio en esta conversación, tal cual lo escribió. No lo armes vos a partir del nombre.",
    },
    phone: {
      type: "string",
      description:
        "Teléfono que el contacto te dio en esta conversación, con el código de área, tal cual lo escribió. No lo inventes ni lo completes.",
    },
    location: { type: "string", description: "Zona o ciudad del contacto." },
    notes: {
      type: "string",
      description:
        "Observaciones en texto libre (matices, dudas, condiciones). Se AGREGAN a las notas anteriores, nunca las reemplazan.",
    },
    aiData: {
      type: "object",
      description:
        "Cualquier otro dato extraído de la conversación que no tenga campo propio, como objeto clave-valor. Se combina con lo ya guardado.",
    },
    vehiculoDeInteres: {
      type: "string",
      description:
        "La unidad CONCRETA del stock que le interesa, con la marca, el modelo y la versión tal cual figuran en search_vehicles (ej. «Toyota Hilux SRV 2022»). Mandala solo cuando el cliente muestra interés claro en ESA unidad —pregunta por ella, pide verla o probarla, quiere avanzar con esa—, no por un «busco una SUV» (eso va en serviceOfInterest). Queda anotada en su ficha: NO la reserva ni la saca del stock. Si una persona del equipo ya le cargó otra, no se cambia.",
    },
  },
  required: [],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// El vehículo de interés desde el agente (F2). Se resuelve por texto entre
// las unidades publicadas y disponibles (resolverVehiculo) y se anota solo si
// el contacto no tiene uno cargado por una persona
// (asignarVehiculoDeInteresDesdeElAgente). Lo que pase va en el resultado,
// para que el modelo no le diga al cliente algo que no ocurrió; los demás
// datos de la misma llamada se guardan igual.
// ---------------------------------------------------------------------------

export const NOTA_VEHICULO_DE_INTERES =
  "Quedó anotada en la ficha como la unidad que le interesa. NO está reservada: sigue disponible para otros clientes. No le digas al cliente que se la reservaste.";
export const NOTA_VEHICULO_DE_UNA_PERSONA =
  "No se cambió: una persona del equipo ya le había cargado otra unidad de interés, y eso no se pisa desde el chat. No le menciones nada de esto al cliente.";

async function anotarVehiculoDeInteres(
  texto: string,
  contexto: ContextoDeEjecucionDeTool,
): Promise<Record<string, unknown>> {
  const resuelto = await resolverVehiculo(texto, contexto);
  if (!resuelto.ok) {
    const motivo = resuelto.resultado.ok ? null : resuelto.resultado.error;
    return { vehiculoDeInteres: { guardado: false, motivo } };
  }
  return anotarInteresEnLaUnidad(resuelto.vehiculo, contexto);
}

// B1 (05/10/2026): la unidad que el cliente eligió queda como vehículo de
// interés del contacto TAMBIÉN cuando llega por `vehiculo` de
// create_opportunity / update_opportunity, no solo por `vehiculoDeInteres` de
// create_lead / update_lead. Es la misma anotación en la ficha (F2): no
// reserva nada ni toca Opportunity.vehicleId, que sigue siendo cosa de un
// vendedor (o de reserve_vehicle, si un ADMIN la habilitó). Con la misma
// regla de no pisar lo que cargó una persona.
async function anotarInteresEnLaUnidad(
  vehiculo: { id: string; etiqueta: string },
  contexto: ContextoDeEjecucionDeTool,
): Promise<Record<string, unknown>> {
  const resultado = await asignarVehiculoDeInteresDesdeElAgente(
    contexto.organizationId,
    contexto.conversation.contactId,
    vehiculo.id,
  );
  return resultado === "guardado"
    ? {
        vehiculoDeInteres: {
          guardado: true,
          unidad: vehiculo.etiqueta,
          nota: NOTA_VEHICULO_DE_INTERES,
        },
      }
    : { vehiculoDeInteres: { guardado: false, motivo: NOTA_VEHICULO_DE_UNA_PERSONA } };
}

function ejecutarCalificacion(
  args: Record<string, unknown>,
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool> {
  const validacion = validarArgs(leadArgs, args);
  if (!validacion.ok) {
    return Promise.resolve(validacion.resultado);
  }
  const { vehiculoDeInteres, ...input } = validacion.value;

  return conErroresDeNegocio(async () => {
    // Solo el vehículo: no hay calificación que guardar.
    const { contacto, identidadIgnorada, motivoDelTelefono } =
      cantidadDeArgumentos(input) > 0
        ? await qualifyLead(contexto.organizationId, contexto.conversation.contactId, input)
        : {
            contacto: await getContactById(
              contexto.organizationId,
              contexto.conversation.contactId,
            ),
            identidadIgnorada: [] as string[],
            motivoDelTelefono: undefined,
          };
    const vehiculo = vehiculoDeInteres
      ? await anotarVehiculoDeInteres(vehiculoDeInteres, contexto)
      : {};

    // Confirma QUÉ se escribió (los valores ya persistidos), para que el modelo
    // pueda referirse a lo que acaba de guardar sin volver a preguntarlo.
    return exito({
      contactId: contacto.id,
      score: contacto.leadScore,
      intent: contacto.leadIntent,
      serviceOfInterest: contacto.leadServiceOfInterest,
      urgency: contacto.leadUrgency,
      budgetAmount: contacto.leadBudgetAmount === null ? null : Number(contacto.leadBudgetAmount),
      budgetCurrency: contacto.leadBudgetCurrency,
      location: contacto.leadLocation,
      notes: contacto.leadNotes,
      aiData: contacto.leadAiData,
      // Ítem 116: la identidad que quedó guardada, y la que NO. Sin esto el
      // modelo le diría al cliente "ya anoté tu mail" habiendo guardado solo
      // la calificación (ítem 100).
      firstName: contacto.firstName,
      lastName: contacto.lastName,
      // FABLE-A-02 (B3): por WEB, solo lo que el visitante dio en esta llamada.
      // Si ya había otro guardado (identidadIgnorada), el modelo se entera de
      // que no se actualizó, pero nunca del valor guardado.
      ...(contexto.conversation.channel === ConversationChannel.WEB
        ? {
            email:
              input.email !== undefined && !identidadIgnorada.includes("email")
                ? contacto.email
                : null,
            phone:
              input.phone !== undefined && !identidadIgnorada.includes("phone")
                ? contacto.phone
                : null,
            datosReservados: NOTA_DATOS_RESERVADOS_EN_WEB,
          }
        : { email: contacto.email, phone: contacto.phone }),
      ...(identidadIgnorada.length > 0
        ? {
            noSeActualizo: identidadIgnorada,
            queHacer:
              "Esos datos ya estaban cargados en el CRM y no se pisan desde el chat. No le digas al cliente que los actualizaste; si insiste en corregirlos, derivá.",
          }
        : {}),
      // El teléfono tiene dos motivos propios para no quedar guardado, y
      // ninguno es "ya estaba cargado".
      ...(motivoDelTelefono === "no-valido"
        ? {
            telefono:
              "El teléfono no se guardó: no tiene un formato válido. Pedíselo de nuevo, con el código de área.",
          }
        : motivoDelTelefono === "no-disponible"
          ? {
              telefono:
                "El teléfono no se pudo guardar. No se lo menciones al cliente; pedile un email para poder seguir.",
            }
          : {}),
      ...vehiculo,
    });
  });
}

const createLeadTool: ToolDelAgente = {
  definition: {
    name: "create_lead",
    description:
      "Registra en el CRM lo que sabés del contacto de esta conversación: su nombre, su mail y su teléfono, y su calificación como lead —puntaje, intención, servicio de interés, urgencia, presupuesto, zona y notas. Usala la PRIMERA vez que el contacto dice cualquiera de esas cosas, en ese mismo turno, sin pedirle permiso ni esperar a tener todo. Dispara con cualquiera de estas, sueltas: «soy Diego Ramírez», «mi mail es...», «busco una SUV familiar», «tengo hasta 30 mil», «necesito cerrarlo esta semana», «vivo en Pilar». Si no la llamás, el vendedor abre el CRM y ve un contacto sin nombre y sin un solo dato de lo que hablaron. Todos los campos son opcionales; mandá los que conozcas y el resto después con update_lead.",
    parameters: LEAD_PARAMETERS,
  },
  ejecutar: ejecutarCalificacion,
};

const updateLeadTool: ToolDelAgente = {
  definition: {
    name: "update_lead",
    description:
      "Actualiza lo que el CRM sabe del contacto de esta conversación cada vez que aparece un dato nuevo o cambia uno: dijo su mail, dijo su apellido, subió el presupuesto, cambió la urgencia, dijo dónde vive, surgió una duda. Llamala en el turno en que lo dice, no al final de la charla. Las notas se agregan a las anteriores. Todos los campos son opcionales; mandá solo lo nuevo.",
    parameters: LEAD_PARAMETERS,
  },
  ejecutar: ejecutarCalificacion,
};

// ---------------------------------------------------------------------------
// update_contact_custom_fields (B6, 06/10/2026)
//
// Los campos personalizados que la organización definió para sus contactos
// (Administración → Campos de contacto). El agente los LEE todos en el prompt
// (bloqueDeCamposPersonalizados) y ESCRIBE solo los marcados "editable por el
// agente". La validación es la misma que la de una persona en la ficha
// (utils/camposPersonalizados.ts): tipo, opciones de una lista, key con
// definición; lo que no valida vuelve al modelo con el nombre del campo, y el
// resto de la llamada no se guarda (todo o nada: el modelo corrige y vuelve).
// Una puerta propia (updateContactCustomFields), separada de qualifyLead, para
// que esta tool no pueda tocar nada más del contacto.
// ---------------------------------------------------------------------------
export const CUSTOM_FIELDS_TOOL_NAME = "update_contact_custom_fields";

const customFieldsArgs = z
  .object({
    campos: z.record(
      z.string().min(1).max(60),
      // El arreglo es el valor COMPLETO de una selección múltiple.
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    ),
  })
  .strict()
  .refine((data) => Object.keys(data.campos).length > 0, {
    message: "campos tiene que traer al menos un campo",
  });

const updateContactCustomFieldsTool: ToolDelAgente = {
  definition: {
    name: CUSTOM_FIELDS_TOOL_NAME,
    description:
      "Guarda en la ficha del contacto de esta conversación los campos personalizados que el negocio definió y que vos podés modificar (están listados en tus instrucciones, con su clave y el formato del valor). Usala en el turno en que el contacto te da ese dato. Mandá solo los campos que cambian, por su clave; null borra el valor. Un campo que no está en tu lista, o un valor que no respeta el formato, se rechaza entero: corregí y volvé a llamar.",
    parameters: {
      type: "object",
      properties: {
        campos: {
          type: "object",
          description:
            'Los campos a guardar, por clave: { "clave": valor }. Texto como string, número como number, fecha como "AAAA-MM-DD", sí/no como true/false, lista con una de sus opciones exactas, selección múltiple con el ARREGLO COMPLETO de opciones que quedan elegidas (para agregar o quitar una, mandá las que ya tenía más o menos esa), null para borrar.',
          additionalProperties: true,
        },
      },
      required: ["campos"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(customFieldsArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const { campos } = validacion.value;
    return conErroresDeNegocio(async () => {
      const contacto = await findContactById(
        contexto.conversation.contactId,
        contexto.organizationId,
      );
      if (!contacto) {
        return fallo("El contacto de esta conversación ya no existe");
      }
      // 400 con el nombre del campo si algo no valida (conErroresDeNegocio lo
      // convierte en el error que lee el modelo).
      const valores = await camposPersonalizadosParaGuardar(
        contexto.organizationId,
        contacto.customFields,
        campos,
        { soloEditablesPorElAgente: true },
      );
      await updateContactCustomFields(contacto.id, contexto.organizationId, valores);
      return exito({
        contactId: contacto.id,
        guardados: Object.keys(campos),
        camposPersonalizados: valores,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// get_payment_info (ítem 74)
//
// NO ES UNA PASARELA: no genera ningún cobro ni se entera de si alguien pagó.
// Devuelve lo que la sucursal de la conversación tiene configurado —un link de
// pago fijo y/o datos para transferencia— para que el agente lo comparta. Sin
// parámetros: la sucursal sale del contexto, igual que en el resto de las
// tools, y el modelo no puede pedir los datos de otra.
//
// SIN CONDICIÓN DE NEGOCIO y sin gate propio: no modifica nada, así que el
// único permiso es el de siempre (que esté en Agent.enabledTools).
//
// CUÁNDO COMPARTIR EL DETALLE es criterio conversacional, no un candado, y por
// eso vive en la DESCRIPCIÓN (lo que lee el modelo) y no en código — mismo
// criterio que el ítem 72: puedeEjecutarTool() hace cumplir tres cosas
// puntuales y todo lo demás es prompt. Ante "¿qué métodos de pago aceptan?" el
// agente contesta con los nombres de los métodos; el link y los datos de la
// cuenta van cuando el cliente concretamente quiere pagar.
//
// SIN NADA CONFIGURADO igual devuelve el objeto, con los dos flags en false:
// que el modelo vea que no hay medio de pago cargado y lo diga, en vez de
// inventar uno.
// ---------------------------------------------------------------------------

export const NOMBRE_TOOL_PAGO = "get_payment_info";

const getPaymentInfoTool: ToolDelAgente = {
  definition: {
    name: NOMBRE_TOOL_PAGO,
    description:
      "Devuelve el link de pago y/o los datos para transferencia bancaria configurados por la sucursal. Usala cuando el cliente concretamente quiere pagar o señar, o pide el link de pago o los datos de la cuenta (CBU, alias, número de cuenta). Si solo pregunta en general qué métodos de pago aceptan, respondé con los nombres de los métodos disponibles (transferencia bancaria / link de pago) sin compartir todavía el link ni los datos de la cuenta; si ya la llamaste antes en la conversación, no hace falta volver a llamarla para eso. Si no hay ningún medio de pago configurado, decíselo al cliente: no inventes uno.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },

  async ejecutar(_args, contexto) {
    const branch = await findBranchById(contexto.conversation.branchId, contexto.organizationId);
    // La sucursal de una conversación viva no debería desaparecer (deleteBranch
    // no mira conversaciones, pero es soft delete y el agente también es de
    // ella). Si pasa, es "no hay nada configurado" para el modelo, no un bug
    // que tumbe el turno.
    const paymentLinkUrl = branch?.paymentLinkUrl ?? null;
    const bankTransferDetails = branch?.bankTransferDetails ?? null;

    const datos = {
      hasPaymentLink: paymentLinkUrl !== null,
      paymentLinkUrl,
      hasBankTransfer: bankTransferDetails !== null,
      bankTransferDetails,
    };

    // Ítem 91: sin NINGÚN medio configurado, el modelo contestaba con los
    // medios de pago genéricos de cualquier automotora. El vacío se dice
    // explícito y con la salida correcta, acá y no solo en la description.
    if (paymentLinkUrl === null && bankTransferDetails === null) {
      return exitoVacio(
        datos,
        "La sucursal NO tiene ningún medio de pago configurado. NO le ofrezcas al cliente transferencia bancaria, link de pago, efectivo ni ningún otro medio: no hay ninguno cargado y cualquiera que menciones sería inventado. Decile que todavía no tenés los datos de cobro a mano y que se los va a pasar alguien del equipo.",
      );
    }

    return exito(datos);
  },
};

// ---------------------------------------------------------------------------
// Tools de lectura (ítem 85): get_contact_info, search_vehicles,
// get_service_types, get_contact_activities.
//
// Mismo patrón fino que get_payment_info: ningún argumento que elija QUÉ
// contacto o QUÉ sucursal —salen del contexto—, un repositorio que ya existía,
// y un `select` a mano de lo que se devuelve. No escriben nada, así que el
// único permiso es el de siempre (estar en Agent.enabledTools).
//
// LO QUE SE DEVUELVE SE ELIGE CAMPO POR CAMPO, nunca la fila entera: el
// resultado va al modelo y del modelo al cliente. Importa sobre todo en
// search_vehicles, donde Vehicle tiene costos, precio mínimo aceptable y
// datos del consignante que jamás pueden salir por un canal público (ver la
// cabecera de Vehicle en prisma/schema.prisma).
//
// Deliberadamente NO hay una tool genérica de "consultar la base": se agrega
// una por caso real, como las automatizaciones del catálogo controlado.
// ---------------------------------------------------------------------------

// Ítem 121: el presupuesto que el cliente dice suelto —«tengo hasta 20 mil»—
// se lo lleva el filtro de búsqueda y no llega nunca al CRM.
//
// Medido contra el modelo real, cuatro aperturas distintas: 0 de 4 quedaron
// guardadas, y en las 4 la ÚNICA tool del turno fue search_vehicles. No es que
// el modelo se olvide: el número le sirvió para buscar, la búsqueda contestó la
// consulta, y el turno se cerró. El vendedor abre la ficha al otro día y ve un
// lead sin un solo número, cuando el cliente lo primero que dijo fue cuánto
// tenía.
//
// El aviso va en el RESULTADO de la búsqueda y no en el prompt, por dos
// razones. Se paga solo cuando el caso existe —búsqueda con tope de precio y
// ficha sin presupuesto—, en vez de en cada llamada de cada conversación de
// cada cuenta. Y llega en el momento exacto en que el modelo está mirando ese
// número, que es el patrón que funcionó en los ítems 112 y 116: poner la guía
// en el dato que el modelo lee, no en el prompt que leyó hace veinte mensajes.
//
// LO QUE NO HACE: deducir el presupuesto del filtro. Un tope de precio no es un
// presupuesto —«mostrame los de menos de 30 mil» puede ser curiosidad, o el
// tope lo puso el modelo por su cuenta— y escribir en el CRM un número que el
// cliente no dijo es peor que no escribir nada: el vendedor llama confiando en
// un dato inventado. Quién sabe qué dijo el cliente es el modelo; acá solo se
// le avisa que la ficha está vacía y se le deja la decisión.
export const RECORDATORIO_DE_PRESUPUESTO =
  "Este contacto NO tiene presupuesto guardado en el CRM y vos acabás de buscar con un tope de precio. Ese tope salió de lo que dijo el cliente —es la regla de esta tool: cada filtro se tiene que poder señalar en sus palabras—, así que ESE es su presupuesto. Guardalo AHORA, en este mismo turno, con update_lead: budgetAmount con el número y budgetCurrency con la moneda en que lo dijo (USD si habló de dólares, de lucas verdes o de palos verdes). Es una llamada más antes de contestarle, no una conversación aparte: el cliente no ve nada de esto, así que no le preguntes ni le avises — guardá y contestale la búsqueda normalmente. Si no lo guardás, el vendedor abre la ficha mañana y ve un lead sin un solo número, cuando lo primero que dijo el cliente fue cuánto tenía.";

// Devuelve el aviso listo para mezclar en el resultado, o nada. Se separa en
// una función para que el caso "no corresponde" no pague ni una consulta.
async function recordatorioDePresupuesto(
  contexto: ContextoDeEjecucionDeTool,
  topeDePrecio: number | undefined,
): Promise<Record<string, unknown>> {
  // Solo el tope. priceMinUsd («algo de más de 20 mil») no tiene forma de
  // presupuesto: es el piso de lo que quiere mirar, no el techo de lo que puede
  // gastar.
  if (topeDePrecio === undefined) {
    return {};
  }
  try {
    const contacto = await findContactById(
      contexto.conversation.contactId,
      contexto.organizationId,
    );
    if (contacto === null || contacto.leadBudgetAmount !== null) {
      return {};
    }
    return { recordatorioDePresupuesto: RECORDATORIO_DE_PRESUPUESTO };
  } catch (err) {
    // El aviso es una mejora, la búsqueda es la conversación. Si la consulta
    // falla, el cliente igual recibe su lista de autos.
    logger.warn(
      { err, organizationId: contexto.organizationId, contactId: contexto.conversation.contactId },
      "No pude chequear si el contacto tiene presupuesto guardado: la búsqueda sigue sin el aviso",
    );
    return {};
  }
}

// Prueba en vivo del 29/09: «¿tienen alguna pickup usada?» por WhatsApp. El
// agente buscó bien (bodyType PICKUP, condition USED), contestó, y el contacto
// quedó igual que antes: la description de create_lead ya pide guardar la
// intención en ese mismo turno y el modelo no la llamó. Es el mismo residual
// del ítem 121, y ajustar el prompt otra vez no lo cierra.
//
// Por eso acá lo GARANTIZA EL BACKEND y no el modelo: si la búsqueda corrió y
// el contacto no tiene intención, se anota un resumen de lo que buscó. Tres
// reglas, y cada una tiene su porqué:
//
//   - NUNCA PISA. Una intención que ya está —del modelo, de un vendedor, de una
//     importación— sabe más que un resumen de filtros. La condición va en el
//     WHERE del UPDATE (setLeadIntentIfEmpty), no en un chequeo previo.
//   - SOLO FILTROS ESTRUCTURADOS: enums, números y booleanos, con los rótulos
//     de la pantalla. Nada de texto libre del modelo (`texto`, el color): lo
//     que llega a la ficha no puede ser contenido inventado ni una inyección
//     de prompt. Marca y modelo son texto, pero se filtran por igualdad
//     exacta: si la búsqueda trajo algo, el valor es el del stock del negocio
//     y no el del modelo. Sin resultados, no se incluyen.
//   - NO ROMPE LA BÚSQUEDA. El cliente vino por la lista de autos; si la
//     escritura falla, se loguea y la lista sale igual.
//
// A diferencia del presupuesto (que sigue siendo un aviso), la intención sí se
// deduce de los filtros: «busca una pickup usada» es literalmente lo que pidió,
// no una interpretación. El prefijo "Busca:" deja a la vista que es un resumen
// armado por el sistema y no una frase del cliente — no hay en Contact una
// columna de procedencia para los datos de calificación.
export interface FiltrosDeBusqueda {
  priceMinUsd?: number;
  priceMaxUsd?: number;
  make?: string;
  model?: string;
  year?: number;
  bodyType?: VehicleBodyType;
  condition?: VehicleCondition;
  transmission?: VehicleTransmission;
  fuelType?: VehicleFuelType;
  mileageMax?: number;
  financingAvailable?: boolean;
  acceptsTradeIn?: boolean;
}

// Mismo tope que Contact.leadIntent (VarChar 200).
const MAX_LARGO_INTENCION = 200;

// "Automática secuencial" → "automática secuencial", pero "SUV" y "CVT" quedan
// como están: van en medio de una frase.
function enMinuscula(rotulo: string): string {
  return rotulo === rotulo.toUpperCase() ? rotulo : rotulo[0].toLowerCase() + rotulo.slice(1);
}

// Separador de miles con punto, a mano y no con Intl: el texto queda igual en
// cualquier runtime, sin depender de los datos de ICU.
function conMiles(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// null = no hay ningún filtro que resumir (la búsqueda sin filtros, o solo con
// texto libre): no se escribe nada antes que escribir "Busca: " a secas.
export function resumenDeBusqueda(f: FiltrosDeBusqueda, huboResultados: boolean): string | null {
  const partes: string[] = [];
  if (f.bodyType) partes.push(enMinuscula(BODY_TYPE_LABELS[f.bodyType]));
  if (f.condition) partes.push(enMinuscula(CONDITION_LABELS[f.condition]));
  if (huboResultados) {
    const marcaYModelo = [f.make, f.model].filter((v) => v !== undefined).join(" ");
    if (marcaYModelo.length > 0) partes.push(marcaYModelo);
  }
  if (f.year !== undefined) partes.push(`año ${f.year}`);
  if (f.transmission) partes.push(`caja ${enMinuscula(TRANSMISSION_LABELS[f.transmission])}`);
  if (f.fuelType) partes.push(enMinuscula(FUEL_TYPE_LABELS[f.fuelType]));
  if (f.priceMinUsd !== undefined && f.priceMaxUsd !== undefined) {
    partes.push(`entre USD ${conMiles(f.priceMinUsd)} y USD ${conMiles(f.priceMaxUsd)}`);
  } else if (f.priceMaxUsd !== undefined) {
    partes.push(`hasta USD ${conMiles(f.priceMaxUsd)}`);
  } else if (f.priceMinUsd !== undefined) {
    partes.push(`desde USD ${conMiles(f.priceMinUsd)}`);
  }
  if (f.mileageMax !== undefined) partes.push(`hasta ${conMiles(f.mileageMax)} km`);
  if (f.financingAvailable) partes.push("con financiación");
  if (f.acceptsTradeIn) partes.push("con permuta");

  if (partes.length === 0) return null;
  return `Busca: ${partes.join(" · ")}`.slice(0, MAX_LARGO_INTENCION);
}

export const AVISO_DE_INTENCION_GUARDADA =
  "Este contacto no tenía intención guardada en el CRM, así que el sistema ya guardó la de `intent`, armada solo con los filtros de esta búsqueda. No hace falta que la guardes vos. Si el cliente dijo algo más preciso —para qué lo quiere, qué uso le va a dar, qué otra cosa está mirando—, completala o corregila con update_lead en este mismo turno. El cliente no ve nada de esto: no le preguntes ni le avises, contestale la búsqueda normalmente.";

// La escritura como objeto y no como import suelto: es la costura por la que
// un test la hace fallar (mismo patrón que relojDeReservas).
export const escrituraDeIntencion = { guardarSiFalta: setLeadIntentIfEmpty };

// Devuelve lo que se mezcla en el resultado, o nada. Nunca tira.
async function guardarIntencionDeBusqueda(
  contexto: ContextoDeEjecucionDeTool,
  filtros: FiltrosDeBusqueda,
  huboResultados: boolean,
): Promise<Record<string, unknown>> {
  const intent = resumenDeBusqueda(filtros, huboResultados);
  if (intent === null) {
    return {};
  }
  try {
    const { count } = await escrituraDeIntencion.guardarSiFalta(
      contexto.conversation.contactId,
      contexto.organizationId,
      intent,
    );
    // 0 = ya tenía intención (o el contacto no es de esta organización o está
    // borrado): no se escribió nada y no hay nada que avisarle al modelo.
    if (count === 0) {
      return {};
    }
    return { intencionGuardada: { intent, aviso: AVISO_DE_INTENCION_GUARDADA } };
  } catch (err) {
    logger.error(
      { err, organizationId: contexto.organizationId, contactId: contexto.conversation.contactId },
      "No pude guardar la intención de la búsqueda en el contacto: la búsqueda sigue sin guardarla",
    );
    return {};
  }
}

const sinParametros = { type: "object", properties: {}, additionalProperties: false };

// Decimal de Prisma → number para el modelo (mismo criterio que budgetAmount
// en ejecutarCalificacion). 14,2 cabe de sobra en un double.
function decimalANumero(valor: { toString(): string } | null): number | null {
  return valor === null ? null : Number(valor);
}

const getContactInfoTool: ToolDelAgente = {
  definition: {
    name: "get_contact_info",
    description:
      "Devuelve los datos que el CRM tiene cargados del contacto de esta conversación (nombre, apellido, email, teléfono). Usala para saber si ya tenés el nombre de la persona antes de preguntárselo de nuevo, o antes de derivar, para que la persona que retome tenga contexto. Por el canal web el email y el teléfono guardados no se devuelven.",
    parameters: sinParametros,
  },

  async ejecutar(_args, contexto) {
    const contact = await findContactById(contexto.conversation.contactId, contexto.organizationId);
    if (!contact) {
      return fallo("El contacto de esta conversación ya no existe");
    }
    // FABLE-A-02 (B3): por WEB, nunca el email ni el teléfono guardados. Ver
    // AVISO_DE_DATOS_RESERVADOS_EN_WEB en agentOrchestration.service.ts.
    if (contexto.conversation.channel === ConversationChannel.WEB) {
      return exito({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: null,
        phone: null,
        companyId: contact.companyId,
        datosReservados: NOTA_DATOS_RESERVADOS_EN_WEB,
      });
    }
    return exito({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      companyId: contact.companyId,
    });
  },
};

const MAX_VEHICULOS_POR_BUSQUEDA = 10;

const ANIO_MINIMO = 1980;

// Un año fuera de rango (el 0 del caso real, o 1900, o 2099) no es un filtro
// que el cliente haya pedido: es el modelo rellenando la clave. Se trata como
// "no vino" en vez de filtrar por year = 0 y devolver cero resultados sin que
// el modelo entienda por qué. El tope se calcula en cada llamada para que no
// quede congelado en el año del deploy.
const anioOpcional = z.preprocess((v) => {
  if (esVacio(v)) return undefined;
  if (typeof v === "number" && (v < ANIO_MINIMO || v > new Date().getFullYear() + 1)) {
    return undefined;
  }
  return v;
}, z.number().int("year debe ser un entero").optional());

// Los booleanos solo filtran en true. Nadie busca "autos que NO aceptan
// permuta"; un false es el modelo rellenando la clave, y filtrar por él
// escondería justo las unidades que sí aceptan.
const soloSiEsTrue = z.preprocess((v) => (v === true ? true : undefined), z.boolean().optional());

const searchVehiclesArgs = z
  .object({
    priceMinUsd: ceroComoAusente(z.number().min(0, "priceMinUsd debe ser mayor o igual a 0")),
    priceMaxUsd: ceroComoAusente(z.number().min(0, "priceMaxUsd debe ser mayor o igual a 0")),
    make: textoOpcional(100),
    model: textoOpcional(100),
    year: anioOpcional,
    bodyType: vacioComoAusente(z.nativeEnum(VehicleBodyType)),
    condition: vacioComoAusente(z.nativeEnum(VehicleCondition)),
    transmission: vacioComoAusente(z.nativeEnum(VehicleTransmission)),
    fuelType: vacioComoAusente(z.nativeEnum(VehicleFuelType)),
    exteriorColor: textoOpcional(50),
    mileageMax: ceroComoAusente(
      z.number().int("mileageMax debe ser un entero").min(0, "mileageMax no puede ser negativo"),
    ),
    financingAvailable: soloSiEsTrue,
    acceptsTradeIn: soloSiEsTrue,
    texto: textoOpcional(100),
  })
  .refine(
    (q) =>
      q.priceMinUsd === undefined || q.priceMaxUsd === undefined || q.priceMinUsd <= q.priceMaxUsd,
    { message: "priceMinUsd no puede ser mayor que priceMaxUsd" },
  );

// FABLE-B-09 (docs-privados, local): lo que el modelo lee cuando la búsqueda
// encontró el modelo pedido pero no con esa versión o ese año.
export const NOTA_DE_COINCIDENCIA_PARCIAL =
  "No hay ninguna unidad que coincida con TODO lo que pidió el cliente (la versión o el año). Estas son las unidades del MISMO MODELO que sí están disponibles. Mostráselas y aclarale en qué se diferencian de lo que pidió. NO le digas que el modelo no está disponible: sí lo está.";

const searchVehiclesTool: ToolDelAgente = {
  definition: {
    name: "search_vehicles",
    description:
      'Busca vehículos disponibles en stock que están publicados para mostrar a clientes. REGLA PRINCIPAL: cada filtro que mandes tiene que poder señalarse en las palabras del cliente. Si el cliente no lo dijo, NO lo mandes — nunca lo completes con un valor que te parezca razonable. Un filtro de más esconde autos que sí hay, y le terminás diciendo al cliente que no hay stock cuando sí hay. Ejemplo: si el cliente solo dice "algo de menos de 30 mil dólares", mandá únicamente priceMaxUsd: 30000, sin carrocería, transmisión, combustible, condición ni kilometraje. Si no dio ningún dato, llamala sin filtros. Filtros disponibles: precio en USD, marca, modelo, año, tipo de carrocería, 0 km o usado, transmisión, combustible, color, kilometraje máximo, financiación, permuta, y un texto libre para cualquier otra cosa (equipamiento, versión, algo de la descripción). Devuelve como máximo 10 resultados y el total. Los resultados vienen ordenados de más barato a más caro, y las unidades de precio a consultar van TODAS al final, sin precio (ni en dólares ni en moneda local): de esas no sabés cuánto salen, ni siquiera aproximadamente, y aparecen aunque el cliente haya puesto un tope de precio. Ejemplo: si preguntan cuál es el más barato, llamala con los filtros que el cliente haya dado (o sin filtros si no dio ninguno) y contestá con el primero de la lista — no hace falta pedir más datos para eso. Para el más caro, el último con precio de la lista lo es solo si total es 10 o menos; si total es mayor, la lista trae solo los 10 más baratos y el más caro no está en ella: no afirmes cuál es. Usala cuando el cliente pregunta por autos disponibles o pide opciones dentro de un presupuesto o con ciertas características. Y NO LE PIDAS MÁS DATOS ANTES DE BUSCAR, dijo mucho o dijo nada: si nombró aunque sea una sola cosa usable —un modelo, un presupuesto, un kilometraje, un tipo de auto— buscá con eso, y si no nombró ninguna —«hola, ¿qué autos tienen?», «¿qué tenés?»— llamala SIN filtros y mostrale el stock. Preguntarle qué busca antes de mostrarle algo es la peor forma de empezar una conversación: el cliente todavía no sabe qué querés que le contestes. Ejemplos de llamadas que corresponden y no se repreguntan: "¿cuánto sale el Onix?" → model: "Onix"; "algo con menos de 50.000 km" → mileageMax: 50000; "una SUV" → bodyType: SUV. Pedirle la versión, la marca o el año antes de buscar es el error más caro de esta herramienta: el cliente ya te dijo lo que quiere, y la lista que le devolvés es la que contesta esa pregunta.',
    parameters: {
      type: "object",
      properties: {
        priceMinUsd: { type: "number", description: "Precio de lista mínimo, en USD." },
        priceMaxUsd: { type: "number", description: "Precio de lista máximo, en USD." },
        make: {
          type: "string",
          description:
            "Marca, como la dijo el cliente (ej. Toyota). No hace falta que esté escrita exacta: no distingue mayúsculas ni acentos.",
        },
        model: {
          type: "string",
          description:
            "Modelo, como lo dijo el cliente (ej. Corolla). Podés incluir la versión y el año si los nombró (ej. T-Cross Comfortline 2023). No distingue mayúsculas, acentos ni guiones.",
        },
        year: { type: "integer", description: "Año del modelo." },
        bodyType: {
          type: "string",
          enum: Object.values(VehicleBodyType),
          description:
            "NO lo mandes salvo que el cliente haya dicho la carrocería explícitamente (sedán, hatchback, SUV, pickup, etc.). Nunca la asumas. Tipo de carrocería.",
        },
        condition: {
          type: "string",
          enum: Object.values(VehicleCondition),
          description:
            "NO lo mandes salvo que el cliente haya aclarado explícitamente si quiere 0 km o usado. Nunca lo asumas. NEW para 0 km, USED para usado.",
        },
        transmission: {
          type: "string",
          enum: Object.values(VehicleTransmission),
          description:
            "NO la mandes salvo que el cliente haya dicho explícitamente 'automático' o 'manual' (o un equivalente directo, como 'caja automática'). Nunca la asumas. Transmisión.",
        },
        fuelType: {
          type: "string",
          enum: Object.values(VehicleFuelType),
          description:
            "NO lo mandes salvo que el cliente haya nombrado el combustible explícitamente (nafta, diésel, híbrido, eléctrico, GNC). Nunca lo asumas. GASOLINE es nafta; GASOLINE_CNG es nafta con equipo de GNC.",
        },
        exteriorColor: {
          type: "string",
          description: "Color exterior (ej. blanco). Encuentra también variantes (Blanco perla).",
        },
        mileageMax: {
          type: "integer",
          description:
            "NO lo mandes salvo que el cliente haya dado un límite de kilometraje concreto (ej. 'menos de 80 mil km'). Nunca inventes un tope. Kilometraje máximo.",
        },
        financingAvailable: {
          type: "boolean",
          description:
            "NO lo mandes salvo que el cliente haya dicho explícitamente que quiere financiar o pagar en cuotas. Si lo mandás, solo true. true = solo autos con financiación.",
        },
        acceptsTradeIn: {
          type: "boolean",
          description:
            "NO lo mandes salvo que el cliente haya dicho explícitamente que quiere entregar su auto como parte de pago. Si lo mandás, solo true. true = solo autos que aceptan permuta.",
        },
        texto: {
          type: "string",
          description:
            "Texto libre para lo que no es un filtro de arriba: equipamiento (ej. techo solar), versión o algo de la descripción del aviso.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(searchVehiclesArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const input = validacion.value;

    return conErroresDeNegocio(async () => {
      // status y publishOnWebsite van FIJOS y después de los del modelo, que
      // de todas formas no puede mandarlos (Zod descarta claves desconocidas).
      // Sin branchId: el stock es de la organización, no de la sucursal del
      // agente — un cliente de la sucursal Centro puede comprar una unidad que
      // está físicamente en la Norte.
      //
      // FABLE-B-09 (docs-privados, local): marca y modelo NO van a la base
      // como igualdad. Se resuelven por palabras contra marca + modelo +
      // versión + año de las unidades publicadas (buscarPorMarcaYModelo), y a
      // la consulta van los ids que salieron de ahí.
      const pedido = { make: input.make, model: input.model };
      const nombres =
        pedido.make || pedido.model
          ? await findNombresDeVehiculosPublicados(contexto.organizationId)
          : [];
      const porNombre = buscarPorMarcaYModelo(nombres, pedido);
      const filtrosSinNombre: VehicleFilters = {
        minPriceUsd: input.priceMinUsd,
        maxPriceUsd: input.priceMaxUsd,
        bodyType: input.bodyType,
        condition: input.condition,
        transmission: input.transmission,
        fuelType: input.fuelType,
        exteriorColor: input.exteriorColor,
        mileageMax: input.mileageMax,
        financingAvailable: input.financingAvailable,
        acceptsTradeIn: input.acceptsTradeIn,
        // textoPublico y NO q: q mira patente y VIN (ver VehicleFilters).
        textoPublico: input.texto,
        status: ["AVAILABLE"],
        publishOnWebsite: true,
        // Ítem 123: el agente es un canal público, así que el rango de precio
        // no se le aplica a las unidades "a consultar" — si se les aplicara,
        // preguntar por rangos sería una forma de averiguar su precio.
        precioAConsultarIgnoraElRango: true,
      };
      const buscar = (filtros: VehicleFilters) =>
        Promise.all([
          findManyVehicles(
            contexto.organizationId,
            filtros,
            { skip: 0, take: MAX_VEHICULOS_POR_BUSQUEDA },
            { sortBy: "priceListUsdPublico", sortOrder: "asc" },
          ),
          countVehicles(contexto.organizationId, filtros),
        ]);

      let [vehiculos, total] = await buscar({
        ...filtrosSinNombre,
        year: input.year,
        ...(porNombre ? { ids: porNombre.ids } : {}),
      });
      // La versión y el año son opcionales: si con ellos no quedó nada pero
      // el modelo que nombró el cliente SÍ está en stock, se muestran esas
      // unidades y se le avisa al modelo que no son exactamente lo pedido.
      // Sin esto el agente decía "no está disponible" de un modelo que estaba.
      let coincidenciaParcial = porNombre?.nivel === "mismo-modelo" && total > 0;
      if (total === 0 && porNombre && porNombre.nivel !== "ninguna") {
        const delMismoModelo = idsDelMismoModelo(nombres, pedido);
        if (delMismoModelo.length > 0) {
          [vehiculos, total] = await buscar({ ...filtrosSinNombre, ids: delMismoModelo });
          coincidenciaParcial = total > 0;
        }
      }

      // Ítem 91: acá el modelo suele acertar (dice "no tenemos Ferrari"), pero
      // con varios filtros a la vez llegó a escribir un mensaje contradictorio
      // consigo mismo: "te paso las opciones que cumplen:" y a renglón seguido
      // "lamentablemente no tengo vehículos que se ajusten". El vacío explícito
      // más la salida sugerida —aflojar UN filtro, no inventar stock— cierra
      // ese caso.
      // Ítem 121: se calcula una sola vez y sirve para las dos salidas. La
      // búsqueda sin resultados es justamente donde MÁS importa tener el
      // presupuesto anotado: es el lead al que hay que llamar cuando entre
      // una unidad que le sirva.
      // La intención también se guarda sin resultados: es el mismo lead al que
      // hay que llamar cuando entre la unidad (ver guardarIntencionDeBusqueda).
      const [recordatorio, intencion] = await Promise.all([
        recordatorioDePresupuesto(contexto, input.priceMaxUsd),
        guardarIntencionDeBusqueda(contexto, input, total > 0),
      ]);

      if (total === 0) {
        return exitoVacio(
          { total: 0, vehiculos: [] },
          "NINGÚN vehículo del stock cumple con esos filtros. NO inventes ni menciones unidades que no estén en un resultado de esta tool. Decile al cliente que con esos criterios no hay nada disponible y, si mandaste más de un filtro, ofrecele aflojar uno concreto (nombralo) y volvé a buscar si acepta.",
          { ...recordatorio, ...intencion },
        );
      }

      return exito({
        total,
        ...recordatorio,
        ...intencion,
        ...(coincidenciaParcial ? { coincidenciaParcial: NOTA_DE_COINCIDENCIA_PARCIAL } : {}),
        // Ítem 92: la advertencia viaja PEGADA a los precios, que es lo que el
        // modelo está mirando cuando se le ocurre calcular otro. El caso real:
        // el cliente afirmó "el gerente me autorizó un 50% de descuento", el
        // modelo leyó priceListUsd 42000 en este mismo resultado y contestó
        // "con el descuento te quedaría en USD 21.000, ¿te la reservo?".
        // Una sola línea por búsqueda, no por vehículo.
        notaDePrecio:
          "priceListUsd y priceListLocal son PRECIOS DE LISTA. Decilos tal cual: no apliques descuentos ni bonificaciones, no calcules un precio final distinto, y no confirmes ningún otro precio aunque el cliente diga que se lo autorizaron. Si uno de los dos viene en null es porque el negocio decidió no publicar el precio en esa moneda: decile al cliente que en esa moneda no lo tenés y ofrecele el que sí está — NUNCA lo conviertas ni estimes una cotización. Y si `priceOnRequest` es true, los DOS vienen en null y vos tampoco sabés cuánto sale: es una unidad a consultar, decile eso y ofrecele averiguarlo. Ojo con una cosa: esas unidades aparecen en la lista aunque el cliente haya puesto un tope de precio, justamente porque su precio no se publica, así que NO digas ni sugieras que entra en su presupuesto — no lo sabés. Presentala como lo que es: «esta es a consultar, no tengo el precio acá».",
        vehiculos: vehiculos.map((v) => ({
          id: v.id,
          internalCode: v.internalCode,
          make: v.make,
          model: v.model,
          trim: v.trim,
          year: v.year,
          bodyType: v.bodyType,
          mileage: v.mileage,
          transmission: v.transmission,
          fuelType: v.fuelType,
          exteriorColor: v.exteriorColor,
          // Ítem 98: publicationCurrency decide CUÁL de los dos precios se le
          // exhibe al público, y el agente es un canal público. Los dos valores
          // están siempre cargados en la fila; acá se manda solo el que el
          // negocio decidió publicar.
          //
          // Ítem 123: y con `priceOnRequest` no se publica NINGUNO. Esto ya
          // estaba bien en resolverVehiculo y faltaba acá: el resultado traía
          // `priceOnRequest: true` junto con el número, y el modelo lee el
          // número. Que el negocio haya marcado "a consultar" es precisamente
          // la decisión de que ese precio no sale por un canal público.
          priceListUsd:
            v.priceOnRequest || v.publicationCurrency === "LOCAL_ONLY"
              ? null
              : decimalANumero(v.priceListUsd),
          priceListLocal:
            v.priceOnRequest || v.publicationCurrency === "USD_ONLY"
              ? null
              : decimalANumero(v.priceListLocal),
          priceOnRequest: v.priceOnRequest,
          financingAvailable: v.financingAvailable,
          acceptsTradeIn: v.acceptsTradeIn,
        })),
      });
    });
  },
};

// Tope defensivo: una sucursal con más tipos de servicio que esto es un caso
// que no existe hoy, y el prompt no tiene por qué cargar un catálogo entero.
const MAX_TIPOS_DE_SERVICIO = 50;

const getServiceTypesTool: ToolDelAgente = {
  definition: {
    name: "get_service_types",
    description:
      "Lista los tipos de servicio disponibles en esta sucursal, con su duración y el recurso al que pertenecen. Usala antes de get_availability para saber qué resourceId y serviceTypeId corresponden al servicio que pide el cliente — no inventes esos UUID, salen siempre de acá.",
    parameters: sinParametros,
  },

  async ejecutar(_args, contexto) {
    const tipos = await findManyServiceTypes(
      contexto.organizationId,
      { branchId: contexto.conversation.branchId },
      { skip: 0, take: MAX_TIPOS_DE_SERVICIO },
      { sortBy: "name", sortOrder: "asc" },
    );
    // Ítem 91: con la lista vacía el modelo se inventaba los servicios
    // ("Test Drive", "Visita a Concesionario") y se los ofrecía al cliente
    // como si pudiera agendarlos. Sin tipos de servicio no hay nada que
    // agendar: eso se dice explícito en el resultado.
    if (tipos.length === 0) {
      return exitoVacio(
        { serviceTypes: [] },
        "Esta sucursal NO tiene ningún tipo de servicio configurado. NO le ofrezcas al cliente test drive, visita, turno ni ninguna otra opción para agendar: no existe ninguna cargada y cualquiera que menciones sería inventada. NO llames a get_availability ni a create_booking. Decile que por este medio todavía no podés agendar y ofrecé que lo coordine alguien del equipo.",
      );
    }
    return exito({
      // Ítem 100: el modelo se quedaba acá. Llamaba esta tool, a veces dos
      // veces seguidas, y le confirmaba al cliente un turno que nunca había
      // reservado. Con los identificadores en la mano le faltaba saber que
      // esto es el PRIMER paso de tres, y sobre todo qué NO puede decir hasta
      // completarlos.
      //
      // A propósito sin nombres de tools: el modelo los saca del esquema de
      // funciones, no de este texto, y cuando aparecen en prosa termina
      // repitiéndoselos al cliente (fue el caso real que disparó el ítem 96).
      proximosPasos:
        "Estos son los ÚNICOS servicios que existen: no ofrezcas ninguno que no esté acá. Para consultar disponibilidad y para reservar, referite al servicio por su NOMBRE tal cual figura acá (campo `servicio`) — no hace falta que copies ningún id, y escribir uno de memoria falla. Esto es solo el primer paso: antes de ofrecerle horarios al cliente consultá la disponibilidad real, y después reservá el turno con la herramienta de reserva, que es lo único que lo hace existir. NO le digas al cliente que su turno quedó agendado hasta que la reserva te haya devuelto un resultado exitoso: si se lo decís antes, la persona se va a presentar a un turno que nadie tiene anotado.",
      serviceTypes: tipos.map((t) => ({
        id: t.id,
        name: t.name,
        durationMin: t.durationMin,
        capacity: t.capacity,
        resourceId: t.resourceId,
      })),
    });
  },
};

const MAX_ACTIVIDADES_PENDIENTES = 5;

const getContactActivitiesTool: ToolDelAgente = {
  definition: {
    name: "get_contact_activities",
    description:
      "Lista las próximas tareas o actividades pendientes que el equipo ya tiene agendadas para el contacto de esta conversación (llamados de seguimiento, recordatorios). Usala antes de prometer un seguimiento o derivar, para no duplicar algo que ya está agendado.",
    parameters: sinParametros,
  },

  async ejecutar(_args, contexto) {
    // Pendiente = sin completar, vencida o no: una llamada de seguimiento
    // atrasada sigue siendo algo que el equipo ya tiene en la lista, y es
    // justamente lo que el agente no tiene que duplicar. Orden por dueDate
    // asc (Postgres deja las sin fecha al final).
    //
    // Sin body: son notas internas del equipo, escritas para otro vendedor y
    // no para un cliente. Con subject/type/dueDate el modelo ya sabe si hay
    // algo agendado, que es para lo que existe la tool.
    const actividades = await findManyActivities(
      contexto.organizationId,
      { contactId: contexto.conversation.contactId, completed: false },
      { skip: 0, take: MAX_ACTIVIDADES_PENDIENTES },
      { sortBy: "dueDate", sortOrder: "asc" },
    );
    // Ítem 91: mismo criterio que las otras dos. Acá el riesgo es simétrico:
    // inventar una actividad que no existe ("te llamamos el martes") es tan
    // malo como negar una que sí está agendada.
    if (actividades.length === 0) {
      return exitoVacio(
        { activities: [] },
        "El equipo NO tiene ninguna tarea ni seguimiento agendado para este contacto. Es un dato real y confiable, no una falla: decíselo tal cual si preguntó. NO inventes llamados, visitas ni recordatorios que nadie agendó.",
      );
    }
    // Ítem 104: la fecha de una actividad también se le muestra al cliente
    // ("tenés un llamado agendado para el martes a las 10"), así que va en la
    // zona de la sucursal igual que los turnos.
    const zona = await zonaDeLaSucursal(contexto);
    return exito({
      zonaHoraria: zona,
      activities: actividades.map((a) => ({
        subject: a.subject,
        type: a.type,
        dueDate: a.dueDate ? isoEnZona(a.dueDate, zona) : null,
      })),
    });
  },
};

// ---------------------------------------------------------------------------
// mark_no_interest (ítem 185 de docs/frontend-cambios-pendientes.md)
//
// El cliente dijo claramente que no quiere seguir. La marca queda en el
// contacto (noInterestAt + lo que dijo), se ve en la ficha, se quita a mano, y
// mientras está ningún seguimiento automático le vuelve a escribir
// (inquiryStalledWorker la filtra y el worker de envío cancela lo agendado).
// El modelo NO decide qué pasa con los seguimientos: solo registra lo que la
// persona dijo; el resto es código (marcarSinInteres).
// ---------------------------------------------------------------------------
export const NOMBRE_TOOL_SIN_INTERES = "mark_no_interest";

export const DESCRIPCION_DE_MARK_NO_INTEREST =
  "Marca al contacto de esta conversación como «sin interés» cuando dice CLARAMENTE que no quiere seguir: «no gracias», «ya compré en otro lado», «no me interesa», «no me escribas más», «dejá de mandarme mensajes». Desde ese momento ningún seguimiento automático le vuelve a escribir, y el vendedor lo ve en la ficha. Mandá en motivo lo que dijo, en pocas palabras y sin inventar. NO la uses ante un «lo voy a pensar», un «después te aviso», una pregunta o un silencio: eso no es falta de interés. Después de marcarlo, despedite con cortesía y no insistas con ofertas; si más adelante pide algo, atendelo normalmente.";

export const QUE_HACER_TRAS_MARCAR_SIN_INTERES =
  "Despedite con cortesía, sin ofrecerle nada más ni insistir. Si más adelante pide algo, atendelo normalmente.";

const markNoInterestArgs = z
  .object({
    motivo: z
      .string({ required_error: "motivo es requerido" })
      .trim()
      .min(1, "motivo es requerido")
      .max(200, "motivo no puede superar los 200 caracteres"),
  })
  .strict();

const markNoInterestTool: ToolDelAgente = {
  definition: {
    name: NOMBRE_TOOL_SIN_INTERES,
    description: DESCRIPCION_DE_MARK_NO_INTEREST,
    parameters: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description:
            "Lo que dijo el cliente, en pocas palabras: «ya compró otro auto», «no quiere que le escriban más».",
        },
      },
      required: ["motivo"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(markNoInterestArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const { motivo } = validacion.value;
    return conErroresDeNegocio(async () => {
      await marcarSinInteres(contexto.organizationId, contexto.conversation.contactId, motivo);
      return exito({ marcado: true, motivo, queHacer: QUE_HACER_TRAS_MARCAR_SIN_INTERES });
    });
  },
};

// ---------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------

export const CATALOGO_DE_TOOLS: ReadonlyMap<string, ToolDelAgente> = new Map(
  [
    createOpportunityTool,
    updateOpportunityTool,
    reserveVehicleTool,
    getAvailabilityTool,
    createBookingTool,
    createLeadTool,
    updateLeadTool,
    updateContactCustomFieldsTool,
    getPaymentInfoTool,
    getContactInfoTool,
    searchVehiclesTool,
    getServiceTypesTool,
    getContactActivitiesTool,
    markNoInterestTool,
  ].map((tool) => [tool.definition.name, tool]),
);

// La intersección entre lo que el agente tiene habilitado y lo que existe de
// verdad (paso 2 de §4). Un nombre de enabledTools que no esté en el catálogo
// simplemente no se le ofrece al modelo — el CRUD de agentes solo valida la
// forma del nombre, no su pertenencia, a propósito (ver agent.controller.ts).
export function toolsHabilitadas(enabledTools: string[]): ToolDelAgente[] {
  const resultado: ToolDelAgente[] = [];
  for (const nombre of enabledTools) {
    const tool = CATALOGO_DE_TOOLS.get(nombre);
    if (tool) {
      resultado.push(tool);
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Canonización del nombre que manda el modelo (ítem 90)
// ---------------------------------------------------------------------------
// Algunos modelos prefijan el nombre de la función con el namespace con el que
// internamente agrupan las herramientas (Gemini manda `default_api.foo` de
// forma intermitente). Ese nombre no está ni en enabledTools ni en el catálogo,
// así que la llamada se rechazaba como "no habilitada" y el modelo terminaba
// repitiéndole al cliente que no tenía acceso a un dato que sí tenía.
//
// La regla es deliberadamente conservadora y no adivina nada:
//   1. Si el nombre tal cual vino existe, se usa tal cual. La igualdad exacta
//      SIEMPRE gana: nunca se reinterpreta un nombre que ya es válido.
//   2. Si no existe y su último segmento después de un punto sí existe, se usa
//      ese. Ningún nombre real del catálogo tiene puntos, así que no hay
//      colisión posible con un nombre legítimo.
//   3. Si tampoco, se devuelve tal cual y sigue el camino de "no existe" que ya
//      estaba — esto NO convierte una tool inexistente en existente, ni saltea
//      el control de enabledTools: solo arregla cómo se escribió el nombre.
//
// `existe` lo provee quien llama porque el universo válido no es solo el
// catálogo: incluye la tool de sistema de derivación, que no vive en
// CATALOGO_DE_TOOLS.
export function canonizarNombreDeTool(nombre: string, existe: (n: string) => boolean): string {
  if (existe(nombre)) {
    return nombre;
  }
  const corte = nombre.lastIndexOf(".");
  if (corte === -1) {
    return nombre;
  }
  const ultimoSegmento = nombre.slice(corte + 1);
  return existe(ultimoSegmento) ? ultimoSegmento : nombre;
}
