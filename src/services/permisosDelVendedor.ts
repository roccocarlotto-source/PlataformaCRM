import type { RoleName } from "../types/auth";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// QUÉ PUEDE ESCRIBIR UN VENDEDOR (USER) SOBRE CONTACTOS Y OPORTUNIDADES —
// decisión D2 de Rocco, 05/10/2026 (OPUS-I-03 de
// docs-privados/auditoria-2026-10-04-OPUS.md, local).
//
// Antes crear y editar contactos y oportunidades era solo de ADMIN. Un equipo
// de vendedores tenía que ser todo ADMIN —con acceso a usuarios, claves de API
// e integraciones— para poder trabajar.
//
// La regla:
//   - un USER CREA contactos y oportunidades, y quedan a su nombre;
//   - un USER EDITA los que tiene asignados (es el dueño), y nada más;
//   - un USER no reasigna: ni lo suyo a otro, ni lo de otro a sí mismo;
//   - BORRAR y UNIR siguen siendo de ADMIN (esas rutas conservan su
//     authorize("ADMIN")), igual que borrar los datos personales.
// Un ADMIN no tiene ninguna de estas restricciones.
//
// Mismo criterio que las actividades (B-18): escritura sobre lo propio.
//
// VIVE ACÁ Y NO EN LOS SERVICES de contacto y oportunidad: esos los llaman
// también el agente de IA, la ingesta y las automatizaciones, que actúan en
// nombre de la organización y no de un vendedor. Lo que se restringe es lo que
// una PERSONA con rol USER pide por la API, y eso lo sabe el controller.
// ---------------------------------------------------------------------------

export interface Actor {
  userId: string;
  role: RoleName;
}

export const MENSAJE_USER_NO_ASIGNA_A_OTRO =
  "Solo un administrador puede asignarle un registro a otra persona";
export const MENSAJE_USER_SOLO_EDITA_LO_SUYO =
  "Solo podés editar lo que tenés asignado. Pedile a un administrador que te lo asigne";

// A quién queda asignado lo que se crea. Un USER siempre a sí mismo: pedir
// otro dueño es 403 (no se ignora en silencio: quedaría a su nombre algo que
// creyó haberle cargado a otro). Un ADMIN, a quien pida.
export function ownerAlCrear(actor: Actor, ownerIdPedido: string | undefined): string | undefined {
  if (actor.role === "ADMIN") {
    return ownerIdPedido;
  }
  if (ownerIdPedido !== undefined && ownerIdPedido !== actor.userId) {
    throw new AppError(MENSAJE_USER_NO_ASIGNA_A_OTRO, 403);
  }
  return actor.userId;
}

// ¿Puede esta persona editar este registro con estos cambios? Lanza 403 si no.
// `ownerIdPedido` es el ownerId del PATCH: undefined = no lo toca; null = lo
// deja sin asignar.
export function assertPuedeEditar(
  actor: Actor,
  registro: { ownerId: string | null },
  ownerIdPedido: string | null | undefined,
): void {
  if (actor.role === "ADMIN") {
    return;
  }
  if (registro.ownerId !== actor.userId) {
    throw new AppError(MENSAJE_USER_SOLO_EDITA_LO_SUYO, 403);
  }
  if (ownerIdPedido !== undefined && ownerIdPedido !== actor.userId) {
    throw new AppError(MENSAJE_USER_NO_ASIGNA_A_OTRO, 403);
  }
}
