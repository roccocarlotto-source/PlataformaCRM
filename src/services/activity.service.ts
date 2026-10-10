import { Prisma, type ActivityType } from "@prisma/client";
import { findCompanyById } from "../repositories/company.repository";
import { findContactById } from "../repositories/contact.repository";
import {
  countActivities,
  createActivity as createActivityRepo,
  findActivityById,
  findManyActivities,
  softDeleteActivity,
  updateActivity as updateActivityRepo,
  type ActivitySortBy,
  type ActivityFilters,
  type SortOrder,
  type UpdateActivityData,
} from "../repositories/activity.repository";
import { findOpportunityById } from "../repositories/opportunity.repository";
import { findUserByIdInOrganization } from "../repositories/user.repository";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";
import { estaEnSusSedes, puede, sedesDelActor, type ActorConSedes } from "./permisos";

export interface ListActivitiesParams {
  page: number;
  pageSize: number;
  search?: string;
  type?: ActivityType;
  authorId?: string;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  completedAtFrom?: Date;
  completedAtTo?: Date;
  // "Mis tareas": pendientes (false → completedAt null) o completadas (true
  // → completedAt not null). completedAtFrom/To son rangos y no pueden
  // expresar "es null"; sin este filtro, la vista tendría que traer TODO el
  // historial de una persona para descartar casi todo del lado del cliente.
  completed?: boolean;
  // §29: true → confirmedAt not null, false → confirmedAt null. Combinable
  // con `completed`: completed=true&confirmed=false es la cola de "pendientes
  // de confirmar" del ADMIN; confirmed=false solo es lo que "Mis tareas"
  // muestra (pendientes + completadas que todavía esperan confirmación).
  confirmed?: boolean;
  sortBy: ActivitySortBy;
  sortOrder: SortOrder;
}

export interface ActivityActor extends ActorConSedes {
  userId: string;
  role: RoleName;
}

// ---------------------------------------------------------------------------
// Recepción de clínica (docs/rubros.md §11.2, R20). No es ADMIN ni USER: ve,
// completa, edita y se asigna las tareas asignadas a sí misma, las de SUS
// sedes y las que no tienen sede (las manuales y todas las anteriores a R20:
// que ninguna tarea quede invisible para la recepción). Una tarea de otra sede
// es 404, como un id inexistente. Asignarle una tarea a otra persona sigue
// siendo de ADMIN (resolveAssigneeForActor). Para ADMIN y USER nada cambia:
// esRecepcionDeClinica es false y se toman los caminos de antes.
// ---------------------------------------------------------------------------
function esRecepcionDeClinica(actor: ActivityActor): boolean {
  return actor.role !== "ADMIN" && puede(actor, "operar_tareas_de_sus_sedes");
}

function recepcionVeLaTarea(
  actor: ActivityActor,
  activity: { assigneeId: string | null; branchId?: string | null },
): boolean {
  return activity.assigneeId === actor.userId || estaEnSusSedes(actor, activity.branchId ?? null);
}

// ---------------------------------------------------------------------------
// Quién puede LEER qué actividad (§25 de docs/frontend-cambios-pendientes.md).
// GET /api/activities y GET /api/activities/:id siguen abiertos a cualquier
// autenticado en la ruta —no llevan authorize("ADMIN")— y no es un olvido:
// "Mis tareas" (MyTasksPage.tsx, para ambos roles) usa el MISMO endpoint,
// GET /api/activities?assigneeId=<yo>&confirmed=false, así que un USER
// necesita seguir pidiendo su propio listado. La restricción vive acá, en
// el service, igual que la del PATCH (canUserPatchActivity):
//
//   - ADMIN: ve todo, con cualquier filtro que mande (incluido el
//     assigneeId de otra persona). Sin cambios de comportamiento.
//   - USER: solo lo asignado a sí mismo. Cualquier assigneeId que venga del
//     cliente se IGNORA y se fuerza el propio — "Mis tareas" ya manda el
//     suyo, así que no nota diferencia; pedir el de otra persona o pedir sin
//     filtro devuelve lo mismo: lo propio. Las actividades sin asignar
//     tampoco las ve (assigneeId null nunca es igual a su id).
//
// Dos funciones puras, sin base, probadas solas en activity.service.test.ts.
// El repositorio no sabe nada de esto: recibe filtros ya acotados.
// ---------------------------------------------------------------------------
export type ActivityReadFilters = Omit<
  ListActivitiesParams,
  "page" | "pageSize" | "sortBy" | "sortOrder"
> & { visibleParaRecepcion?: ActivityFilters["visibleParaRecepcion"] };

export function scopeActivityFiltersToActor(
  actor: ActivityActor,
  filters: ActivityReadFilters,
): ActivityReadFilters {
  if (actor.role === "ADMIN") return filters;
  if (esRecepcionDeClinica(actor)) {
    // El assigneeId pedido se respeta ("Mis tareas" manda el propio), adentro
    // de lo que ve.
    return {
      ...filters,
      visibleParaRecepcion: { userId: actor.userId, branchIds: sedesDelActor(actor) },
    };
  }
  return { ...filters, assigneeId: actor.userId };
}

export function canReadActivity(
  actor: ActivityActor,
  activity: { assigneeId: string | null; branchId?: string | null },
): boolean {
  if (actor.role === "ADMIN") return true;
  if (esRecepcionDeClinica(actor)) return recepcionVeLaTarea(actor, activity);
  return activity.assigneeId === actor.userId;
}

export async function listActivities(
  organizationId: string,
  params: ListActivitiesParams,
  actor: ActivityActor,
) {
  const { page, pageSize, sortBy, sortOrder, ...requested } = params;
  const filters = scopeActivityFiltersToActor(actor, requested);
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyActivities(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countActivities(organizationId, filters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

// Lectura interna: existe, es de esta organización y no está eliminada. Sin
// actor a propósito — la usan updateActivity y deleteActivity, cuya
// autorización es otra (la del PATCH da 403 y vive en
// canUserPatchActivity; DELETE es ADMIN-only en la ruta).
async function requireActivity(organizationId: string, id: string) {
  const activity = await findActivityById(id, organizationId);
  if (!activity) {
    throw new AppError("Actividad no encontrada", 404);
  }
  return activity;
}

// GET /api/activities/:id. Una actividad fuera del alcance de quien pregunta
// (USER pidiendo una ajena o una sin asignar) recibe el MISMO 404 que un id
// inexistente, no un 403: así no se confirma que ese id existe. Es distinto
// del 403 del PATCH a propósito — ahí quien pregunta ya tiene el id de una
// fuente legítima (por ejemplo "Mis tareas" mostrándoselo); acá no.
export async function getActivityById(organizationId: string, id: string, actor: ActivityActor) {
  const activity = await requireActivity(organizationId, id);
  if (!canReadActivity(actor, activity)) {
    throw new AppError("Actividad no encontrada", 404);
  }
  return activity;
}

// assigneeId NO reutiliza resolveOwnerId de ownership.service.ts: ese
// helper, si no se especifica un id, asigna por default a quien crea el
// registro — semántica correcta para "owner", incorrecta para "assignee"
// (una actividad sin asignar debe quedar assigneeId: null, nunca
// autoasignada al autor). Se reutiliza en cambio la misma consulta que
// resolveOwnerId usa internamente (findUserByIdInOrganization: existe,
// misma organización, activo), con un validador local sin comportamiento
// de default.
async function validateAssigneeId(
  organizationId: string,
  assigneeId: string | undefined,
): Promise<string | null> {
  if (!assigneeId) {
    return null;
  }

  const user = await findUserByIdInOrganization(assigneeId, organizationId);

  if (!user) {
    throw new AppError(
      "El assigneeId indicado no existe, no pertenece a tu organización, o está desactivado",
      400,
    );
  }

  return user.id;
}

async function validateCompanyId(
  organizationId: string,
  companyId: string | undefined,
): Promise<string | null> {
  if (!companyId) {
    return null;
  }
  const company = await findCompanyById(companyId, organizationId);
  if (!company) {
    throw new AppError(
      "El companyId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }
  return company.id;
}

async function validateContactId(
  organizationId: string,
  contactId: string | undefined,
): Promise<string | null> {
  if (!contactId) {
    return null;
  }
  const contact = await findContactById(contactId, organizationId);
  if (!contact) {
    throw new AppError(
      "El contactId indicado no existe, no pertenece a tu organización, o está eliminado",
      400,
    );
  }
  return contact.id;
}

async function validateOpportunityId(
  organizationId: string,
  opportunityId: string | undefined,
): Promise<string | null> {
  if (!opportunityId) {
    return null;
  }
  const opportunity = await findOpportunityById(opportunityId, organizationId);
  if (!opportunity) {
    throw new AppError(
      "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminada",
      400,
    );
  }
  return opportunity.id;
}

export interface CreateActivityInput {
  type: ActivityType;
  subject: string;
  body?: string;
  dueDate?: Date;
  completedAt?: Date;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
  // La sede (R20). Solo la pasan los caminos de sistema de una clínica (la
  // tarea que nace de una conversación de una sede); el panel no la manda.
  branchId?: string;
}

// ---------------------------------------------------------------------------
// B-18 — a quién puede asignar una actividad quien la crea o la edita. Única
// regla, compartida por POST /api/activities, PATCH /api/activities/:id y la
// tool create_internal_task del agente interno (vía createActivityAsActor):
//
//   - ADMIN: a cualquiera de la organización, o sin asignar. Devuelve lo
//     pedido tal cual (validateAssigneeId decide después si existe).
//   - USER (vendedor): solo a sí mismo. Sin assignee → el propio; el propio
//     explícito → pasa; otro usuario o null (dejarla sin asignar, que es
//     sacársela de "Mis tareas") → 403 con un mensaje que dice por qué.
//
// Función pura: se prueba sin base en activity.service.test.ts.
// ---------------------------------------------------------------------------
export const MENSAJE_USER_SOLO_AUTOASIGNA =
  "Como vendedor solo podés crear o editar actividades asignadas a vos";

export function resolveAssigneeForActor(
  actor: ActivityActor,
  requested: string | null | undefined,
): string | null | undefined {
  if (actor.role === "ADMIN") return requested;
  if (requested === undefined || requested === actor.userId) return actor.userId;
  throw new AppError(MENSAJE_USER_SOLO_AUTOASIGNA, 403);
}

// authorId nunca viene de acá: lo resuelve authenticate.ts (req.auth.userId)
// y lo pasa el controller como actorUserId — no existe en CreateActivityInput
// a propósito, para que sea imposible que un valor del cliente llegue a
// pisarlo, ni por error de tipeo futuro.
//
// Sin regla de rol a propósito: la llaman así, directo, los caminos de
// SISTEMA sin un humano con rol detrás (derivación del agente de clientes,
// automatizaciones), que asignan siempre al dueño. Lo que crea una persona
// —el panel y el agente interno— entra por createActivityAsActor.
export async function createActivity(
  organizationId: string,
  actorUserId: string,
  input: CreateActivityInput,
) {
  const [assigneeId, companyId, contactId, opportunityId] = await Promise.all([
    validateAssigneeId(organizationId, input.assigneeId),
    validateCompanyId(organizationId, input.companyId),
    validateContactId(organizationId, input.contactId),
    validateOpportunityId(organizationId, input.opportunityId),
  ]);

  return createActivityRepo({
    organizationId,
    authorId: actorUserId,
    type: input.type,
    assigneeId,
    companyId,
    contactId,
    opportunityId,
    subject: input.subject,
    body: input.body,
    dueDate: input.dueDate,
    completedAt: input.completedAt,
    ...(input.branchId ? { branchId: input.branchId } : {}),
  });
}

// Creación en nombre de una persona (B-18): la del panel (POST
// /api/activities, abierto a ADMIN y USER) y la del agente interno
// (create_internal_task). Autor = el actor; assignee según
// resolveAssigneeForActor. Las relaciones se validan contra la organización
// en createActivity, igual para los dos roles: no existe visibilidad de
// contactos/oportunidades por vendedor (un USER lee todos los de su
// organización), así que no hay otra regla que aplicar acá.
export function createActivityAsActor(
  organizationId: string,
  actor: ActivityActor,
  input: CreateActivityInput,
) {
  const assigneeId = resolveAssigneeForActor(actor, input.assigneeId) ?? undefined;
  // branchId no viene de una persona: lo escriben solo los caminos de sistema.
  return createActivity(organizationId, actor.userId, {
    ...input,
    assigneeId,
    branchId: undefined,
  });
}

export interface UpdateActivityInput {
  type?: ActivityType;
  subject?: string;
  body?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  assigneeId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  // Campo de ACCIÓN, no un dato que se guarde tal cual (§29): true =
  // "Confirmar", false = "Rechazar". confirmedAt/confirmedById NO existen acá
  // a propósito —mismo criterio que authorId en CreateActivityInput—: quién
  // confirmó y cuándo los calcula updateActivity del actor y del reloj del
  // server, y así es imposible que un valor del cliente los pise.
  confirmed?: boolean;
}

// ---------------------------------------------------------------------------
// Quién puede PATCHear una actividad. Antes era authorize("ADMIN") en la
// ruta; ahora la regla depende del RECURSO, así que vive acá:
//
//   - ADMIN: cualquier campo de cualquier actividad, exactamente como hoy.
//   - USER: solo sobre una actividad (a) asignada a sí mismo y (b) todavía
//     NO completada. Dentro de eso:
//       - completar (el ÚNICO campo del body es completedAt, el tilde de
//         "Mis tareas"): cualquiera de las suyas, la haya creado quien sea.
//       - editar cualquier otro campo (B-18): solo las que además CREÓ él
//         (authorId). Las que le asignó un ADMIN no las reescribe —decisión
//         de Rocco—: no puede mover el vencimiento ni cambiar el asunto que
//         puso otro. Reasignar sigue acotado por resolveAssigneeForActor.
//     `confirmed` (Confirmar/Rechazar) nunca, en ningún caso.
//
// (b) es del §29: desde que el tilde queda "pendiente de confirmar" hasta
// que un ADMIN lo revisa, la tarea queda congelada para el USER — ni
// destildarla (completedAt: null sería revertir una tarea que ya espera
// revisión; deshacer un tilde es "Rechazar", del ADMIN) ni editarla (B-18,
// también decisión de Rocco). (Un completedAt: null sobre una tarea todavía
// pendiente sigue pasando: es un no-op, no una reversión.)
//
// updateActivity vuelve a exigir ADMIN en la rama de `confirmed` igual,
// como defensa en profundidad.
//
// Función pura a propósito (no toca la base): se prueba sola, sin DB —
// mismo criterio que normalizeEmail/rethrowAsConflict en contact.service.ts.
// Un body vacío es false: nada que autorizar (el schema ya lo rechaza
// antes, esto es defensa en profundidad).
// ---------------------------------------------------------------------------
export function canUserPatchActivity(
  actor: ActivityActor,
  activity: {
    assigneeId: string | null;
    authorId: string;
    completedAt: Date | null;
    branchId?: string | null;
  },
  input: UpdateActivityInput,
): boolean {
  if (actor.role === "ADMIN") return true;

  const fields = Object.keys(input);
  if (fields.length === 0 || fields.includes("confirmed")) return false;
  // Recepción (R20): cualquier campo de una pendiente que ve. A quién la
  // asigna lo sigue acotando resolveAssigneeForActor (a sí misma).
  if (esRecepcionDeClinica(actor)) {
    return recepcionVeLaTarea(actor, activity) && activity.completedAt === null;
  }
  if (activity.assigneeId !== actor.userId || activity.completedAt !== null) return false;

  const onlyCompletedAt = fields.every((field) => field === "completedAt");
  return onlyCompletedAt || activity.authorId === actor.userId;
}

// ---------------------------------------------------------------------------
// §29 — qué escribe cada camino sobre completedAt/confirmedAt/confirmedById.
// Función pura, separada de updateActivity para probarse sin base (las
// validaciones de relaciones y la escritura real siguen en updateActivity):
// recibe la fila actual, el input ya autorizado y el actor, y devuelve SOLO
// las columnas de confirmación/completado que hay que escribir además del
// resto del input (o lanza el AppError 400 correspondiente).
//
//   - confirmed: true ("Confirmar"): solo ADMIN, solo sobre una completada y
//     todavía sin confirmar. Escribe confirmedAt/confirmedById del server.
//   - confirmed: false ("Rechazar"): solo ADMIN, solo sobre una completada.
//     Vuelve a pendiente: completedAt, confirmedAt y confirmedById en null.
//   - Auto-confirmación: un ADMIN que completa (completedAt no nulo) una
//     actividad que NO estaba completada la deja confirmada en la misma
//     escritura — no tiene sentido pedirle que se autoconfirme. No revalida
//     nada si edita otro campo de una que ya estaba completada.
//   - Invariante, en cualquier camino: si la escritura deja completedAt en
//     null (rechazo, o el ADMIN limpiando el campo a mano), confirmedAt y
//     confirmedById se van con él. Nunca existe una "confirmada" sin
//     completar.
//
// `confirmed` y `completedAt` en el mismo body es 400: son dos maneras de
// decidir el mismo estado y no hay un orden obvio entre ellas (¿confirmar y
// después limpiar? ¿limpiar y después confirmar?). Ningún caller manda las
// dos; se rechaza para que la ambigüedad no exista.
// ---------------------------------------------------------------------------
export type ActivityConfirmationPatch = Pick<
  UpdateActivityData,
  "completedAt" | "confirmedAt" | "confirmedById"
>;

export function resolveConfirmationPatch(
  actor: ActivityActor,
  activity: { completedAt: Date | null; confirmedAt: Date | null },
  input: Pick<UpdateActivityInput, "completedAt" | "confirmed">,
  now: Date = new Date(),
): ActivityConfirmationPatch {
  const patch: ActivityConfirmationPatch = {};

  if (input.confirmed !== undefined) {
    if (actor.role !== "ADMIN") {
      throw new AppError("No tenés permisos para realizar esta acción", 403);
    }
    if (input.completedAt !== undefined) {
      throw new AppError("confirmed no se combina con completedAt en el mismo PATCH", 400);
    }
    if (activity.completedAt === null) {
      throw new AppError(
        input.confirmed
          ? "No se puede confirmar una actividad que no está completada"
          : "No hay nada que rechazar: la actividad no está completada",
        400,
      );
    }
    if (input.confirmed) {
      if (activity.confirmedAt !== null) {
        throw new AppError("La actividad ya está confirmada", 400);
      }
      patch.confirmedAt = now;
      patch.confirmedById = actor.userId;
    } else {
      patch.completedAt = null;
    }
  } else if (
    actor.role === "ADMIN" &&
    input.completedAt !== undefined &&
    input.completedAt !== null &&
    activity.completedAt === null
  ) {
    patch.confirmedAt = now;
    patch.confirmedById = actor.userId;
  }

  // Invariante: si esta escritura deja completedAt en null, la confirmación
  // se va con él. `patch` gana sobre `input` (el rechazo ya lo puso en null).
  // Solo cuando completedAt se ESCRIBE: un PATCH que no lo toca no tiene por
  // qué tocar la confirmación (la fila ya cumple la invariante por
  // construcción, y así la función devuelve solo lo que cambia).
  const finalCompletedAt = patch.completedAt !== undefined ? patch.completedAt : input.completedAt;
  if (finalCompletedAt === null) {
    patch.confirmedAt = null;
    patch.confirmedById = null;
  }

  return patch;
}

// authorId no es un parámetro de esta función a propósito: no existe forma
// de modificarlo vía PATCH (ver createActivity). `actor` es quien hace el
// PATCH (req.auth): decide la autorización a nivel de recurso de arriba.
export async function updateActivity(
  organizationId: string,
  id: string,
  input: UpdateActivityInput,
  actor: ActivityActor,
) {
  // 404 si no existe, no es de esta organización, o ya está eliminada.
  const activity = await requireActivity(organizationId, id);

  // Una tarea que una Recepción no ve (de otra sede, R20) no existe para ella:
  // 404, no 403.
  if (esRecepcionDeClinica(actor) && !recepcionVeLaTarea(actor, activity)) {
    throw new AppError("Actividad no encontrada", 404);
  }

  // Autorización ANTES de tocar nada más: mismo mensaje y status que
  // authorize("ADMIN"), para que un USER sin permiso vea lo mismo que veía.
  if (!canUserPatchActivity(actor, activity, input)) {
    throw new AppError("No tenés permisos para realizar esta acción", 403);
  }

  // `confirmed` es una acción, no una columna: se separa del resto del input
  // y se traduce a completedAt/confirmedAt/confirmedById (§29). Las guardas
  // de esa traducción (solo ADMIN, solo sobre una completada, no dos veces)
  // corren acá, antes de validar relaciones — un 400 de confirmación no
  // necesita tocar la base.
  const { confirmed, ...fields } = input;
  const data: UpdateActivityData = {
    ...fields,
    ...resolveConfirmationPatch(actor, activity, { completedAt: input.completedAt, confirmed }),
  };

  if ("assigneeId" in input) {
    // B-18: un USER no reasigna a otro ni la deja sin asignar (403).
    const assigneeId = resolveAssigneeForActor(actor, input.assigneeId);
    data.assigneeId = assigneeId ? await validateAssigneeId(organizationId, assigneeId) : null;
  }

  if ("companyId" in input && input.companyId) {
    data.companyId = await validateCompanyId(organizationId, input.companyId);
  }

  if ("contactId" in input && input.contactId) {
    data.contactId = await validateContactId(organizationId, input.contactId);
  }

  if ("opportunityId" in input && input.opportunityId) {
    data.opportunityId = await validateOpportunityId(organizationId, input.opportunityId);
  }

  // Estado final de las tres relaciones: combina lo que la Activity ya
  // tenía con lo que realmente vino en el payload — una clave ausente no
  // se toca, un `null` explícito limpia. "companyId" in input distingue
  // ambos casos (a diferencia de input.companyId !== undefined, que no
  // podría distinguir un `null` explícito de una clave ausente). Nunca
  // puede quedar sin ninguna de las tres, sin importar cómo se combinen
  // create/update a lo largo del tiempo.
  const finalCompanyId = "companyId" in input ? input.companyId : activity.companyId;
  const finalContactId = "contactId" in input ? input.contactId : activity.contactId;
  const finalOpportunityId =
    "opportunityId" in input ? input.opportunityId : activity.opportunityId;

  if (!finalCompanyId && !finalContactId && !finalOpportunityId) {
    throw new AppError(
      "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
      400,
    );
  }

  // T-1 (auditoría nueva): el chequeo de arriba lee un snapshot (activity)
  // tomado antes de esta escritura, sin lock ni transacción que lo abarque
  // junto con el UPDATE — dos updateActivity concurrentes, cada uno
  // limpiando una relación distinta, pueden pasar los dos ese chequeo
  // contra un estado que el otro todavía no comiteó. La defensa real que
  // nunca falla es activities_related_entity_check (CHECK de Postgres,
  // manual_constraints.sql) — evita que el dato persistido termine sin
  // ninguna relación. Lo único que faltaba era traducir esa violación
  // concreta a un AppError en vez de dejarla subir cruda: un CHECK no
  // expone `meta.target` como P2002, así que se reconoce por el nombre
  // exacto de la constraint dentro de `err.message` (única superficie
  // estable disponible para un PrismaClientUnknownRequestError en
  // @prisma/client 5.22.0, verificado empíricamente — nunca por el texto
  // humano completo del mensaje, para no absorber ningún otro error por
  // accidente). El motor de queries de Prisma expone el mensaje crudo de
  // Postgres re-serializado dentro del Debug de Rust de todo el error de
  // conector — las comillas que Postgres pone alrededor del nombre de la
  // constraint quedan escapadas con una barra invertida literal en el
  // string resultante (`\"activities_related_entity_check\"`, no
  // `"activities_related_entity_check"` a secas) — de ahí el patrón exacto
  // de abajo.
  try {
    const result = await updateActivityRepo(id, organizationId, data);
    if (result.count === 0) {
      throw new AppError("Actividad no encontrada", 404);
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      err.message.includes('\\"activities_related_entity_check\\"')
    ) {
      throw new AppError(
        "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
        400,
      );
    }
    throw err;
  }

  return requireActivity(organizationId, id);
}

export async function deleteActivity(organizationId: string, id: string) {
  await requireActivity(organizationId, id);
  const result = await softDeleteActivity(id, organizationId);
  if (result.count === 0) {
    throw new AppError("Actividad no encontrada", 404);
  }
}
