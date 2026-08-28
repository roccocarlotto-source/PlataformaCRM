import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { IngestionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  countIngestionEventsPurgables,
  DIAS_DE_RETENCION_INGESTION_EVENT,
  fechaDeCorteDeRetencion,
  purgeIngestionEvents,
} from "./ingestionEvent.repository";

// ---------------------------------------------------------------------------
// Purga de retención (D2-3 de docs/review-fase2-2026-08-28.md) contra Postgres
// real.
//
// LE PREGUNTA A LA BASE, NO A LA FUNCIÓN: cada afirmación sobre qué sobrevivió
// se lee de vuelta de `ingestion_events`, nunca del número que devolvió el
// deleteMany — que es justamente lo que un bug de `where` podría estar
// contando bien mientras borra mal.
//
// TODO ACOTADO A LA ORGANIZACIÓN DEL FIXTURE. La purga real corre sin acotar,
// pero este test destruye filas: sin el scope borraría datos de otras
// organizaciones si la base está compartida. Mismo criterio que
// drenarPendientes({ organizationId }) en los tests del worker.
// ---------------------------------------------------------------------------

let orgId: string;
let sourceId: string;

// Bien adentro de la ventana de retención vencida, no en el borde: probar el
// límite exacto es otro test, y usar 89.9 días acá haría que este fallara por
// redondeo en vez de por la regla que quiere verificar.
const VIEJO = new Date(Date.now() - (DIAS_DE_RETENCION_INGESTION_EVENT + 10) * 24 * 60 * 60 * 1000);
const RECIENTE = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function crearEvento(status: IngestionStatus, createdAt: Date): Promise<string> {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: orgId,
      sourceId,
      externalId: `purga-${randomUUID()}`,
      rawPayload: { email: "lead@ejemplo.test" } as never,
      status,
      createdAt,
    },
    select: { id: true },
  });
  return evento.id;
}

function existe(id: string) {
  return prisma.ingestionEvent.findUnique({ where: { id }, select: { id: true } });
}

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Purga test org ${randomUUID()}`,
      slug: `purga-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  const source = await prisma.source.create({
    data: { organizationId: orgId, name: "Fuente de purga", type: "WEBHOOK" },
    select: { id: true },
  });
  sourceId = source.id;
});

after(async () => {
  if (!orgId) return;
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.source.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

// ---------------------------------------------------------------------------
// El test central: los cuatro casos de la política, en una sola pasada.
// ---------------------------------------------------------------------------

test("la purga borra solo PROCESSED/DUPLICATE vencidos, y no toca FAILED ni PENDING", async () => {
  const procesadoViejo = await crearEvento(IngestionStatus.PROCESSED, VIEJO);
  const procesadoReciente = await crearEvento(IngestionStatus.PROCESSED, RECIENTE);
  const falladoViejo = await crearEvento(IngestionStatus.FAILED, VIEJO);
  const pendienteViejo = await crearEvento(IngestionStatus.PENDING, VIEJO);

  const corte = fechaDeCorteDeRetencion();
  const { count } = await purgeIngestionEvents(corte, { organizationId: orgId });

  assert.equal(count, 1, "solo el PROCESSED vencido entra en la purga");

  assert.equal(await existe(procesadoViejo), null, "PROCESSED vencido: se borra");
  assert.ok(await existe(procesadoReciente), "PROCESSED dentro de los 90 días: sobrevive");

  // Los dos que NUNCA se purgan, sin importar la edad. No es una optimización:
  // un PENDING es trabajo sin hacer y un FAILED es el único lugar donde vive
  // el dato que no se pudo promover.
  assert.ok(await existe(falladoViejo), "FAILED vencido: NO se toca");
  assert.ok(await existe(pendienteViejo), "PENDING vencido: NO se toca");
});

// ---------------------------------------------------------------------------
// DUPLICATE tiene su propio test: hoy ningún código lo escribe (los duplicados
// no crean fila), así que el caso solo existe si alguien lo construye a mano.
// Está en la política igual, y si un día se empieza a escribir, esto ya lo
// cubre.
// ---------------------------------------------------------------------------

test("un DUPLICATE vencido también se purga", async () => {
  const duplicadoViejo = await crearEvento(IngestionStatus.DUPLICATE, VIEJO);

  const { count } = await purgeIngestionEvents(fechaDeCorteDeRetencion(), {
    organizationId: orgId,
  });

  assert.equal(count, 1);
  assert.equal(await existe(duplicadoViejo), null);
});

// ---------------------------------------------------------------------------
// El dry-run del script. Que cuente lo mismo que borra no es una obviedad:
// son dos llamadas distintas, y si cada una armara su propio filtro el número
// que alguien mira antes de ejecutar no sería el de lo que se va a borrar.
// ---------------------------------------------------------------------------

test("--dry-run cuenta exactamente lo que la purga borraría, y no borra nada", async () => {
  const procesadoViejo = await crearEvento(IngestionStatus.PROCESSED, VIEJO);
  await crearEvento(IngestionStatus.FAILED, VIEJO);

  const corte = fechaDeCorteDeRetencion();
  const scope = { organizationId: orgId };

  const contados = await countIngestionEventsPurgables(corte, scope);
  assert.equal(contados, 1);

  // Sigue estando: contar no borra.
  assert.ok(await existe(procesadoViejo), "el dry-run no puede borrar nada");

  const { count } = await purgeIngestionEvents(corte, scope);
  assert.equal(count, contados, "el conteo del dry-run y el borrado real coinciden");
  assert.equal(await existe(procesadoViejo), null);
});

// ---------------------------------------------------------------------------
// El corte. Verifica la aritmética de fechaDeCorteDeRetencion contra la
// política declarada, sin depender de la base.
// ---------------------------------------------------------------------------

test("el corte cae exactamente 90 días antes del momento dado", () => {
  const ahora = new Date("2026-08-28T12:00:00.000Z");
  const corte = fechaDeCorteDeRetencion(ahora);

  assert.equal(corte.toISOString(), "2026-05-30T12:00:00.000Z");
  assert.equal(DIAS_DE_RETENCION_INGESTION_EVENT, 90);
});
