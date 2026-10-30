import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import { procesarLotes } from "./importBatchWorker";

// ---------------------------------------------------------------------------
// Un lote que no se puede cerrar no traba a los demás (importBatchWorker.ts,
// NEG-02 de docs-privados/auditoria-2026-10-21, local), contra Postgres real.
//
// El cierre se hace fallar de verdad con un trigger temporal que rechaza
// escribir los contadores finales de UN lote: el camino de error del worker
// (DONE con errorMessage, sin contadores) sí pasa. Dos organizaciones, un
// lote RUNNING terminado en cada una.
// ---------------------------------------------------------------------------

const authIds: string[] = [];
const orgIds: string[] = [];
let loteQueFalla: string;
let loteSano: string;

async function organizacionConLoteTerminado(etiqueta: string): Promise<string> {
  const org = await prisma.organization.create({
    data: {
      name: `Lotes ${etiqueta} ${randomUUID()}`,
      slug: `lotes-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgIds.push(org.id);
  const email = `lotes-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: "Lotes-test-password-123!",
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`No se pudo crear el usuario de Auth: ${error?.message}`);
  authIds.push(data.user.id);
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN. Abortando.");
  await prisma.user.create({
    data: { id: data.user.id, organizationId: org.id, roleId: rol.id, email, fullName: "Admin" },
  });
  const source = await prisma.source.create({
    data: { organizationId: org.id, name: "Planilla", type: "FILE_IMPORT" },
  });
  // RUNNING y sin filas pendientes: listo para cerrar.
  const lote = await prisma.importBatch.create({
    data: {
      organizationId: org.id,
      sourceId: source.id,
      entityType: "CONTACT",
      originKind: "FILE",
      createdByUserId: data.user.id,
      status: "RUNNING",
    },
  });
  return lote.id;
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  loteQueFalla = await organizacionConLoteTerminado("falla");
  loteSano = await organizacionConLoteTerminado("sano");
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_cierre_que_falla() RETURNS trigger AS $$
    BEGIN
      IF NEW.id = '${loteQueFalla}'::uuid AND NEW.counters IS DISTINCT FROM OLD.counters THEN
        RAISE EXCEPTION 'cierre roto a propósito para el test';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER test_cierre_que_falla BEFORE UPDATE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION test_cierre_que_falla()`);
});

after(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_cierre_que_falla ON import_batches`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_cierre_que_falla()`);
  for (const id of orgIds) {
    await prisma.importBatch.deleteMany({ where: { organizationId: id } });
    await prisma.source.deleteMany({ where: { organizationId: id } });
    await prisma.user.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
  for (const id of authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
});

test("un lote que no se puede cerrar queda DONE con su error, y el de otra organización se cierra igual", async () => {
  const resumen = await procesarLotes();

  const fallido = await prisma.importBatch.findUniqueOrThrow({ where: { id: loteQueFalla } });
  assert.equal(fallido.status, "DONE", "sale de la cola: no se vuelve a intentar en cada pasada");
  assert.match(fallido.errorMessage ?? "", /^No se pudo cerrar el lote: /);
  assert.ok(fallido.finishedAt);

  const sano = await prisma.importBatch.findUniqueOrThrow({ where: { id: loteSano } });
  assert.equal(sano.status, "DONE");
  assert.equal(sano.errorMessage, null);
  assert.ok(sano.counters, "el sano tiene sus contadores finales");

  assert.ok(resumen.conError >= 1);
  assert.ok(resumen.terminados >= 1);

  // La pasada siguiente no vuelve a tocar el lote fallido.
  const otra = await procesarLotes();
  assert.equal(otra.conError, 0);
});
