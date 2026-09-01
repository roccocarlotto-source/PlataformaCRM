import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { checkHealth } from "./health.service";

// B-19 (docs/auditoria-2026-08-29.md; B-13 del 21/08) — /health tragaba el
// error de la base: el 503 salía bien, pero en el log no quedaba nada. Lo que
// se fija acá es que el error REAL llegue a logger.error, y que el camino
// feliz siga sin loguear nada.
//
// SIN BASE: se mockea prisma.$queryRaw directo sobre el singleton con
// node:test, mismo mecanismo que onboarding.service.integration-test.ts usa
// para $transaction, y el espía sobre logger.error es el de jwt.test.ts.
// checkHealth no tiene inyección de `db` —es la única consulta del módulo y
// abrir un parámetro solo para el test sería agregar superficie a un endpoint
// sin autenticación—, así que el mock del método es lo más chico que alcanza.
// Importar lib/prisma no conecta: PrismaClient abre el pool recién en la
// primera consulta, y acá esa consulta es justamente la mockeada.

interface Espias {
  consulta: ReturnType<typeof mock.method>;
  error: ReturnType<typeof mock.method>;
  restaurar: () => void;
}

function espiar(consulta: () => Promise<unknown>): Espias {
  const consultaMock = mock.method(prisma, "$queryRaw", consulta);
  const errorMock = mock.method(logger, "error", () => undefined);
  return {
    consulta: consultaMock,
    error: errorMock,
    restaurar: () => {
      consultaMock.mock.restore();
      errorMock.mock.restore();
    },
  };
}

test("B-19: si la base rechaza el SELECT 1, /health queda en error Y el error real va a logger.error", async () => {
  const caida = new Error("connect ECONNREFUSED 127.0.0.1:5432");
  const espias = espiar(() => Promise.reject(caida));
  try {
    const salud = await checkHealth();

    // El comportamiento observable de antes, sin cambios.
    assert.equal(salud.status, "error");
    assert.equal(salud.checks.database, "error");
    assert.equal(espias.consulta.mock.callCount(), 1);

    // Lo nuevo: el rastro en el log, con el error tal cual lo lanzó la base.
    assert.equal(espias.error.mock.callCount(), 1);
    const [payload, mensaje] = espias.error.mock.calls[0].arguments as [{ err: unknown }, string];
    assert.equal(payload.err, caida);
    assert.match(mensaje, /chequeo de salud/);
  } finally {
    espias.restaurar();
  }
});

test("B-19: con la base sana, /health está ok y NO se loguea ningún error", async () => {
  const espias = espiar(() => Promise.resolve([{ "?column?": 1 }]));
  try {
    const salud = await checkHealth();

    assert.equal(salud.status, "ok");
    assert.equal(salud.checks.database, "ok");
    assert.ok(salud.uptime >= 0);
    assert.ok(!Number.isNaN(Date.parse(salud.timestamp)));
    assert.equal(espias.error.mock.callCount(), 0);
  } finally {
    espias.restaurar();
  }
});
