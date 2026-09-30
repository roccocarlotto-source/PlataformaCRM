import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { logger } from "../lib/logger";
import {
  MAX_WAMIDS_RETENIDOS,
  RETENCION_MS,
  aplicarEstadosRetenidos,
  cantidadDeWamidsRetenidos,
  resetEstadosRetenidosParaTests,
  retenerEstado,
  type EstadoDeEntrega,
} from "./estadosDeEntregaRetenidos.service";

// ---------------------------------------------------------------------------
// D-15 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
// GitHub): los estados de entrega que llegan antes que su wamid se retienen y
// se aplican cuando el wamid se guarda. Sin base: `aplicar` es un doble.
// ---------------------------------------------------------------------------

const ORG = "org-a";
const T0 = 1_000_000;

afterEach(() => {
  resetEstadosRetenidosParaTests();
  mock.restoreAll();
});

function dobleDeAplicar(encontrados: Set<string>) {
  const llamadas: { organizationId: string; wamid: string; estado: EstadoDeEntrega }[] = [];
  const aplicar = async (organizationId: string, wamid: string, estado: EstadoDeEntrega) => {
    llamadas.push({ organizationId, wamid, estado });
    return { count: encontrados.has(`${organizationId}:${wamid}`) ? 1 : 0 };
  };
  return { aplicar, llamadas };
}

function espiarWarns() {
  const warns: { datos: Record<string, unknown>; mensaje: string }[] = [];
  mock.method(logger, "warn", (datos: Record<string, unknown>, mensaje: string) => {
    warns.push({ datos, mensaje });
  });
  return warns;
}

test("lo retenido se aplica, en el orden en que llegó, cuando se guarda el wamid; y sale del buffer", async () => {
  retenerEstado(ORG, "wamid.1", { status: "SENT" }, T0);
  retenerEstado(ORG, "wamid.1", { status: "DELIVERED" }, T0 + 10);
  const { aplicar, llamadas } = dobleDeAplicar(new Set([`${ORG}:wamid.1`]));

  const aplicados = await aplicarEstadosRetenidos(ORG, "wamid.1", aplicar, T0 + 20);

  assert.equal(aplicados, 2);
  assert.deepEqual(
    llamadas.map((l) => l.estado.status),
    ["SENT", "DELIVERED"],
  );
  assert.equal(cantidadDeWamidsRetenidos(), 0);
  // Otra vez: no queda nada.
  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.1", aplicar, T0 + 30), 0);
});

test("sin nada retenido para ese wamid, aplicar no consulta nada", async () => {
  const { aplicar, llamadas } = dobleDeAplicar(new Set());
  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.x", aplicar, T0), 0);
  assert.equal(llamadas.length, 0);
});

test("el buffer es por organización: el mismo wamid de otra organización no se toca", async () => {
  retenerEstado("org-b", "wamid.1", { status: "READ" }, T0);
  const { aplicar, llamadas } = dobleDeAplicar(new Set([`${ORG}:wamid.1`]));

  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.1", aplicar, T0), 0);
  assert.equal(llamadas.length, 0);
  assert.equal(cantidadDeWamidsRetenidos(), 1);
});

test("si todavía no encuentra el Message, vuelve al buffer con su vencimiento ORIGINAL", async () => {
  const warns = espiarWarns();
  retenerEstado(ORG, "wamid.1", { status: "DELIVERED" }, T0);
  const { aplicar } = dobleDeAplicar(new Set());

  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.1", aplicar, T0 + 1000), 0);
  assert.equal(cantidadDeWamidsRetenidos(), 1);

  // Vence a T0 + RETENCION_MS, no a "ahora + RETENCION_MS".
  retenerEstado(ORG, "otro", { status: "SENT" }, T0 + RETENCION_MS);
  assert.equal(cantidadDeWamidsRetenidos(), 1);
  assert.equal(warns.length, 1);
  assert.equal(warns[0].datos.wamid, "wamid.1");
});

test("un wamid que nunca se guarda se descarta al vencer, con un warn que dice cuál y qué estados", async () => {
  const warns = espiarWarns();
  retenerEstado(ORG, "wamid.huerfano", { status: "SENT" }, T0);
  retenerEstado(ORG, "wamid.huerfano", { status: "DELIVERED" }, T0 + 1);

  // Antes de vencer sigue ahí.
  retenerEstado(ORG, "wamid.nuevo", { status: "SENT" }, T0 + RETENCION_MS - 1);
  assert.equal(cantidadDeWamidsRetenidos(), 2);
  assert.equal(warns.length, 0);

  retenerEstado(ORG, "wamid.otro", { status: "SENT" }, T0 + RETENCION_MS);
  assert.equal(cantidadDeWamidsRetenidos(), 2);
  assert.equal(warns.length, 1);
  assert.deepEqual(warns[0].datos, {
    organizationId: ORG,
    wamid: "wamid.huerfano",
    estados: ["SENT", "DELIVERED"],
    motivo: "vencido",
  });
  assert.match(warns[0].mensaje, /no se guardó a tiempo/);
});

test("con el buffer lleno, un wamid nuevo descarta el más viejo, con un warn", async () => {
  const warns = espiarWarns();
  for (let i = 0; i < MAX_WAMIDS_RETENIDOS; i++) {
    retenerEstado(ORG, `wamid.${i}`, { status: "SENT" }, T0 + i);
  }
  assert.equal(cantidadDeWamidsRetenidos(), MAX_WAMIDS_RETENIDOS);
  assert.equal(warns.length, 0);

  retenerEstado(ORG, "wamid.nuevo", { status: "SENT" }, T0 + MAX_WAMIDS_RETENIDOS);

  assert.equal(cantidadDeWamidsRetenidos(), MAX_WAMIDS_RETENIDOS);
  assert.equal(warns.length, 1);
  assert.equal(warns[0].datos.wamid, "wamid.0");
  assert.equal(warns[0].datos.motivo, "tope");
  // El nuevo quedó, y el descartado ya no se aplica.
  const { aplicar } = dobleDeAplicar(new Set([`${ORG}:wamid.nuevo`, `${ORG}:wamid.0`]));
  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.nuevo", aplicar, T0 + 1), 1);
  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.0", aplicar, T0 + 1), 0);
});

test("un error de la base al aplicar no se propaga: el estado vuelve al buffer", async () => {
  mock.method(logger, "error", () => undefined);
  retenerEstado(ORG, "wamid.1", { status: "READ" }, T0);
  const aplicar = async () => {
    throw new Error("se cayó la base");
  };

  assert.equal(await aplicarEstadosRetenidos(ORG, "wamid.1", aplicar, T0 + 1), 0);
  assert.equal(cantidadDeWamidsRetenidos(), 1);
});
