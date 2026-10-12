import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// El lease del turno del agente (tabla agent_turn_leases; ver
// conLockDeConversacion en services/agentOrchestration.service.ts).
//
// Cada función es UNA sentencia, sin transacción propia: no se ocupa una
// conexión más que lo que dura la consulta. Los vencimientos se calculan y se
// comparan con now() de Postgres, nunca con el reloj de Node: con dos relojes,
// un lease "vencido" para uno podría seguir vigente para el otro.
//
// TODAS llevan organization_id en el WHERE (H-01): la clave ya contiene ids
// de esa organización, pero la escritura misma es la garantía.
// ---------------------------------------------------------------------------

export interface LeaseDelTurno {
  lockKey: string;
  organizationId: string;
  holderId: string;
}

/** Lo toma si está libre o vencido. true = es de `holderId` hasta now() +
 *  duracionMs. Un lease vigente de otro no se toca: devuelve false. */
export async function tomarLease(
  lease: LeaseDelTurno,
  duracionMs: number,
  db: Db = prisma,
): Promise<boolean> {
  const filas = await db.$queryRaw<{ holder_id: string }[]>`
    INSERT INTO agent_turn_leases (lock_key, organization_id, holder_id, locked_until)
    VALUES (
      ${lease.lockKey},
      ${lease.organizationId}::uuid,
      ${lease.holderId}::uuid,
      now() + make_interval(secs => ${duracionMs / 1000})
    )
    ON CONFLICT (lock_key) DO UPDATE
      SET holder_id = EXCLUDED.holder_id,
          locked_until = EXCLUDED.locked_until,
          created_at = now()
      WHERE agent_turn_leases.locked_until < now()
        AND agent_turn_leases.organization_id = EXCLUDED.organization_id
    RETURNING holder_id`;
  return filas.length === 1 && filas[0].holder_id === lease.holderId;
}

/** Extiende el vencimiento si el lease sigue siendo de `holderId` y no venció.
 *  false = se perdió (venció, o lo tomó otro). */
export async function renovarLease(
  lease: LeaseDelTurno,
  duracionMs: number,
  db: Db = prisma,
): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE agent_turn_leases
    SET locked_until = now() + make_interval(secs => ${duracionMs / 1000})
    WHERE lock_key = ${lease.lockKey}
      AND organization_id = ${lease.organizationId}::uuid
      AND holder_id = ${lease.holderId}::uuid
      AND locked_until > now()`;
  return n === 1;
}

/** Lo suelta, solo si es de `holderId`. */
export async function soltarLease(lease: LeaseDelTurno, db: Db = prisma): Promise<void> {
  await db.$executeRaw`
    DELETE FROM agent_turn_leases
    WHERE lock_key = ${lease.lockKey}
      AND organization_id = ${lease.organizationId}::uuid
      AND holder_id = ${lease.holderId}::uuid`;
}

/** FENCING, dentro de la transacción de una escritura del turno: true si el
 *  lease sigue siendo de `holderId` y no venció, y deja su fila tomada FOR
 *  UPDATE hasta el commit. Así nadie puede quedarse con el lease vencido
 *  mientras esta transacción escribe: tomarLease, al chocar con la fila, espera
 *  a que esta termine. */
export async function leaseVigenteConLaFilaTomada(lease: LeaseDelTurno, tx: Db): Promise<boolean> {
  const filas = await tx.$queryRaw<{ vigente: boolean }[]>`
    SELECT true AS vigente
    FROM agent_turn_leases
    WHERE lock_key = ${lease.lockKey}
      AND organization_id = ${lease.organizationId}::uuid
      AND holder_id = ${lease.holderId}::uuid
      AND locked_until > now()
    FOR UPDATE`;
  return filas.length === 1;
}
