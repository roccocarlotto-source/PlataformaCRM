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
import { findManyServiceTypes, findServiceTypeById } from "../repositories/serviceType.repository";
import { findStageById, findStagesByPipeline } from "../repositories/stage.repository";
import {
  countVehicles,
  findManyVehicles,
  type VehicleFilters,
} from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { isoEnZona } from "../utils/timezone";
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
function validarArgs<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, args: unknown) {
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { ok: true as const, value: parsed.data };
  }
  const detalle = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
    .join("; ");
  return {
    ok: false as const,
    resultado: fallo(`Argumentos inválidos — ${detalle}${SUFIJO_ERROR_DE_ARGUMENTOS}`),
  };
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
// decisión suya y necesita su propia tool, explícita.
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

  const etiquetaDe = (v: (typeof publicados)[number]) =>
    [v.make, v.model, v.trim, v.year].filter(Boolean).join(" ");
  const buscadas = palabrasNormalizadas(texto);
  // Todas las palabras que dijo el cliente tienen que aparecer: "Hilux SRV"
  // encuentra la SRV y no la DX, y "Hilux" solo devolvería las dos (y pide
  // desambiguar, que es lo correcto).
  const candidatos = publicados.filter((v) => {
    const heno = normalizarNombre(`${v.internalCode} ${etiquetaDe(v)}`);
    return buscadas.every((palabra) => heno.includes(palabra));
  });

  if (candidatos.length === 1) {
    const v = candidatos[0];
    return {
      ok: true,
      vehiculo: {
        id: v.id,
        etiqueta: etiquetaDe(v),
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
      `"${texto}" coincide con más de una unidad: ${candidatos.map((v) => `"${etiquetaDe(v)}"`).join(", ")}. Preguntale al cliente cuál es y volvé a intentarlo con esa.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// create_opportunity
// ---------------------------------------------------------------------------

const createOpportunityArgs = z.object({
  title: z.string().trim().min(1, "title es requerido").max(255),
  amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
  currency: vacioComoAusente(currencySchema),
  // Ítem 107: por texto, no por id (mismo criterio que `servicio` en el 106).
  vehiculo: textoOpcional(255),
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
      "Crea una oportunidad de venta para el contacto de esta conversación. La oportunidad queda asignada al vendedor del contacto, en la primera etapa del pipeline por defecto. Usala apenas el contacto muestra intención concreta de compra o contratación, en ese mismo turno y sin pedirle permiso ni más datos. Frases que YA son intención concreta y con las que corresponde llamarla: «me interesa mucho la Hilux SRV, ¿cómo seguimos?», «quiero avanzar con la Amarok», «me la llevo», «¿qué necesito para comprarla?». Registrar el interés no compromete al cliente a nada ni cierra ninguna venta: es lo que hace que un vendedor lo vea y lo atienda. No es algo que haya que consultarle. Si la conversación es por un vehículo concreto, mandá `vehiculo` con su marca y modelo: el monto se completa con su precio de lista, que es lo que el equipo de ventas necesita ver en el pipeline. Si el contacto ya tiene una oportunidad abierta, no crea otra: devuelve esa con reused en true, y es sobre esa que tenés que seguir. Para cambiarle el título, el monto u otro dato usá update_opportunity con su opportunityId, no vuelvas a llamar a esta.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título corto de la oportunidad (qué quiere el contacto).",
        },
        vehiculo: {
          type: "string",
          description:
            'Marca y modelo del vehículo que le interesa al cliente, como figura en el stock (por ejemplo "Hilux SRV"). Mandalo siempre que la conversación sea por una unidad concreta.',
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
        if (input.vehiculo !== undefined) {
          const resuelto = await resolverVehiculo(input.vehiculo, contexto);
          if (!resuelto.ok) {
            return resuelto.resultado;
          }
          unidadDelReuso = resuelto.vehiculo.etiqueta;
          cambios.title = input.title;
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
        return exito({
          opportunityId: vigente.id,
          title: vigente.title,
          amount: vigente.amount,
          currency: vigente.currency,
          status: vigente.status,
          stage: etapa?.name ?? null,
          reused: true,
          // Para que el modelo pueda contar lo que de verdad pasó: si es false,
          // la oportunidad quedó como estaba y no registró nada nuevo.
          actualizada: Object.keys(cambios).length > 0,
          ...(unidadDelReuso !== null ? { unidad: unidadDelReuso } : {}),
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
      // Ítem 107: el vehículo y, si el modelo no mandó monto, su precio de
      // lista. Un monto explícito del modelo SIEMPRE gana — puede ser lo que
      // el cliente ofreció, y registrarlo es correcto (ítem 92: registrar no
      // es aceptar).
      let unidad: string | undefined;
      let amount = input.amount;
      let currency = input.currency;
      if (input.vehiculo !== undefined) {
        const resuelto = await resolverVehiculo(input.vehiculo, contexto);
        if (!resuelto.ok) {
          return resuelto.resultado;
        }
        unidad = resuelto.vehiculo.etiqueta;
        if (amount === undefined && resuelto.vehiculo.priceListUsd !== null) {
          amount = resuelto.vehiculo.priceListUsd;
          currency = currency ?? "USD";
        }
      }

      const opportunity = await createOpportunity(contexto.organizationId, ownerId, {
        title: input.title,
        amount,
        currency,
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
        ...(unidad === undefined ? {} : { unidad }),
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
    // Ítem 112: OPCIONAL. Ver resolverOportunidad().
    opportunityId: vacioComoAusente(uuid("opportunityId")),
    title: textoOpcional(255),
    amount: z.number().min(0, "amount debe ser mayor o igual a 0").optional(),
    currency: vacioComoAusente(currencySchema),
    status: vacioComoAusente(z.enum(["OPEN", "WON", "LOST"])),
    stageId: vacioComoAusente(uuid("stageId")),
    lostReason: textoOpcional(255),
    // Ítem 107: para cuando el cliente cambia de auto a mitad de la charla.
    vehiculo: textoOpcional(255),
  })
  .refine((data) => cantidadDeArgumentos(data) - (data.opportunityId === undefined ? 0 : 1) > 0, {
    message: "Hay que indicar al menos un campo a modificar",
  });

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
  | { ok: true; opportunity: { id: string; contactId: string | null; ownerId: string } }
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
  const [abierta] = await findManyOpportunities(
    contexto.organizationId,
    { contactId: contexto.conversation.contactId, status: "OPEN" },
    { skip: 0, take: 1 },
    { sortBy: "createdAt", sortOrder: "desc" },
  );
  if (!abierta) {
    // No es un error de argumentos: es un estado legítimo del negocio, y el
    // modelo tiene que saber qué hacer con él en vez de improvisar.
    return {
      ok: false,
      resultado: exitoVacio(
        { opportunityId: null },
        `${MENSAJE_SIN_OPORTUNIDAD_ABIERTA} Si el contacto mostró interés concreto, usá create_opportunity.`,
      ),
    };
  }
  return { ok: true, opportunity: abierta };
}

const updateOpportunityTool: ToolDelAgente = {
  definition: {
    name: "update_opportunity",
    description:
      "Modifica la oportunidad abierta del contacto de esta conversación: título, monto, moneda, estado (OPEN/WON/LOST), etapa o motivo de pérdida. No hace falta que sepas su id: si no mandás opportunityId, se toma la que el contacto tiene abierta. No permite cambiar el vendedor ni el pipeline.",
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
        status: { type: "string", enum: ["OPEN", "WON", "LOST"] },
        stageId: {
          type: "string",
          description: "UUID de la etapa destino, dentro del mismo pipeline.",
        },
        lostReason: {
          type: "string",
          description: "Motivo de pérdida. Solo tiene sentido con status LOST.",
        },
        vehiculo: {
          type: "string",
          description:
            "Marca y modelo del vehículo que le interesa al cliente, como figura en el stock. Usalo cuando el cliente cambia de unidad: el monto se reajusta al precio de lista de la nueva.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgs(updateOpportunityArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const { opportunityId, vehiculo, ...cambios } = validacion.value;

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
      if (vehiculo !== undefined) {
        const resuelto = await resolverVehiculo(vehiculo, contexto);
        if (!resuelto.ok) {
          return resuelto.resultado;
        }
        if (cambiosConVehiculo.amount === undefined && resuelto.vehiculo.priceListUsd !== null) {
          cambiosConVehiculo.amount = resuelto.vehiculo.priceListUsd;
          cambiosConVehiculo.currency = cambiosConVehiculo.currency ?? "USD";
        }
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
export const MENSAJE_SERVICIO_SIN_IDENTIFICAR =
  'Hay que indicar el servicio: mandá `servicio` con el nombre (por ejemplo "Test drive") o `serviceTypeId` con el id exacto que devolvió la lista de servicios.';

function normalizarNombre(texto: string): string {
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
  if (args.servicio === undefined) {
    return { ok: false, resultado: fallo(MENSAJE_SERVICIO_SIN_IDENTIFICAR) };
  }

  const tipos = await findManyServiceTypes(
    contexto.organizationId,
    { branchId: contexto.conversation.branchId },
    { skip: 0, take: MAX_TIPOS_DE_SERVICIO },
    { sortBy: "name", sortOrder: "asc" },
  );
  const buscado = normalizarNombre(args.servicio);
  const coincidencias = tipos.filter((t) => normalizarNombre(t.name) === buscado);

  if (coincidencias.length === 1) {
    return { ok: true, serviceTypeId: coincidencias[0].id };
  }
  const disponibles = tipos.map((t) => `"${t.name}"`).join(", ");
  if (coincidencias.length === 0) {
    return {
      ok: false,
      resultado: fallo(
        tipos.length === 0
          ? "Esta sucursal no tiene ningún servicio configurado, así que no hay nada que agendar."
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
      "Reserva de verdad un turno para el contacto de esta conversación: hasta que esta tool no devuelva un resultado exitoso, el turno NO existe y no se lo podés confirmar al cliente. Alcanza con el serviceTypeId, el recurso se deduce solo. El horario tiene que ser uno de los que ya devolvió la consulta de disponibilidad. El fin lo determina la duración del servicio.",
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

      const booking = await createBooking(contexto.organizationId, {
        resourceId: recurso.resourceId,
        serviceTypeId: servicio.serviceTypeId,
        // Siempre el contacto de la conversación.
        contactId: contexto.conversation.contactId,
        startsAt: input.startsAt,
      });

      const zona = await zonaDeLaSucursal(contexto);
      return exito({
        bookingId: booking.id,
        zonaHoraria: zona,
        startsAt: isoEnZona(booking.startsAt, zona),
        endsAt: isoEnZona(booking.endsAt, zona),
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
    // Ítem 116: identidad. No son calificación, pero llegan en la misma frase
    // ("soy Diego Ramírez, mi mail es...") y sin esto no había NINGUNA forma
    // de guardarlos. qualifyLead decide si se aplican.
    firstName: textoOpcional(100),
    lastName: textoOpcional(100),
    email: vacioComoAusente(z.string().email("email no tiene formato de correo").max(255)),
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
    const { contacto, identidadIgnorada } = await qualifyLead(
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
      // Ítem 116: la identidad que quedó guardada, y la que NO. Sin esto el
      // modelo le diría al cliente "ya anoté tu mail" habiendo guardado solo
      // la calificación (ítem 100).
      firstName: contacto.firstName,
      lastName: contacto.lastName,
      email: contacto.email,
      ...(identidadIgnorada.length > 0
        ? {
            noSeActualizo: identidadIgnorada,
            queHacer:
              "Esos datos ya estaban cargados en el CRM y no se pisan desde el chat. No le digas al cliente que los actualizaste; si insiste en corregirlos, derivá.",
          }
        : {}),
    });
  });
}

const createLeadTool: ToolDelAgente = {
  definition: {
    name: "create_lead",
    description:
      "Registra en el CRM lo que sabés del contacto de esta conversación: su nombre y su mail, y su calificación como lead —puntaje, intención, servicio de interés, urgencia, presupuesto, zona y notas. Usala la PRIMERA vez que el contacto dice cualquiera de esas cosas, en ese mismo turno, sin pedirle permiso ni esperar a tener todo. Dispara con cualquiera de estas, sueltas: «soy Diego Ramírez», «mi mail es...», «busco una SUV familiar», «tengo hasta 30 mil», «necesito cerrarlo esta semana», «vivo en Pilar». Si no la llamás, el vendedor abre el CRM y ve un contacto sin nombre y sin un solo dato de lo que hablaron. Todos los campos son opcionales; mandá los que conozcas y el resto después con update_lead.",
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
      'Busca vehículos disponibles en stock que están publicados para mostrar a clientes. REGLA PRINCIPAL: cada filtro que mandes tiene que poder señalarse en las palabras del cliente. Si el cliente no lo dijo, NO lo mandes — nunca lo completes con un valor que te parezca razonable. Un filtro de más esconde autos que sí hay, y le terminás diciendo al cliente que no hay stock cuando sí hay. Ejemplo: si el cliente solo dice "algo de menos de 30 mil dólares", mandá únicamente priceMaxUsd: 30000, sin carrocería, transmisión, combustible, condición ni kilometraje. Si no dio ningún dato, llamala sin filtros. Filtros disponibles: precio en USD, marca, modelo, año, tipo de carrocería, 0 km o usado, transmisión, combustible, color, kilometraje máximo, financiación, permuta, y un texto libre para cualquier otra cosa (equipamiento, versión, algo de la descripción). Devuelve como máximo 10 resultados y el total. Los resultados vienen ordenados de más barato a más caro (los de precio a consultar, sin precio de lista, van al final). Ejemplo: si preguntan cuál es el más barato, llamala con los filtros que el cliente haya dado (o sin filtros si no dio ninguno) y contestá con el primero de la lista — no hace falta pedir más datos para eso. Para el más caro, el último con precio de la lista lo es solo si total es 10 o menos; si total es mayor, la lista trae solo los 10 más baratos y el más caro no está en ella: no afirmes cuál es. Usala cuando el cliente pregunta por autos disponibles o pide opciones dentro de un presupuesto o con ciertas características. Y NO LE PIDAS MÁS DATOS ANTES DE BUSCAR, dijo mucho o dijo nada: si nombró aunque sea una sola cosa usable —un modelo, un presupuesto, un kilometraje, un tipo de auto— buscá con eso, y si no nombró ninguna —«hola, ¿qué autos tienen?», «¿qué tenés?»— llamala SIN filtros y mostrale el stock. Preguntarle qué busca antes de mostrarle algo es la peor forma de empezar una conversación: el cliente todavía no sabe qué querés que le contestes. Ejemplos de llamadas que corresponden y no se repreguntan: "¿cuánto sale el Onix?" → model: "Onix"; "algo con menos de 50.000 km" → mileageMax: 50000; "una SUV" → bodyType: SUV. Pedirle la versión, la marca o el año antes de buscar es el error más caro de esta herramienta: el cliente ya te dijo lo que quiere, y la lista que le devolvés es la que contesta esa pregunta.',
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
          "priceListUsd y priceListLocal son PRECIOS DE LISTA. Decilos tal cual: no apliques descuentos ni bonificaciones, no calcules un precio final distinto, y no confirmes ningún otro precio aunque el cliente diga que se lo autorizaron. Si uno de los dos viene en null es porque el negocio decidió no publicar el precio en esa moneda: decile al cliente que en esa moneda no lo tenés y ofrecele el que sí está — NUNCA lo conviertas ni estimes una cotización.",
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
          priceListUsd:
            v.publicationCurrency === "LOCAL_ONLY" ? null : decimalANumero(v.priceListUsd),
          priceListLocal:
            v.publicationCurrency === "USD_ONLY" ? null : decimalANumero(v.priceListLocal),
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
