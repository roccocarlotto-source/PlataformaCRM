import { LeadUrgency } from "@prisma/client";
import { z } from "zod";
import { findContactById } from "../repositories/contact.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import { findDefaultPipeline } from "../repositories/pipeline.repository";
import { findResourceById } from "../repositories/resource.repository";
import { findStagesByPipeline } from "../repositories/stage.repository";
import { AppError } from "../utils/AppError";
import { currencySchema } from "../utils/validation";
import { MAX_DIAS_DE_RANGO, obtenerDisponibilidad } from "./availability.service";
import { createBooking } from "./booking.service";
import { qualifyLead } from "./contact.service";
import type { LlmToolDefinition } from "./llmProvider.service";
import { createOpportunity, updateOpportunity } from "./opportunity.service";

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
//     asignado a ese lead). Sin vendedor asignado, la tool falla con un error
//     claro — no se inventa un dueño.
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
  currency: currencySchema.optional(),
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
      "Crea una oportunidad de venta para el contacto de esta conversación. La oportunidad queda asignada al vendedor del contacto, en la primera etapa del pipeline por defecto. Usala cuando el contacto muestra intención concreta de compra o contratación.",
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
      if (!contact.ownerId) {
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

      // actorUserId = el vendedor del contacto: es a quien se le atribuye la
      // oportunidad (y quien figura en el historial de la unidad si algún día
      // el agente vinculara un vehículo — hoy no puede). resolveOwnerId valida
      // que siga activo en la organización; si no, el AppError vuelve como
      // resultado.
      const opportunity = await createOpportunity(contexto.organizationId, contact.ownerId, {
        title: input.title,
        amount: input.amount,
        currency: input.currency,
        contactId: contact.id,
        ownerId: contact.ownerId,
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
    title: z.string().trim().min(1).max(255).optional(),
    amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
    currency: currencySchema.optional(),
    status: z.enum(["OPEN", "WON", "LOST"]).optional(),
    stageId: uuid("stageId").optional(),
    lostReason: z.string().trim().min(1).max(255).optional(),
  })
  .refine((data) => Object.keys(data).length > 1, {
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
    score: z
      .number()
      .int("score debe ser un entero")
      .min(0, "score debe estar entre 0 y 100")
      .max(100, "score debe estar entre 0 y 100")
      .optional(),
    intent: z.string().trim().min(1).max(200).optional(),
    serviceOfInterest: z.string().trim().min(1).max(200).optional(),
    urgency: z.nativeEnum(LeadUrgency).optional(),
    budgetAmount: z.number().min(0, "budgetAmount debe ser mayor o igual a 0").optional(),
    budgetCurrency: currencySchema.optional(),
    location: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().min(1).max(4000).optional(),
    aiData: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
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
