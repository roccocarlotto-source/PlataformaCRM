import {
  LeadUrgency,
  VehicleBodyType,
  VehicleCondition,
  VehicleFuelType,
  VehicleTransmission,
} from "@prisma/client";
import { z } from "zod";
import { findManyActivities } from "../repositories/activity.repository";
import { findBranchById } from "../repositories/branch.repository";
import { findContactById } from "../repositories/contact.repository";
import { findManyOpportunities, findOpportunityById } from "../repositories/opportunity.repository";
import { findDefaultPipeline } from "../repositories/pipeline.repository";
import { findResourceById } from "../repositories/resource.repository";
import { findManyServiceTypes } from "../repositories/serviceType.repository";
import { findStageById, findStagesByPipeline } from "../repositories/stage.repository";
import {
  countVehicles,
  findManyVehicles,
  type VehicleFilters,
} from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { currencySchema } from "../utils/validation";
import { MAX_DIAS_DE_RANGO, obtenerDisponibilidad } from "./availability.service";
import { createBooking } from "./booking.service";
import { qualifyLead } from "./contact.service";
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
  };
}

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

function fallo(error: string): ResultadoDeTool {
  return { ok: false, error };
}

function exito(data: unknown): ResultadoDeTool {
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

function exitoVacio(data: Record<string, unknown>, queHacer: string): ResultadoDeTool {
  return exito({ ...data, sinResultados: true, queHacer });
}

// Los argumentos vienen del modelo, así que son tan poco confiables como un
// body HTTP: se validan con Zod igual que en un controller. Un fallo de
// validación es un resultado de tool, no un 400 — el modelo puede corregirse.
function validarArgs<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, args: unknown) {
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { ok: true as const, value: parsed.data };
  }
  const detalle = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
    .join("; ");
  return { ok: false as const, resultado: fallo(`Argumentos inválidos — ${detalle}`) };
}

// Ejecuta `fn` y traduce un AppError del service a un resultado de tool. Todo
// lo demás se propaga (ver el encabezado).
async function conErroresDeNegocio(fn: () => Promise<ResultadoDeTool>): Promise<ResultadoDeTool> {
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

function vacioComoAusente<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (esVacio(v) ? undefined : v), schema.optional());
}

function textoOpcional(max: number) {
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
const instanteIso = z
  .string()
  .datetime({
    offset: true,
    message: "debe ser una fecha-hora ISO 8601 con zona (ej. 2026-09-14T15:00:00-03:00)",
  })
  .transform((v) => new Date(v));

// ---------------------------------------------------------------------------
// create_opportunity
// ---------------------------------------------------------------------------

const createOpportunityArgs = z.object({
  title: z.string().trim().min(1, "title es requerido").max(255),
  amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
  currency: vacioComoAusente(currencySchema),
});

export const MENSAJE_CONTACTO_SIN_VENDEDOR =
  "No se puede crear la oportunidad: el contacto no tiene un vendedor asignado";
export const MENSAJE_SIN_PIPELINE_POR_DEFECTO =
  "No se puede crear la oportunidad: la organización no tiene un pipeline por defecto configurado";
export const MENSAJE_PIPELINE_SIN_ETAPAS =
  "No se puede crear la oportunidad: el pipeline por defecto no tiene etapas";

const createOpportunityTool: ToolDelAgente = {
  definition: {
    name: "create_opportunity",
    description:
      "Crea una oportunidad de venta para el contacto de esta conversación. La oportunidad queda asignada al vendedor del contacto, en la primera etapa del pipeline por defecto. Usala cuando el contacto muestra intención concreta de compra o contratación. Si el contacto ya tiene una oportunidad abierta, no crea otra: devuelve esa con reused en true, y es sobre esa que tenés que seguir. Para cambiarle el título, el monto u otro dato usá update_opportunity con su opportunityId, no vuelvas a llamar a esta.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título corto de la oportunidad (qué quiere el contacto).",
        },
        amount: { type: "number", description: "Monto estimado, si se conoce. Mayor o igual a 0." },
        currency: {
          type: "string",
          description:
            "Moneda del monto, código ISO 4217 de 3 letras (USD, UYU, ARS). Solo si hay monto.",
        },
      },
      required: ["title"],
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
      const [existente] = await findManyOpportunities(
        contexto.organizationId,
        { contactId: contact.id, status: "OPEN" },
        { skip: 0, take: 1 },
        { sortBy: "createdAt", sortOrder: "desc" },
      );
      if (existente) {
        const etapa = await findStageById(existente.stageId, contexto.organizationId);
        return exito({
          opportunityId: existente.id,
          title: existente.title,
          amount: existente.amount,
          currency: existente.currency,
          status: existente.status,
          stage: etapa?.name ?? null,
          reused: true,
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
      // Ordenados por `order` asc, solo activos: el primero es la etapa inicial.
      const [primeraEtapa] = await findStagesByPipeline(pipeline.id);
      if (!primeraEtapa) {
        return fallo(MENSAJE_PIPELINE_SIN_ETAPAS);
      }

      // actorUserId = el vendedor efectivo del contacto (el suyo, o el de la
      // sucursal): es a quien se le atribuye la oportunidad (y quien figura en
      // el historial de la unidad si algún día el agente vinculara un vehículo
      // — hoy no puede). resolveOwnerId lo revalida adentro de createOpportunity;
      // si no estuviera activo, el AppError vuelve como resultado.
      const opportunity = await createOpportunity(contexto.organizationId, ownerId, {
        title: input.title,
        amount: input.amount,
        currency: input.currency,
        contactId: contact.id,
        ownerId,
        pipelineId: pipeline.id,
        stageId: primeraEtapa.id,
      });

      return exito({
        opportunityId: opportunity.id,
        title: opportunity.title,
        amount: opportunity.amount,
        currency: opportunity.currency,
        status: opportunity.status,
        stage: primeraEtapa.name,
        reused: false,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// update_opportunity
// ---------------------------------------------------------------------------

const updateOpportunityArgs = z
  .object({
    opportunityId: uuid("opportunityId"),
    title: textoOpcional(255),
    amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
    currency: vacioComoAusente(currencySchema),
    status: vacioComoAusente(z.enum(["OPEN", "WON", "LOST"])),
    stageId: vacioComoAusente(uuid("stageId")),
    lostReason: textoOpcional(255),
  })
  .refine((data) => cantidadDeArgumentos(data) > 1, {
    message: "Hay que indicar al menos un campo a modificar además de opportunityId",
  });

export const MENSAJE_OPORTUNIDAD_DE_OTRO_CONTACTO =
  "La oportunidad indicada no pertenece al contacto de esta conversación";

const updateOpportunityTool: ToolDelAgente = {
  definition: {
    name: "update_opportunity",
    description:
      "Modifica una oportunidad existente del contacto de esta conversación: título, monto, moneda, estado (OPEN/WON/LOST), etapa o motivo de pérdida. No permite cambiar el vendedor ni el pipeline.",
    parameters: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "UUID de la oportunidad a modificar." },
        title: { type: "string" },
        amount: { type: "number", description: "Monto, mayor o igual a 0." },
        currency: { type: "string", description: "Código ISO 4217 de 3 letras." },
        status: { type: "string", enum: ["OPEN", "WON", "LOST"] },
        stageId: {
          type: "string",
          description: "UUID de la etapa destino, dentro del mismo pipeline.",
        },
        lostReason: {
          type: "string",
          description: "Motivo de pérdida. Solo tiene sentido con status LOST.",
        },
      },
      required: ["opportunityId"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(updateOpportunityArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const { opportunityId, ...cambios } = validacion.value;

    return conErroresDeNegocio(async () => {
      const opportunity = await findOpportunityById(opportunityId, contexto.organizationId);
      if (!opportunity) {
        return fallo("La oportunidad indicada no existe");
      }
      // Un agente solo toca las oportunidades del contacto con el que está
      // hablando. Que la organización coincida no alcanza: eso lo garantiza el
      // repositorio, pero no impide que el modelo pase el id de otro cliente.
      if (opportunity.contactId !== contexto.conversation.contactId) {
        return fallo(MENSAJE_OPORTUNIDAD_DE_OTRO_CONTACTO);
      }

      // actorUserId = el ownerId que la oportunidad ya tiene. Es inerte en este
      // camino: updateOpportunity solo lo usa para resolver un ownerId nuevo
      // (que acá nunca se manda) y para el historial de una unidad vinculada.
      const actualizada = await updateOpportunity(
        contexto.organizationId,
        opportunity.ownerId,
        opportunityId,
        cambios,
      );

      return exito({
        opportunityId: actualizada.id,
        title: actualizada.title,
        amount: actualizada.amount,
        currency: actualizada.currency,
        status: actualizada.status,
        stageId: actualizada.stageId,
        lostReason: actualizada.lostReason,
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

const getAvailabilityArgs = z
  .object({
    resourceId: uuid("resourceId"),
    serviceTypeId: uuid("serviceTypeId"),
    desde: instanteIso,
    hasta: instanteIso,
  })
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
      "Consulta los turnos disponibles de un recurso (persona, sala o clase) para un servicio, en un rango de fechas. Devuelve los horarios libres con inicio y fin. Usala antes de reservar.",
    parameters: {
      type: "object",
      properties: {
        resourceId: { type: "string", description: "UUID del recurso." },
        serviceTypeId: { type: "string", description: "UUID del tipo de servicio." },
        desde: { type: "string", description: "Inicio del rango, ISO 8601 con zona." },
        hasta: {
          type: "string",
          description: `Fin del rango, ISO 8601 con zona. Máximo ${MAX_DIAS_DE_RANGO} días después de desde.`,
        },
      },
      required: ["resourceId", "serviceTypeId", "desde", "hasta"],
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
      const rechazo = await resolverRecursoDeLaSucursal(params.resourceId, contexto);
      if (rechazo) {
        return rechazo;
      }

      const turnos = await obtenerDisponibilidad(contexto.organizationId, params);

      return exito({
        turnos: turnos.map((t) => ({
          inicio: t.inicio.toISOString(),
          fin: t.fin.toISOString(),
          lugaresDisponibles: t.lugaresDisponibles,
        })),
      });
    });
  },
};

const createBookingArgs = z.object({
  resourceId: uuid("resourceId"),
  serviceTypeId: uuid("serviceTypeId"),
  startsAt: instanteIso,
});

const createBookingTool: ToolDelAgente = {
  definition: {
    name: "create_booking",
    description:
      "Reserva un turno para el contacto de esta conversación en un recurso y servicio, a partir de un horario. El horario tiene que ser uno de los que devolvió get_availability. El fin lo determina la duración del servicio.",
    parameters: {
      type: "object",
      properties: {
        resourceId: { type: "string", description: "UUID del recurso." },
        serviceTypeId: { type: "string", description: "UUID del tipo de servicio." },
        startsAt: { type: "string", description: "Inicio del turno, ISO 8601 con zona." },
      },
      required: ["resourceId", "serviceTypeId", "startsAt"],
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
      const rechazo = await resolverRecursoDeLaSucursal(input.resourceId, contexto);
      if (rechazo) {
        return rechazo;
      }

      const booking = await createBooking(contexto.organizationId, {
        resourceId: input.resourceId,
        serviceTypeId: input.serviceTypeId,
        // Siempre el contacto de la conversación.
        contactId: contexto.conversation.contactId,
        startsAt: input.startsAt,
      });

      return exito({
        bookingId: booking.id,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        status: booking.status,
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
  },
  required: [],
  additionalProperties: false,
};

function ejecutarCalificacion(
  args: Record<string, unknown>,
  contexto: ContextoDeEjecucionDeTool,
): Promise<ResultadoDeTool> {
  const validacion = validarArgs(leadArgs, args);
  if (!validacion.ok) {
    return Promise.resolve(validacion.resultado);
  }
  const input = validacion.value;

  return conErroresDeNegocio(async () => {
    const contacto = await qualifyLead(
      contexto.organizationId,
      contexto.conversation.contactId,
      input,
    );

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
    });
  });
}

const createLeadTool: ToolDelAgente = {
  definition: {
    name: "create_lead",
    description:
      "Registra la calificación inicial del contacto de esta conversación como lead: puntaje, intención, servicio de interés, urgencia, presupuesto, zona y notas. Usala la primera vez que reunís datos de calificación en la conversación. Todos los campos son opcionales; mandá los que conozcas.",
    parameters: LEAD_PARAMETERS,
  },
  ejecutar: ejecutarCalificacion,
};

const updateLeadTool: ToolDelAgente = {
  definition: {
    name: "update_lead",
    description:
      "Actualiza la calificación del contacto de esta conversación cuando aparece información nueva o cambia algo (subió el presupuesto, cambió la urgencia, surgió una duda). Las notas se agregan a las anteriores. Todos los campos son opcionales; mandá solo lo que cambió.",
    parameters: LEAD_PARAMETERS,
  },
  ejecutar: ejecutarCalificacion,
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
      "Devuelve los datos que el CRM tiene cargados del contacto de esta conversación (nombre, apellido, email, teléfono). Usala para saber si ya tenés el nombre de la persona antes de preguntárselo de nuevo, o antes de derivar, para que la persona que retome tenga contexto.",
    parameters: sinParametros,
  },

  async ejecutar(_args, contexto) {
    const contact = await findContactById(contexto.conversation.contactId, contexto.organizationId);
    if (!contact) {
      return fallo("El contacto de esta conversación ya no existe");
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

const searchVehiclesTool: ToolDelAgente = {
  definition: {
    name: "search_vehicles",
    description:
      'Busca vehículos disponibles en stock que están publicados para mostrar a clientes. REGLA PRINCIPAL: cada filtro que mandes tiene que poder señalarse en las palabras del cliente. Si el cliente no lo dijo, NO lo mandes — nunca lo completes con un valor que te parezca razonable. Un filtro de más esconde autos que sí hay, y le terminás diciendo al cliente que no hay stock cuando sí hay. Ejemplo: si el cliente solo dice "algo de menos de 30 mil dólares", mandá únicamente priceMaxUsd: 30000, sin carrocería, transmisión, combustible, condición ni kilometraje. Si no dio ningún dato, llamala sin filtros. Filtros disponibles: precio en USD, marca, modelo, año, tipo de carrocería, 0 km o usado, transmisión, combustible, color, kilometraje máximo, financiación, permuta, y un texto libre para cualquier otra cosa (equipamiento, versión, algo de la descripción). Devuelve como máximo 10 resultados y el total. Los resultados vienen ordenados de más barato a más caro (los de precio a consultar, sin precio de lista, van al final). Ejemplo: si preguntan cuál es el más barato, llamala con los filtros que el cliente haya dado (o sin filtros si no dio ninguno) y contestá con el primero de la lista — no hace falta pedir más datos para eso. Para el más caro, el último con precio de la lista lo es solo si total es 10 o menos; si total es mayor, la lista trae solo los 10 más baratos y el más caro no está en ella: no afirmes cuál es. Usala cuando el cliente pregunta por autos disponibles o pide opciones dentro de un presupuesto o con ciertas características.',
    parameters: {
      type: "object",
      properties: {
        priceMinUsd: { type: "number", description: "Precio de lista mínimo, en USD." },
        priceMaxUsd: { type: "number", description: "Precio de lista máximo, en USD." },
        make: {
          type: "string",
          description:
            "Marca, escrita como se escribe normalmente (ej. Toyota). Coincidencia exacta.",
        },
        model: {
          type: "string",
          description:
            "Modelo, escrito como se escribe normalmente (ej. Corolla). Coincidencia exacta.",
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
      const filtros: VehicleFilters = {
        minPriceUsd: input.priceMinUsd,
        maxPriceUsd: input.priceMaxUsd,
        make: input.make,
        model: input.model,
        year: input.year,
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
      };
      const [vehiculos, total] = await Promise.all([
        findManyVehicles(
          contexto.organizationId,
          filtros,
          { skip: 0, take: MAX_VEHICULOS_POR_BUSQUEDA },
          { sortBy: "priceListUsd", sortOrder: "asc" },
        ),
        countVehicles(contexto.organizationId, filtros),
      ]);

      // Ítem 91: acá el modelo suele acertar (dice "no tenemos Ferrari"), pero
      // con varios filtros a la vez llegó a escribir un mensaje contradictorio
      // consigo mismo: "te paso las opciones que cumplen:" y a renglón seguido
      // "lamentablemente no tengo vehículos que se ajusten". El vacío explícito
      // más la salida sugerida —aflojar UN filtro, no inventar stock— cierra
      // ese caso.
      if (total === 0) {
        return exitoVacio(
          { total: 0, vehiculos: [] },
          "NINGÚN vehículo del stock cumple con esos filtros. NO inventes ni menciones unidades que no estén en un resultado de esta tool. Decile al cliente que con esos criterios no hay nada disponible y, si mandaste más de un filtro, ofrecele aflojar uno concreto (nombralo) y volvé a buscar si acepta.",
        );
      }

      return exito({
        total,
        // Ítem 92: la advertencia viaja PEGADA a los precios, que es lo que el
        // modelo está mirando cuando se le ocurre calcular otro. El caso real:
        // el cliente afirmó "el gerente me autorizó un 50% de descuento", el
        // modelo leyó priceListUsd 42000 en este mismo resultado y contestó
        // "con el descuento te quedaría en USD 21.000, ¿te la reservo?".
        // Una sola línea por búsqueda, no por vehículo.
        notaDePrecio:
          "priceListUsd y priceListLocal son PRECIOS DE LISTA. Decilos tal cual: no apliques descuentos ni bonificaciones, no calcules un precio final distinto, y no confirmes ningún otro precio aunque el cliente diga que se lo autorizaron.",
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
          priceListUsd: decimalANumero(v.priceListUsd),
          priceListLocal: decimalANumero(v.priceListLocal),
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
    return exito({
      activities: actividades.map((a) => ({
        subject: a.subject,
        type: a.type,
        dueDate: a.dueDate ? a.dueDate.toISOString() : null,
      })),
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
    getAvailabilityTool,
    createBookingTool,
    createLeadTool,
    updateLeadTool,
    getPaymentInfoTool,
    getContactInfoTool,
    searchVehiclesTool,
    getServiceTypesTool,
    getContactActivitiesTool,
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
