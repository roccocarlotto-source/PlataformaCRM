import type { OrganizationIndustry } from "@prisma/client";
import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Qué puede hacer cada rol (docs/rubros.md §11.2 y §11.3, PR R12). Un solo
// lugar para las capacidades que hoy eran `role === "ADMIN"` sueltos.
//
// LA REGLA DE ESTE ARCHIVO: para ADMIN y USER, `puede` devuelve EXACTAMENTE lo
// que devolvía el `if (role === "ADMIN")` que reemplaza (ADMIN todo, USER
// nada de esta tabla). Lo fija src/services/permisos.test.ts contra ese
// predicado, capacidad por capacidad. Lo nuevo es la fila de RECEPCION.
//
// Solo se reemplazaron los chequeos donde Recepción NO puede caer en el lado
// de USER (§11.3):
//   - editar_cualquier_contacto: en una clínica nadie es dueño de un paciente;
//     Recepción edita cualquiera (contact.controller → permisosDelVendedor).
//   - atender_cualquier_conversacion: Recepción responde, reintenta y
//     devuelve al agente cualquier conversación, asignada o no
//     (conversationReply.service).
// El resto de los chequeos de rol quedan como estaban, y Recepción cae en el
// lado de "no ADMIN", que en esos casos es lo correcto: no asigna registros a
// otra persona, no usa `force` en un turno, no gestiona cupones ajenos, el
// agente interno según su columna.
//   - operar_tareas_de_sus_sedes (R20): Recepción ve, completa, edita y se
//     asigna, además de las suyas, las tareas de sus sedes y las que no
//     tienen sede (activity.service). Asignarle una a OTRA persona sigue
//     siendo de ADMIN.
//
// DESDE R20 Recepción tiene límite de sede: "cualquier conversación" es
// cualquiera DE SUS SEDES. El límite no vive en la tabla de capacidades sino
// en sedesDelActor (abajo), que cada service aplica sobre el recurso.
// ---------------------------------------------------------------------------

export type Capacidad =
  // Editar un contacto que no tiene asignado (sin reasignarlo a otro).
  | "editar_cualquier_contacto"
  // Editar una oportunidad que no tiene asignada.
  | "editar_cualquier_oportunidad"
  // Crear o reasignar un contacto o una oportunidad a nombre de otra persona
  // (permisosDelVendedor.ts).
  | "asignar_a_otra_persona"
  // Responder, reintentar y devolver al agente una conversación no asignada.
  | "atender_cualquier_conversacion"
  // Ver, completar, editar y asignarse una tarea que no tiene asignada, si es
  // de sus sedes o no tiene sede (R20). No incluye asignarla a otra persona.
  | "operar_tareas_de_sus_sedes";

export const CAPACIDADES: readonly Capacidad[] = [
  "editar_cualquier_contacto",
  "editar_cualquier_oportunidad",
  "asignar_a_otra_persona",
  "atender_cualquier_conversacion",
  "operar_tareas_de_sus_sedes",
];

export const CAPACIDADES_POR_ROL: Readonly<Record<RoleName, ReadonlySet<Capacidad>>> = {
  ADMIN: new Set(CAPACIDADES),
  // USER: ninguna. Es el "lado no ADMIN" de cada chequeo de hoy.
  USER: new Set<Capacidad>(),
  // §11.2: Recepción opera la agenda, los pacientes, las conversaciones y las
  // tareas, y no configura nada.
  RECEPCION: new Set<Capacidad>([
    "editar_cualquier_contacto",
    "atender_cualquier_conversacion",
    "operar_tareas_de_sus_sedes",
  ]),
};

export function puede(actor: { role: RoleName }, capacidad: Capacidad): boolean {
  return CAPACIDADES_POR_ROL[actor.role].has(capacidad);
}

// ---------------------------------------------------------------------------
// Usuarios por sede (docs/rubros.md §11.5, D19, PR R20).
//
// LA REGLA: devuelve "todas" para cualquier usuario que no sea Recepción de una
// clínica —todo usuario de una automotora y todo ADMIN, de cualquier rubro—.
// Para ellos el resultado es exactamente el de antes de R20 y no se mira
// ninguna fila de user_branches (lo fija src/clinicas/automotoraSinCambios).
//
// Para Recepción devuelve las sedes de UserBranch que no están borradas
// (findUserForAuth las trae en el mismo SELECT del contexto). Una Recepción sin
// sedes ve VACÍO, no todo: `sedes` ausente es []. FALLA CERRADO a propósito:
// un actor de Recepción armado sin `sedes` (un camino que se olvidó de
// pasarlas) no ve nada en lugar de verlo todo.
//
// Toda lectura y escritura limitada por sede pasa por acá: turnos,
// conversaciones y tareas. Los pacientes (Contact) no tienen sede (§11.2).
// ---------------------------------------------------------------------------
export type SedesDelActor = "todas" | readonly string[];

export interface ActorConSedes {
  role: RoleName;
  industry?: OrganizationIndustry;
  sedes?: readonly string[];
}

export function sedesDelActor(actor: ActorConSedes): SedesDelActor {
  if (actor.role !== "RECEPCION" || actor.industry === "AUTOMOTORA") return "todas";
  return actor.sedes ?? [];
}

// ¿El recurso de esta sede está al alcance del actor? `null` es "sin sede"
// (solo puede pasar en una tarea): no es de ninguna sede, así que no la limita.
export function estaEnSusSedes(actor: ActorConSedes, branchId: string | null): boolean {
  const sedes = sedesDelActor(actor);
  if (sedes === "todas" || branchId === null) return true;
  return sedes.includes(branchId);
}

// 404 (no 403) si el recurso es de otra sede: no se confirma que exista
// (§11.3, igual que una tarea ajena para un USER). Mismo mensaje que el 404
// del id inexistente de cada recurso.
export function exigirSedeDelActor(
  actor: ActorConSedes,
  branchId: string | null,
  mensaje404: string,
): void {
  if (!estaEnSusSedes(actor, branchId)) throw new AppError(mensaje404, 404);
}

// El filtro de sede de un listado: lo que pidió el cliente (`branchId`, la sede
// activa del selector) acotado a las sedes del actor. Para "todas" devuelve el
// pedido tal cual (el comportamiento de antes). Si pide una sede que no es
// suya, la lista queda vacía: no es un error, es un filtro sin resultados.
export interface FiltroDeSedes {
  branchId?: string;
  branchIds?: readonly string[];
}

export function filtroDeSedes(actor: ActorConSedes, branchIdPedido?: string): FiltroDeSedes {
  const sedes = sedesDelActor(actor);
  if (sedes === "todas") return branchIdPedido ? { branchId: branchIdPedido } : {};
  if (branchIdPedido)
    return sedes.includes(branchIdPedido) ? { branchId: branchIdPedido } : { branchIds: [] };
  return { branchIds: sedes };
}
