import type { RoleName } from "../types/auth";

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
// agente interno según su columna, las tareas como un USER (las suyas; las de
// sus sedes llegan con Activity.branchId en R20).
//
// HASTA R20 Recepción no tiene límite de sede: "cualquier conversación" es
// cualquiera de la organización. R20 suma sedesDelActor y el recurso a
// `puede`.
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
  | "atender_cualquier_conversacion";

export const CAPACIDADES: readonly Capacidad[] = [
  "editar_cualquier_contacto",
  "editar_cualquier_oportunidad",
  "asignar_a_otra_persona",
  "atender_cualquier_conversacion",
];

export const CAPACIDADES_POR_ROL: Readonly<Record<RoleName, ReadonlySet<Capacidad>>> = {
  ADMIN: new Set(CAPACIDADES),
  // USER: ninguna. Es el "lado no ADMIN" de cada chequeo de hoy.
  USER: new Set<Capacidad>(),
  // §11.2: Recepción opera la agenda, los pacientes, las conversaciones y las
  // tareas, y no configura nada.
  RECEPCION: new Set<Capacidad>(["editar_cualquier_contacto", "atender_cualquier_conversacion"]),
};

export function puede(actor: { role: RoleName }, capacidad: Capacidad): boolean {
  return CAPACIDADES_POR_ROL[actor.role].has(capacidad);
}
