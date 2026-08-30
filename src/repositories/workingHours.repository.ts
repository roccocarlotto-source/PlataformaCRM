import type { Weekday } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// WorkingHours — acceso a datos (P2.1, paso 3).
//
// Sin soft delete y sin listado por organización: la única consulta que existe
// es "el horario de este recurso". Ver el comentario del modelo.
// ---------------------------------------------------------------------------

export function findWorkingHoursByResource(
  resourceId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.workingHours.findMany({
    where: { resourceId, organizationId },
    // Orden estable para que la respuesta del GET no cambie entre llamadas: el
    // enum de Postgres ordena por su declaración (lunes primero), y dentro del
    // día por hora de inicio. Sin esto, dos GET seguidos podrían devolver las
    // franjas en distinto orden y parecer un cambio.
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  });
}

export interface FranjaAGuardar {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

// ---------------------------------------------------------------------------
// REEMPLAZO COMPLETO del horario de un recurso: borra lo que había y escribe lo
// nuevo.
//
// POR QUÉ REEMPLAZAR Y NO UN CRUD POR FRANJA — es la decisión de diseño del
// endpoint y vale la pena que esté acá, junto a la operación:
//
//   1. Es como se usa de verdad. Un dueño de negocio carga su horario una vez y
//      lo toca cada varios meses. Un CRUD por franja lo obliga a diez llamadas
//      para cargar una semana, y a llevar él la cuenta de qué franja tiene qué
//      id para poder editarla.
//   2. La validación que importa —que dos franjas del mismo día no se pisen— es
//      sobre el CONJUNTO, no sobre una fila. Con altas y bajas sueltas habría
//      que revalidar el conjunto entero en cada una igual, así que el reemplazo
//      no agrega trabajo: lo hace explícito.
//   3. Es idempotente. Mandar dos veces el mismo horario deja el mismo estado,
//      que es la propiedad que uno quiere del lado del que llama.
//
// NO recibe `db` con default: el borrado y la inserción tienen que ser atómicos
// —un fallo entre los dos dejaría al recurso SIN horario, o sea sin
// disponibilidad y sin poder reservar— así que exige la transacción del caller.
// Es el mismo recurso que usan los lock*ForUpdate del repo para hacer imposible
// llamarlos fuera de una transacción por descuido.
// ---------------------------------------------------------------------------
export async function replaceWorkingHours(
  resourceId: string,
  organizationId: string,
  franjas: FranjaAGuardar[],
  db: Db,
) {
  await db.workingHours.deleteMany({ where: { resourceId } });

  if (franjas.length > 0) {
    await db.workingHours.createMany({
      data: franjas.map((franja) => ({
        organizationId,
        resourceId,
        weekday: franja.weekday,
        startMinute: franja.startMinute,
        endMinute: franja.endMinute,
      })),
    });
  }

  return findWorkingHoursByResource(resourceId, organizationId, db);
}
