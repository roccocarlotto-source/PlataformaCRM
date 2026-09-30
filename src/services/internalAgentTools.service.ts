import { z } from "zod";
import { findManyBranches } from "../repositories/branch.repository";
import { findContactsMatchingAllWords } from "../repositories/contact.repository";
import { findEtiquetasDeAgenda } from "../repositories/internalAgent.repository";
import { findOrganizationById } from "../repositories/organization.repository";
import { findOpportunitiesMatchingAllWords } from "../repositories/opportunity.repository";
import { isoEnZona } from "../utils/timezone";
import type { RoleName } from "../types/auth";
import { createActivityAsActor } from "./activity.service";
import {
  conErroresDeNegocio,
  exito,
  fallo,
  instanteIso,
  normalizarNombre,
  textoOpcional,
  vacioComoAusente,
  validarArgs,
  type ResultadoDeTool,
} from "./agentTools.service";
import { MAX_DIAS_DE_RANGO } from "./availability.service";
import { listBookings } from "./booking.service";
import type { LlmToolDefinition } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Catálogo de tools del agente de IA INTERNO (ítem 179 de
// docs/frontend-cambios-pendientes.md). Es un catálogo SEPARADO del
// CATALOGO_DE_TOOLS de agentTools.service.ts, a propósito: aquellas tools
// hablan con un cliente y reciben el Contact de la conversación como
// contexto; estas las usa un empleado sobre su propio negocio, y no hay
// ninguna conversación ni ningún contacto implícito.
//
// Lo que SÍ se comparte con agentTools.service.ts es la mecánica, no el
// catálogo: validarArgs (Zod sobre los argumentos del modelo), los errores de
// negocio como resultados (conErroresDeNegocio) y los helpers de argumentos
// opcionales vacíos. Mismas reglas, por las mismas razones que están
// documentadas allá.
//
// Primera versión con dos tools. Se amplía después, mismo criterio que el
// catálogo de automatizaciones: no se anticipa el catálogo final.
// ---------------------------------------------------------------------------

// Deliberadamente SIN conversation: del otro lado no hay un cliente.
export interface ContextoDeEjecucionDeToolInterna {
  organizationId: string;
  // Quien escribió el mensaje: es el autor de lo que la tool cree.
  userId: string;
  // Su rol (req.auth.role): las tools que escriben aplican las MISMAS reglas
  // por rol que el panel (B-18: createActivityAsActor).
  role: RoleName;
}

export interface ToolInterna {
  definition: LlmToolDefinition;
  ejecutar(
    args: Record<string, unknown>,
    contexto: ContextoDeEjecucionDeToolInterna,
  ): Promise<ResultadoDeTool>;
}

// El equivalente de SUFIJO_ERROR_DE_ARGUMENTOS para este agente: el de
// agentTools.service.ts habla de "el cliente", y acá del otro lado hay un
// empleado. La idea es la misma — que el modelo corrija la llamada en vez de
// traducir el error a un hecho sobre el negocio.
export const SUFIJO_ERROR_DE_ARGUMENTOS_INTERNO =
  " — Este es un error TUYO al armar la llamada, no una respuesta del sistema. Corregí los argumentos y volvé a llamarla; no le digas a la persona que algo no existe o no se pudo hacer por esto.";

function validarArgsInternos<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, args: unknown) {
  return validarArgs(schema, args, SUFIJO_ERROR_DE_ARGUMENTOS_INTERNO);
}

// Tope de candidatos que se leen al resolver por texto. Alcanza para decidir
// "uno", "ninguno" o "varios" y para nombrar algunos en el error; más no le
// sirve a nadie en un chat.
const MAX_CANDIDATOS = 5;

function palabrasDe(texto: string): string[] {
  return texto
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
}

function nombreDeContacto(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

// Entre varios candidatos, uno cuyo nombre sea EXACTAMENTE lo que escribió la
// persona (sin acentos ni mayúsculas) gana: "Ana López" no es ambiguo porque
// además exista "Ana López Martínez".
function unicoExacto<T>(candidatos: T[], nombre: (c: T) => string, texto: string): T | undefined {
  const buscado = normalizarNombre(texto);
  const exactos = candidatos.filter((c) => normalizarNombre(nombre(c)) === buscado);
  return exactos.length === 1 ? exactos[0] : undefined;
}

function listaDeNombres(nombres: string[]): string {
  return nombres.map((n) => `"${n}"`).join(", ");
}

// ---------------------------------------------------------------------------
// Resolución por texto, DESACOPLADA de cualquier conversación. resolverOportunidad
// de agentTools.service.ts no sirve acá: está atado al contactId de la
// conversación con el cliente. Este resuelve contra toda la organización.
// ---------------------------------------------------------------------------

type Resolucion<T> = { ok: true; valor: T } | { ok: false; resultado: ResultadoDeTool };

export async function resolverContactoPorTexto(
  texto: string,
  organizationId: string,
): Promise<Resolucion<{ id: string; nombre: string }>> {
  const candidatos = await findContactsMatchingAllWords(
    organizationId,
    palabrasDe(texto),
    MAX_CANDIDATOS,
  );
  const elegido =
    candidatos.length === 1 ? candidatos[0] : unicoExacto(candidatos, nombreDeContacto, texto);
  if (elegido) {
    return { ok: true, valor: { id: elegido.id, nombre: nombreDeContacto(elegido) } };
  }
  if (candidatos.length === 0) {
    return {
      ok: false,
      resultado: fallo(
        `No encontré ningún contacto que coincida con "${texto}". Pedile a la persona que sea más específica (nombre y apellido, o el email del contacto).`,
      ),
    };
  }
  return {
    ok: false,
    resultado: fallo(
      `"${texto}" coincide con más de un contacto: ${listaDeNombres(candidatos.map(nombreDeContacto))}. Preguntale a la persona cuál es y volvé a intentarlo con el nombre completo.`,
    ),
  };
}

export async function resolverOportunidadPorTexto(
  texto: string,
  organizationId: string,
  contactId: string | undefined,
): Promise<Resolucion<{ id: string; titulo: string; contactId: string | null }>> {
  const candidatos = await findOpportunitiesMatchingAllWords(
    organizationId,
    palabrasDe(texto),
    { contactId },
    MAX_CANDIDATOS,
  );
  const elegida =
    candidatos.length === 1 ? candidatos[0] : unicoExacto(candidatos, (o) => o.title, texto);
  if (elegida) {
    return {
      ok: true,
      valor: { id: elegida.id, titulo: elegida.title, contactId: elegida.contactId },
    };
  }
  if (candidatos.length === 0) {
    return {
      ok: false,
      resultado: fallo(
        `No encontré ninguna oportunidad${contactId ? " de ese contacto" : ""} cuyo título coincida con "${texto}". Pedile a la persona que sea más específica, o creá la tarea ligada solo al contacto.`,
      ),
    };
  }
  return {
    ok: false,
    resultado: fallo(
      `"${texto}" coincide con más de una oportunidad: ${listaDeNombres(candidatos.map((o) => o.title))}. Preguntale a la persona cuál es y volvé a intentarlo con el título completo.`,
    ),
  };
}

async function zonaDeLaOrganizacion(organizationId: string): Promise<string> {
  const organizacion = await findOrganizationById(organizationId);
  return organizacion?.timezone ?? "UTC";
}

// ---------------------------------------------------------------------------
// create_internal_task
//
// Crea una Activity de tipo TASK con el MISMO createActivityAsActor que usa
// POST /api/activities (B-18): autor = quien escribió el mensaje, y también
// asignada a esa persona, para que la vea en sus tareas (una tarea que pidió
// para sí misma y no aparece en ningún lado no le sirve). La regla de a quién
// puede asignar cada rol es la del panel, no una copia: un USER solo a sí
// mismo, que es justo lo que esta tool pide.
//
// Activity exige por CHECK de base un companyId, contactId u opportunityId: no
// hay tareas sueltas, y está bien — es un CRM, no una lista de pendientes.
// Así que sin contacto ni oportunidad resolubles, la tool devuelve un error
// legible pidiendo precisión, nunca llega a la base.
// ---------------------------------------------------------------------------

export const MENSAJE_TAREA_SIN_VINCULO =
  "Para crear una tarea hace falta ligarla a un contacto o a una oportunidad existente, y no vino ninguno de los dos. Preguntale a la persona para quién o sobre qué es la tarea.";

const createInternalTaskArgs = z.object({
  asunto: z.string().trim().min(1, "asunto es requerido").max(255),
  contacto: textoOpcional(200),
  oportunidad: textoOpcional(255),
  fechaLimite: vacioComoAusente(instanteIso),
  descripcion: textoOpcional(5000),
});

const createInternalTaskTool: ToolInterna = {
  definition: {
    name: "create_internal_task",
    description:
      "Crea una tarea en el CRM, ligada a un contacto y/o a una oportunidad que YA existen, y asignada a la persona que te la pide. Mandá `contacto` (nombre y apellido o email) u `oportunidad` (su título), o los dos; con los dos, la oportunidad se busca entre las de ese contacto. Si la persona no dijo a quién o a qué va ligada, preguntale antes de llamarla. Si dijo una fecha límite, mandala en `fechaLimite`.",
    parameters: {
      type: "object",
      properties: {
        asunto: {
          type: "string",
          description: 'Qué hay que hacer, corto (ej. "Llamar para confirmar la seña").',
        },
        contacto: {
          type: "string",
          description: "Nombre y apellido, o email, del contacto al que se liga la tarea.",
        },
        oportunidad: {
          type: "string",
          description: "Título de la oportunidad a la que se liga la tarea.",
        },
        fechaLimite: {
          type: "string",
          description:
            "Fecha límite, ISO 8601 con el offset de la referencia temporal (ej. 2026-10-02T09:00:00-03:00). Si la persona dijo un día sin hora, usá las 09:00.",
        },
        descripcion: {
          type: "string",
          description: "Detalle opcional de la tarea.",
        },
      },
      required: ["asunto"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgsInternos(createInternalTaskArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const params = validacion.value;

    // No es un error de argumentos: es información que el modelo no tiene y
    // tiene que pedirle a la persona.
    if (params.contacto === undefined && params.oportunidad === undefined) {
      return Promise.resolve(fallo(MENSAJE_TAREA_SIN_VINCULO));
    }

    return conErroresDeNegocio(async () => {
      let contacto: { id: string; nombre: string } | undefined;
      if (params.contacto !== undefined) {
        const resuelto = await resolverContactoPorTexto(params.contacto, contexto.organizationId);
        if (!resuelto.ok) {
          return resuelto.resultado;
        }
        contacto = resuelto.valor;
      }

      let oportunidad: { id: string; titulo: string } | undefined;
      if (params.oportunidad !== undefined) {
        const resuelta = await resolverOportunidadPorTexto(
          params.oportunidad,
          contexto.organizationId,
          contacto?.id,
        );
        if (!resuelta.ok) {
          return resuelta.resultado;
        }
        oportunidad = resuelta.valor;
      }

      const actor = { userId: contexto.userId, role: contexto.role };
      const activity = await createActivityAsActor(contexto.organizationId, actor, {
        type: "TASK",
        subject: params.asunto,
        body: params.descripcion,
        dueDate: params.fechaLimite,
        assigneeId: contexto.userId,
        contactId: contacto?.id,
        opportunityId: oportunidad?.id,
      });

      const zona = await zonaDeLaOrganizacion(contexto.organizationId);
      return exito({
        activityId: activity.id,
        asunto: activity.subject,
        contacto: contacto?.nombre ?? null,
        oportunidad: oportunidad?.titulo ?? null,
        fechaLimite: activity.dueDate ? isoEnZona(activity.dueDate, zona) : null,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// get_agenda
//
// Envuelve listBookings (el mismo listado que la vista de agenda del panel) y
// devuelve un resumen legible: fecha, hora, contacto, servicio, sucursal y
// estado — nada de ids ni campos internos que en un chat no le sirven a nadie.
// La hora va en la zona de la sucursal de cada turno (ítem 104): es la hora a
// la que el cliente se presenta.
// ---------------------------------------------------------------------------

// Mismo default que get_availability: sin `hasta`, las 24 horas siguientes.
const VENTANA_POR_DEFECTO_MS = 24 * 60 * 60 * 1000;
export const MAX_TURNOS_EN_AGENDA = 50;

const getAgendaArgs = z
  .object({
    desde: instanteIso,
    hasta: vacioComoAusente(instanteIso),
    sucursal: textoOpcional(255),
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

// Las sucursales de una organización son pocas: se leen todas y se compara
// en memoria, sin acentos, cada palabra contra el nombre.
const MAX_SUCURSALES = 100;

async function resolverSucursalPorTexto(
  texto: string,
  organizationId: string,
): Promise<Resolucion<{ id: string; nombre: string }>> {
  const sucursales = await findManyBranches(
    organizationId,
    {},
    { skip: 0, take: MAX_SUCURSALES },
    { sortBy: "name", sortOrder: "asc" },
  );
  const palabras = palabrasDe(normalizarNombre(texto));
  const candidatas = sucursales.filter((b) => {
    const nombre = normalizarNombre(b.name);
    return palabras.every((p) => nombre.includes(p));
  });
  const elegida =
    candidatas.length === 1 ? candidatas[0] : unicoExacto(candidatas, (b) => b.name, texto);
  if (elegida) {
    return { ok: true, valor: { id: elegida.id, nombre: elegida.name } };
  }
  const todas = listaDeNombres(sucursales.map((b) => b.name));
  return {
    ok: false,
    resultado: fallo(
      candidatas.length === 0
        ? `No hay ninguna sucursal que coincida con "${texto}". Las sucursales son: ${todas}.`
        : `"${texto}" coincide con más de una sucursal: ${listaDeNombres(candidatas.map((b) => b.name))}. Preguntale a la persona cuál es.`,
    ),
  };
}

const getAgendaTool: ToolInterna = {
  definition: {
    name: "get_agenda",
    description: `Lista los turnos agendados de la organización en un rango de fechas, opcionalmente de una sola sucursal. Devuelve fecha, hora (en la zona de cada sucursal), contacto, servicio, sucursal y estado de cada turno. Sin \`hasta\` se miran las 24 horas siguientes a \`desde\`; el rango máximo es de ${MAX_DIAS_DE_RANGO} días. Si la agenda viene vacía, decilo tal cual: no inventes turnos.`,
    parameters: {
      type: "object",
      properties: {
        desde: {
          type: "string",
          description:
            'Inicio del rango, ISO 8601 con el offset de la referencia temporal. Para "hoy", el comienzo del día de hoy.',
        },
        hasta: {
          type: "string",
          description:
            "Fin del rango, ISO 8601 con offset. OPCIONAL: sin él, las 24 horas siguientes a desde.",
        },
        sucursal: {
          type: "string",
          description: "Nombre de la sucursal, si la persona pidió la agenda de una sola.",
        },
      },
      required: ["desde"],
      additionalProperties: false,
    },
  },

  ejecutar(args, contexto) {
    const validacion = validarArgsInternos(getAgendaArgs, args);
    if (!validacion.ok) {
      return Promise.resolve(validacion.resultado);
    }
    const params = validacion.value;

    return conErroresDeNegocio(async () => {
      let sucursal: { id: string; nombre: string } | undefined;
      if (params.sucursal !== undefined) {
        const resuelta = await resolverSucursalPorTexto(params.sucursal, contexto.organizationId);
        if (!resuelta.ok) {
          return resuelta.resultado;
        }
        sucursal = resuelta.valor;
      }

      const { data: turnos, pagination } = await listBookings(contexto.organizationId, {
        page: 1,
        pageSize: MAX_TURNOS_EN_AGENDA,
        sortBy: "startsAt",
        sortOrder: "asc",
        filters: { branchId: sucursal?.id, desde: params.desde, hasta: params.hasta },
      });

      if (turnos.length === 0) {
        return exito({
          turnos: [],
          sinResultados: true,
          queHacer: `No hay ningún turno agendado en ese rango${sucursal ? ` en ${sucursal.nombre}` : ""}. Decíselo así a la persona: no inventes turnos.`,
        });
      }

      const etiquetas = await findEtiquetasDeAgenda(contexto.organizationId, {
        contactIds: [...new Set(turnos.map((t) => t.contactId))],
        serviceTypeIds: [...new Set(turnos.map((t) => t.serviceTypeId))],
        branchIds: [...new Set(turnos.map((t) => t.branchId))],
      });
      const contactos = new Map(etiquetas.contactos.map((c) => [c.id, nombreDeContacto(c)]));
      const servicios = new Map(etiquetas.servicios.map((s) => [s.id, s.name]));
      const sucursales = new Map(etiquetas.sucursales.map((b) => [b.id, b]));

      return exito({
        total: pagination.total,
        // Más turnos que los que entran en la respuesta: el modelo tiene que
        // saber que la lista está cortada para no darla por completa.
        hayMas: pagination.total > turnos.length,
        turnos: turnos.map((t) => {
          const branch = sucursales.get(t.branchId);
          const inicio = isoEnZona(t.startsAt, branch?.timezone ?? "UTC");
          return {
            fecha: inicio.slice(0, 10),
            hora: inicio.slice(11, 16),
            contacto: contactos.get(t.contactId) ?? null,
            servicio: servicios.get(t.serviceTypeId) ?? null,
            sucursal: branch?.name ?? null,
            estado: t.status,
          };
        }),
      });
    });
  },
};

// ---------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------

export const CATALOGO_DE_TOOLS_INTERNAS: ReadonlyMap<string, ToolInterna> = new Map(
  [createInternalTaskTool, getAgendaTool].map((tool) => [tool.definition.name, tool]),
);

// Mismo patrón que toolsHabilitadas: la intersección entre lo que el agente
// tiene habilitado y lo que existe en ESTE catálogo. Un nombre del catálogo de
// los agentes de cliente no existe acá, y no se ofrece.
export function toolsHabilitadasInternas(enabledTools: string[]): ToolInterna[] {
  const resultado: ToolInterna[] = [];
  for (const nombre of enabledTools) {
    const tool = CATALOGO_DE_TOOLS_INTERNAS.get(nombre);
    if (tool) {
      resultado.push(tool);
    }
  }
  return resultado;
}
