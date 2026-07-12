import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { createPipeline } from "./pipeline.service";
import { AppError } from "../utils/AppError";

// Test de integración: ejercita pipeline.service + pipeline.repository +
// Prisma reales contra la base de `.env` (Supabase real, ver README). No
// levanta Express — el comportamiento a proteger vive en el service, no en
// el transporte HTTP. Requiere DATABASE_URL/DIRECT_URL alcanzables; corre
// aparte de la suite unitaria de H1 vía `npm run test:integration`
// (ver package.json) para que `npm test` siga sin depender de la base real.
//
// H2: una violación de unicidad de Pipeline (nombre duplicado en la misma
// organización) debía llegar como PrismaClientKnownRequestError(P2002)
// crudo hasta errorHandler y responder 500. Este test provoca esa
// violación real en Postgres — no un P2002 fabricado a mano — y verifica
// que el resultado observable del service sea AppError 409, nunca el
// error crudo de Prisma. Ver nota al final del archivo sobre por qué la
// segunda constraint de Pipeline (el índice parcial de `isDefault`) no
// tiene cobertura persistente en este ciclo.

async function createTestOrg() {
  return prisma.organization.create({
    data: {
      name: `H2 integration test ${randomUUID()}`,
      slug: `h2-integration-test-${randomUUID()}`,
    },
  });
}

async function deleteTestOrg(organizationId: string) {
  await prisma.pipeline.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
}

test("createPipeline traduce la violación real del nombre duplicado a 409, no a P2002 crudo", async () => {
  const org = await createTestOrg();
  try {
    await createPipeline(org.id, { name: "Ventas" });

    await assert.rejects(
      () => createPipeline(org.id, { name: "Ventas" }),
      (err: unknown) => {
        assert.ok(err instanceof AppError, "debe ser AppError, no el P2002 crudo de Prisma");
        assert.equal((err as AppError).statusCode, 409);
        return true;
      },
    );
  } finally {
    await deleteTestOrg(org.id);
  }
});

// NOTA — cobertura NO agregada para la segunda constraint (índice parcial
// `pipelines_org_default_unique`, a lo sumo un default por organización):
// se intentó reproducirla con dos createPipeline({isDefault:true}) lanzados
// vía Promise.allSettled y, de forma reproducible (no flaky), las dos
// transacciones se serializaron sin solapar — createPipeline siempre
// desmarca el default anterior ANTES de insertar el nuevo, así que salvo
// que dos transacciones estén realmente abiertas y solapadas al mismo
// tiempo, esa lógica se auto-corrige y nunca llega a chocar contra el
// índice. Forzar el solapamiento de forma determinística requeriría
// inyectar un punto de sincronización artificial dentro de
// pipeline.service.ts (p. ej. una función que acepte un hook de test para
// pausar entre el unset y el insert) — un cambio de producción solo para
// hacer testeable una carrera, fuera del alcance de la corrección mínima
// de H2. La traducción P2002 → 409 para esta constraint corre por el mismo
// `rethrowAsConflict` ya cubierto arriba (mismo código, otra rama del
// mismo `if`), y se verificó manualmente contra la base real que
// `err.meta.target` para esta constraint es `["organization_id"]` (ver
// informe de la corrección). Riesgo residual documentado, no cubierto por
// un test persistente en este ciclo.
