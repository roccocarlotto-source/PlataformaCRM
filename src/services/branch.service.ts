import type { OrganizationIndustry } from "@prisma/client";
import { crearConfiguracionDeSede } from "../clinicas/repositories/clinicSettings.repository";
import { prisma, type Db } from "../lib/prisma";
import { countAgentsByBranch } from "../repositories/agent.repository";
import { countConfirmedBookingsOf } from "../repositories/booking.repository";
import {
  countBranches,
  createBranch as createBranchRepo,
  findBranchById,
  findManyBranches,
  lockBranchForUpdate,
  softDeleteBranch,
  updateBranch as updateBranchRepo,
  type BranchSortBy,
  type SortOrder,
} from "../repositories/branch.repository";
import { countOpenConversationsOf } from "../repositories/conversation.repository";
import { countConnectionsWithSecretByBranch } from "../repositories/googleCalendarConnection.repository";
import { countKnowledgeBaseEntriesByBranch } from "../repositories/knowledgeBaseEntry.repository";
import {
  findOrganizationById,
  updateOrganizationSettings,
} from "../repositories/organization.repository";
import { countActiveQrCodesByBranch } from "../repositories/qrCode.repository";
import { countActiveResourcesByBranch } from "../repositories/resource.repository";
import { countActiveServiceTypesByBranch } from "../repositories/serviceType.repository";
import { countVehiclesInStockByBranch } from "../repositories/vehicle.repository";
import { AppError } from "../utils/AppError";
import { validarUsuarioAsignable } from "./ownership.service";

// ---------------------------------------------------------------------------
// Branch (sucursal) — P2.1.
//
// SIN INVARIANTE DE "AL MENOS UNA SUCURSAL ACTIVA", a diferencia de Pipeline.
// Una organización que no usa Booking tiene cero Branch y ese es un estado
// válido: nada del CRM depende de que exista una. Por eso deleteBranch no
// necesita el lock de organización que H-1 le impuso a deletePipeline — el
// único invariante acá es sobre los hijos de ESTA sucursal, y se protege con el
// lock de su propia fila.
// ---------------------------------------------------------------------------

export interface ListBranchesParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: BranchSortBy;
  sortOrder: SortOrder;
}

export async function listBranches(organizationId: string, params: ListBranchesParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyBranches(organizationId, filters, { skip, take: pageSize }, { sortBy, sortOrder }),
    countBranches(organizationId, filters),
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

export async function getBranchById(organizationId: string, id: string) {
  const branch = await findBranchById(id, organizationId);
  if (!branch) {
    throw new AppError("Sucursal no encontrada", 404);
  }
  return branch;
}

export interface CreateBranchInput {
  name: string;
  timezone: string;
  // Vendedor por defecto de la sucursal (ítem 69). OPCIONAL de verdad: no
  // mandarlo —o mandarlo en null— deja la sucursal sin ninguno, que es un
  // estado válido y el que tienen todas las sucursales existentes.
  defaultOwnerId?: string | null;
  // Datos de cobro (ítem 74), independientes y opcionales. Texto plano, se
  // guardan tal cual vienen del controller: no hay relación que validar.
  paymentLinkUrl?: string | null;
  bankTransferDetails?: string | null;
}

// industry: el rubro de la organización (req.auth.industry). Una sede de una
// clínica nace con su configuración (ClinicBranchSettings, docs/rubros.md
// §1.3) en la misma transacción. Default AUTOMOTORA: los demás callers (tests,
// scripts) crean sucursales de automotoras, como siempre.
export async function createBranch(
  organizationId: string,
  input: CreateBranchInput,
  industry: OrganizationIndustry = "AUTOMOTORA",
) {
  // Sin unicidad de nombre: dos sucursales pueden llamarse igual ("Centro" en
  // dos ciudades). No hay ninguna constraint que traducir a 409, así que no hay
  // rethrowAsConflict que escribir — a diferencia de Pipeline, que sí tiene un
  // único (organizationId, name).
  const defaultOwnerId = await resolverDefaultOwnerId(organizationId, input.defaultOwnerId);
  return prisma.$transaction(async (tx) => {
    const otrasSucursales = await countBranches(organizationId, {}, tx);
    const branch = await createBranchRepo(
      {
        organizationId,
        name: input.name,
        timezone: input.timezone,
        defaultOwnerId,
        paymentLinkUrl: input.paymentLinkUrl,
        bankTransferDetails: input.bankTransferDetails,
      },
      tx,
    );
    await heredarZonaDeLaPrimeraSucursal(organizationId, otrasSucursales, branch.timezone, tx);
    if (industry === "CLINICA") {
      await crearConfiguracionDeSede(organizationId, branch.id, tx);
    }
    return branch;
  });
}

// La zona de una organización recién creada es el default de la columna,
// "UTC": ni el onboarding ni el alta por platform admin la eligen, y ahí todavía
// no se sabe dónde opera. La primera sucursal SÍ la trae, obligatoria y elegida
// a mano (createBranchSchema). Si la organización sigue en UTC al crear su
// primera sucursal activa, hereda esa zona: es la mejor señal de "dónde opera" y
// es la que usan el dashboard y la fecha de cierre (T-01).
//
// Solo la PRIMERA (ninguna otra activa): una organización que ya tiene
// sucursales y sigue en UTC no cambia sola al sumar otra. Esas se corrigen a
// mano desde Configuración → Organización. Límite conocido: no se distingue
// "UTC por default" de "UTC elegido a propósito" (no hay columna para eso). Una
// organización que haya elegido UTC a mano antes de tener sucursales lo pierde
// con la primera. Se vuelve a elegir desde la misma pantalla.
async function heredarZonaDeLaPrimeraSucursal(
  organizationId: string,
  otrasSucursales: number,
  zonaDeLaSucursal: string,
  tx: Db,
): Promise<void> {
  if (otrasSucursales > 0 || zonaDeLaSucursal === "UTC") return;
  const organization = await findOrganizationById(organizationId, tx);
  if (organization?.timezone !== "UTC") return;
  await updateOrganizationSettings(organizationId, { timezone: zonaDeLaSucursal }, tx);
}

// El vendedor por defecto, validado antes de guardarse. NO se reutiliza
// resolveOwnerId (ownership.service.ts): aquella función significa "si no viene
// nada, asignale al actor", y acá "no viene nada" significa literalmente "sin
// vendedor por defecto" — no hay ningún actor al que caer. Lo que sí se comparte
// es la mitad que importa, validarUsuarioAsignable: el vendedor tiene que
// existir, ser de esta organización y estar activo, o es un 400 con el nombre
// del campo adentro.
//
// undefined y null NO son lo mismo, mismo criterio que
// UpdateContactInput.companyId (M-10): undefined devuelve undefined y Prisma no
// toca la columna; null la pone en NULL, que es como se desvincula desde el
// PATCH.
async function resolverDefaultOwnerId(
  organizationId: string,
  defaultOwnerId: string | null | undefined,
): Promise<string | null | undefined> {
  if (defaultOwnerId === undefined || defaultOwnerId === null) {
    return defaultOwnerId;
  }
  return validarUsuarioAsignable(organizationId, defaultOwnerId, "defaultOwnerId");
}

export interface UpdateBranchInput {
  name?: string;
  timezone?: string;
  // `null` desvincula el vendedor por defecto (la sucursal vuelve a no tener
  // ninguno); `undefined` no toca la columna. Mismo contrato que
  // UpdateContactInput.companyId.
  defaultOwnerId?: string | null;
  // Datos de cobro (ítem 74): mismo contrato undefined/null. No necesitan el
  // `"campo" in input` de defaultOwnerId porque no hay nada que resolver: el
  // spread de abajo ya conserva un `null` explícito y omite lo que no vino.
  paymentLinkUrl?: string | null;
  bankTransferDetails?: string | null;
}

export async function updateBranch(organizationId: string, id: string, input: UpdateBranchInput) {
  await getBranchById(organizationId, id);

  // `"defaultOwnerId" in input`, no un chequeo truthy: un truthy trataría el
  // `null` explícito igual que "no vino", y acá `null` significa "sacale el
  // vendedor por defecto" (M-10).
  const data: UpdateBranchInput = { ...input };
  if ("defaultOwnerId" in input) {
    data.defaultOwnerId = await resolverDefaultOwnerId(organizationId, input.defaultOwnerId);
  }

  const result = await updateBranchRepo(id, organizationId, data);
  if (result.count === 0) {
    throw new AppError("Sucursal no encontrada", 404);
  }

  return getBranchById(organizationId, id);
}

// RESTRICT lógico, el criterio ya establecido en ALTO-8: no se borra una
// sucursal que tiene recursos, servicios o QRs activos colgando, agentes,
// stock, entradas de la KB, reservas confirmadas (ítem 167) o conversaciones
// abiertas (ítem 168), ni Google Calendar todavía conectado. Mismo formato
// de error que "el último pipeline" y que los dos RESTRICT de ALTO-8:
// AppError con 400.
//
// Y CON EL LOCK, que es la mitad que el chequeo solo no cubre. Un RESTRICT es
// una decisión sobre un conteo: sin serializar contra createResource /
// createServiceType, esos conteos se quedan viejos entre que se leen y que se
// escribe, y el bloqueo sería evitable con solo llegar primero. Es la misma
// clase de bug que H-1.
export async function deleteBranch(organizationId: string, id: string) {
  // 404 rápido, sin abrir transacción — mismo criterio que deletePipeline. No
  // es la defensa: se revalida adentro, con el lock sostenido.
  await getBranchById(organizationId, id);

  await prisma.$transaction(async (tx) => {
    await lockBranchForUpdate(id, organizationId, tx);

    const branch = await findBranchById(id, organizationId, tx);
    if (!branch) {
      throw new AppError("Sucursal no encontrada", 404);
    }

    // Los recursos primero: un ServiceType siempre cuelga de un Resource de la
    // misma sucursal, así que una sucursal con servicios activos tiene también
    // recursos activos. Preguntar por los recursos primero da el mensaje más
    // accionable — es el nivel por el que hay que empezar a limpiar.
    const recursosActivos = await countActiveResourcesByBranch(id, organizationId, tx);
    if (recursosActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.",
        400,
      );
    }

    // Redundante mientras el invariante de arriba se sostenga —sin recursos no
    // puede haber servicios— y está igual: es la clase de redundancia que
    // sobrevive a que alguien afloje la relación entre ServiceType y Resource.
    const serviciosActivos = await countActiveServiceTypesByBranch(id, organizationId, tx);
    if (serviciosActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene servicios activos. Eliminá primero sus servicios.",
        400,
      );
    }

    // TERCER RESTRICT: no se borra una sucursal que todavía tiene QRs activos
    // colgando. Un QrCode NO cambia de sucursal — UpdateQrCodeInput
    // (qr.service.ts) no acepta branchId, es inmutable como Resource— así que
    // sin este chequeo el soft delete de la sucursal deja el QR apuntando a un
    // branchId que ya no resuelve para el resto de la API (findBranchById
    // filtra deletedAt: null): un QR "huérfano", listado y editable, pero cuya
    // sucursal ya no existe desde ningún otro endpoint. El link público en sí
    // seguiría redirigiendo igual —findQrCodePublicState no depende de la
    // sucursal, solo del propio QR y de la organización— así que esto no es un
    // 404 en producción; es el mismo tipo de inconsistencia de datos que
    // recursos/servicios huérfanos, y se cierra con el mismo criterio.
    //
    // Para destrabar, el ADMIN tiene que borrar cada QR de la sucursal (DELETE
    // /api/qr/:id) — no hay forma de reasignarlo a otra sucursal. Por eso va
    // junto a recursos y servicios (datos que hay que limpiar a mano) y antes
    // de Google Calendar, que se destraba con un solo click.
    const qrsActivos = await countActiveQrCodesByBranch(id, organizationId, tx);
    if (qrsActivos > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene QRs activos. Eliminá primero sus QRs.",
        400,
      );
    }

    // DEL QUINTO AL NOVENO RESTRICT — ítems 167 y 168 de
    // docs/frontend-cambios-pendientes.md (C-03 de la auditoría). Mismo
    // problema que los QRs, con datos que importan más: sin estos chequeos se
    // podía borrar una sucursal que en ese mismo momento estaba atendiendo
    // WhatsApp (el Agent quedaba con un branchId que ya no resuelve), con stock
    // que desaparecía del resto de la API, o con reservas confirmadas de
    // clientes que iban a venir igual. Todos son datos que hay que migrar o
    // borrar a mano, así que van junto a recursos, servicios y QRs, antes de
    // Google Calendar — mismo criterio de orden que se explica ahí abajo.
    //
    // El de CONVERSACIONES ABIERTAS se difirió en el ítem 167 —nada las
    // pasaba a CLOSED y habría bloqueado para siempre— y volvió en el ítem
    // 168, junto con el cierre manual desde la bandeja (POST
    // /api/conversations/:id/close).
    //
    // QUÉ ESTÁ SERIALIZADO CON EL LOCK Y QUÉ NO. createAgent
    // (agent.service.ts) y la alta manual de una entrada de la KB
    // (knowledgeBaseEntry.service.ts) ya toman lockBranchForUpdate, así que
    // esos dos conteos no se pueden quedar viejos: un alta concurrente espera a
    // que este borrado termine y después falla la revalidación de sucursal.
    //
    // VENTANA CONOCIDA Y ACEPTADA: la creación de un Vehicle o de un Booking
    // (y el traslado de un Vehicle, que acepta branchId en el PATCH) NO toma
    // lockBranchForUpdate. Un alta de cualquiera de los dos justo en el
    // instante del borrado puede colarse entre este conteo y el commit, y
    // dejar la fila apuntando a una sucursal borrada — la misma inconsistencia
    // que este RESTRICT evita en el caso normal. Cerrarla exige sumarles el
    // lock a vehicle.service.ts y booking.service.ts, cuyas creaciones no
    // pasan hoy por ninguna transacción con la sucursal; es más cambio del que
    // pidió el ítem 167 y queda documentada acá, no cerrada.

    // Cualquier agente, activo o no: uno inactivo sigue siendo una fila que
    // quedaría apuntando a la sucursal borrada. Va primero de los cinco
    // porque es el que para la atención en vivo.
    const agentes = await countAgentsByBranch(id, organizationId, tx);
    if (agentes > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene agentes. Eliminá primero sus agentes.",
        400,
      );
    }

    // SOLD y DELIVERED no bloquean: esa unidad ya no está en la sucursal.
    const vehiculosEnStock = await countVehiclesInStockByBranch(id, organizationId, tx);
    if (vehiculosEnStock > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene vehículos en stock. Eliminá primero sus vehículos o pasalos a otra sucursal.",
        400,
      );
    }

    // Manuales o generadas por la sincronización del stock (ítem 132): las
    // dos quedarían huérfanas.
    const entradasDeKb = await countKnowledgeBaseEntriesByBranch(id, organizationId, tx);
    if (entradasDeKb > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene entradas en la base de conocimiento. Eliminá primero sus entradas.",
        400,
      );
    }

    // ACTIVE o TRANSFERRED_TO_HUMAN (ítem 168): alguien —el agente o una
    // persona— sigue atendiendo ahí. Las CLOSED son historia y no bloquean.
    // Se destraba cerrándolas desde la bandeja.
    //
    // Sin lock que lo serialice, igual que Vehicle y Booking: una conversación
    // nace de un mensaje entrante, no de un alta que tome lockBranchForUpdate.
    // En la práctica la ventana la cierra el chequeo de agentes de arriba: sin
    // agente en la sucursal no nacen conversaciones nuevas en ella.
    const conversacionesAbiertas = await countOpenConversationsOf(
      { branchId: id },
      organizationId,
      tx,
    );
    if (conversacionesAbiertas > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene conversaciones abiertas. Cerralas primero desde la bandeja.",
        400,
      );
    }

    // Solo CONFIRMED, mismo criterio que el RESTRICT de deleteServiceType.
    const reservasConfirmadas = await countConfirmedBookingsOf(
      { branchId: id },
      organizationId,
      tx,
    );
    if (reservasConfirmadas > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que tiene reservas confirmadas. Cancelalas primero.",
        400,
      );
    }

    // CUARTO RESTRICT (P2.1, paso 2): no se borra una sucursal que todavía tiene
    // Google Calendar conectado. La conexión guarda una credencial viva sobre la
    // cuenta de Google del negocio, y borrar la sucursal la dejaría huérfana:
    // sin fila que consultar, nadie podría revocarla nunca más desde el CRM.
    //
    // LO QUE BLOQUEA ES EL SECRETO, NO EL STATUS — B-9 de
    // docs-privados/auditoria-2026-08-29.md (local, no está en GitHub). Una conexión REVOKED ya no tiene token (se
    // pone en NULL al desconectar) y no bloquea: no hay nada que se pueda
    // perder. Una en ERROR es un grant que Google rechazó, pero
    // markConnectionError CONSERVA el refresh token a propósito —puede ser algo
    // que se resuelva del lado de Google—, así que sigue habiendo un secreto
    // cifrado en la fila y SÍ bloquea. Antes se contaba por status = ACTIVE y
    // una sucursal en ERROR se podía borrar con su credencial adentro, sin
    // ninguna fila desde la que revocarla. El camino para el ADMIN ya existe:
    // desconectar() acepta una conexión en ERROR (solo rechaza REVOKED) y pone
    // el token en NULL; después de eso, el borrado procede.
    //
    // VA ÚLTIMO, después de recursos, servicios, QRs y los cinco de los ítems
    // 167 y 168, y no es indiferente: los mensajes son excluyentes —se devuelve el primero
    // que dispara— así que el orden decide cuál ve el ADMIN. Todo lo anterior
    // son datos que hay que migrar o borrar a mano; desconectar Google es un
    // click.
    // Empezar por lo caro deja el trámite corto para el final, en vez de
    // hacerle desconectar Google para descubrir recién ahí que igual no puede
    // borrar la sucursal.
    const conexionesConSecreto = await countConnectionsWithSecretByBranch(id, organizationId, tx);
    if (conexionesConSecreto > 0) {
      throw new AppError(
        "No se puede eliminar una sucursal que todavía tiene Google Calendar conectado, aunque la conexión esté en error. Desconectalo primero.",
        400,
      );
    }

    const result = await softDeleteBranch(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Sucursal no encontrada", 404);
    }
  });
}
