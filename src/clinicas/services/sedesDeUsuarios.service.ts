import type { OrganizationIndustry } from "@prisma/client";
import { prisma, type Db } from "../../lib/prisma";
import { findEdicionYRubro } from "../../repositories/organization.repository";
import type { RoleName } from "../../types/auth";
import { AppError } from "../../utils/AppError";
import {
  recepcionDeLaSede,
  sedesVigentesDeLaOrganizacion,
} from "../repositories/sedesDeUsuarios.repository";

// ---------------------------------------------------------------------------
// Usuarios por sede (docs/rubros.md §11.5, D19, PR R20): qué sedes se guardan
// al invitar o al editar un usuario, y a quién de la recepción va un aviso.
//
// Solo lo usan las clínicas. En una automotora `branchIds` se ignora: no se
// valida, no se guarda y la respuesta no cambia.
// ---------------------------------------------------------------------------

export const SEDES_OBLIGATORIAS = "SEDES_OBLIGATORIAS";
export const SEDES_INVALIDAS = "SEDES_INVALIDAS";
export const ADMIN_SIN_SEDES = "ADMIN_SIN_SEDES";

export const MENSAJE_SEDES_OBLIGATORIAS = "Elegí al menos una sede para la recepción.";
export const MENSAJE_SEDES_INVALIDAS =
  "Alguna de las sedes elegidas no existe o no pertenece a tu organización.";
export const MENSAJE_ADMIN_SIN_SEDES =
  "Un administrador ve todas las sedes: no se le asignan sedes.";

/**
 * Las sedes a guardar para un usuario o una invitación de este rol:
 *   - `null`: no se escribe nada (automotora; o Recepción sin `branchIds` en
 *     una edición que no cambia el rol, que conserva las que tenía).
 *   - `[]`: borrar las que haya (un ADMIN: nunca queda limitado por sede).
 *   - la lista, sin repetidos, validada contra la organización.
 *
 * `obligatorias`: true al invitar y al pasar a alguien a Recepción. Una
 * Recepción tiene que tener al menos una sede (400 SEDES_OBLIGATORIAS).
 */
export async function resolverSedesDelRol(
  organizationId: string,
  industry: OrganizationIndustry,
  role: RoleName,
  branchIds: readonly string[] | undefined,
  opciones: { obligatorias: boolean },
  db: Db = prisma,
): Promise<string[] | null> {
  if (industry !== "CLINICA") return null;

  if (role === "ADMIN") {
    if (branchIds !== undefined && branchIds.length > 0) {
      throw new AppError(MENSAJE_ADMIN_SIN_SEDES, 400, true, { code: ADMIN_SIN_SEDES });
    }
    return [];
  }
  if (role !== "RECEPCION") return null;

  if (branchIds === undefined) {
    if (opciones.obligatorias) {
      throw new AppError(MENSAJE_SEDES_OBLIGATORIAS, 400, true, { code: SEDES_OBLIGATORIAS });
    }
    return null;
  }
  const pedidas = [...new Set(branchIds)];
  if (pedidas.length === 0) {
    throw new AppError(MENSAJE_SEDES_OBLIGATORIAS, 400, true, { code: SEDES_OBLIGATORIAS });
  }
  const vigentes = await sedesVigentesDeLaOrganizacion(organizationId, pedidas, db);
  if (vigentes.length !== pedidas.length) {
    throw new AppError(MENSAJE_SEDES_INVALIDAS, 400, true, { code: SEDES_INVALIDAS });
  }
  return pedidas.sort();
}

// ---------------------------------------------------------------------------
// A quién va un aviso de la recepción de una sede (§11.4). SOLO CLÍNICAS: los
// caminos que crean la tarea lo llaman solo con industry === "CLINICA"; en una
// automotora la asignación es exactamente la de antes.
//
//   1. el "Responsable por defecto" de la sede, si es Recepción y tiene esa
//      sede asignada;
//   2. si no, la Recepción de esa sede con menos tareas abiertas (a igual
//      cantidad, la más antigua y después por id, para que sea estable);
//   3. si la sede no tiene nadie de Recepción, null: quien llama sigue con el
//      camino de hoy (Responsable por defecto o el ADMIN más antiguo).
// ---------------------------------------------------------------------------

/** PURA: la elección de los pasos 1 y 2. */
export function elegirRecepcion(
  candidatos: readonly { id: string; createdAt: Date; tareasAbiertas: number }[],
  responsablePorDefectoId: string | null,
): string | null {
  if (responsablePorDefectoId && candidatos.some((c) => c.id === responsablePorDefectoId)) {
    return responsablePorDefectoId;
  }
  const [primero] = [...candidatos].sort(
    (a, b) =>
      a.tareasAbiertas - b.tareasAbiertas ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return primero?.id ?? null;
}

export async function recepcionistaParaElAviso(
  organizationId: string,
  branchId: string,
  db: Db = prisma,
): Promise<string | null> {
  const [candidatos, sede] = await Promise.all([
    recepcionDeLaSede(organizationId, branchId, db),
    db.branch.findFirst({
      where: { id: branchId, organizationId },
      select: { defaultOwnerId: true },
    }),
  ]);
  return elegirRecepcion(candidatos, sede?.defaultOwnerId ?? null);
}

/**
 * Para los caminos que crean un aviso a partir de una conversación de una sede
 * (la derivación del agente y la devuelta sin respuesta). En una automotora
 * devuelve null y quien llama hace exactamente lo de antes, sin branchId. En
 * una clínica, la tarea lleva la sede de la conversación, y `recepcionistaId`
 * es a quién va (null = la sede no tiene Recepción: el camino de hoy).
 */
export async function avisoDeRecepcion(
  organizationId: string,
  branchId: string,
  db: Db = prisma,
): Promise<{ branchId: string; recepcionistaId: string | null } | null> {
  const { industry } = await findEdicionYRubro(organizationId, db);
  if (industry !== "CLINICA") return null;
  return {
    branchId,
    recepcionistaId: await recepcionistaParaElAviso(organizationId, branchId, db),
  };
}
