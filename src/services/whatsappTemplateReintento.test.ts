import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ESPERAS_DEL_REINTENTO_EN_MINUTOS,
  SIN_ERROR_DE_SINCRONIZACION,
  resumenDeSincronizacion,
  siguienteEstadoDeSincronizacion,
  tipoDeError,
} from "./whatsappTemplateReintento";

const AHORA = new Date("2026-10-15T15:00:00.000Z");
const temporal = { tipo: "TEMPORAL" as const, mensaje: "No se pudo contactar a WhatsApp" };
const definitivo = { tipo: "DEFINITIVO" as const, mensaje: "Meta rechazó el pedido" };
const minutos = (d: Date | null) => (d ? (d.getTime() - AHORA.getTime()) / 60_000 : null);

test("tipoDeError: 5xx y 409 se reintentan; un 4xx de Meta no", () => {
  assert.equal(tipoDeError(502), "TEMPORAL");
  assert.equal(tipoDeError(503), "TEMPORAL");
  assert.equal(tipoDeError(409), "TEMPORAL");
  assert.equal(tipoDeError(400), "DEFINITIVO");
  assert.equal(tipoDeError(404), "DEFINITIVO");
});

test("temporal: espera creciente 5, 15, 45, 135 y 360 minutos, y después para", () => {
  let estado = { ...SIN_ERROR_DE_SINCRONIZACION };
  const vistas: (number | null)[] = [];
  for (let i = 0; i <= ESPERAS_DEL_REINTENTO_EN_MINUTOS.length; i++) {
    estado = siguienteEstadoDeSincronizacion(estado, temporal, AHORA, { reiniciar: i === 0 });
    vistas.push(minutos(estado.templateSyncNextAt));
  }
  assert.deepEqual(vistas, [5, 15, 45, 135, 360, 360, 360, null]);
  assert.equal(estado.templateSyncAttempts, 8);
  assert.equal(estado.templateSyncErrorKind, "TEMPORAL");
  // Del primer fallo al último intento: menos de 24 horas.
  assert.ok(ESPERAS_DEL_REINTENTO_EN_MINUTOS.reduce((a, b) => a + b, 0) < 24 * 60);
});

test("reiniciar (lo lanzó una persona) vuelve a empezar la cuenta", () => {
  const agotado = { ...SIN_ERROR_DE_SINCRONIZACION, templateSyncAttempts: 8 };
  const r = siguienteEstadoDeSincronizacion(agotado, temporal, AHORA, { reiniciar: true });
  assert.equal(r.templateSyncAttempts, 1);
  assert.equal(minutos(r.templateSyncNextAt), 5);
});

test("definitivo: sin próximo intento; éxito: todo limpio", () => {
  const previo = { ...SIN_ERROR_DE_SINCRONIZACION, templateSyncAttempts: 3 };
  const r = siguienteEstadoDeSincronizacion(previo, definitivo, AHORA, { reiniciar: false });
  assert.deepEqual(r, {
    templateSyncAttempts: 0,
    templateSyncNextAt: null,
    templateSyncError: "Meta rechazó el pedido",
    templateSyncErrorKind: "DEFINITIVO",
  });
  assert.deepEqual(
    siguienteEstadoDeSincronizacion(previo, null, AHORA, { reiniciar: false }),
    SIN_ERROR_DE_SINCRONIZACION,
  );
  // El motivo se corta a lo que entra en la columna.
  const largo = siguienteEstadoDeSincronizacion(
    previo,
    { tipo: "DEFINITIVO", mensaje: "x".repeat(800) },
    AHORA,
    { reiniciar: false },
  );
  assert.equal(largo.templateSyncError?.length, 500);
});

test("resumen para la pantalla: REINTENTANDO, DETENIDO, RECHAZADO o nada", () => {
  assert.equal(resumenDeSincronizacion(SIN_ERROR_DE_SINCRONIZACION), null);
  const reintentando = siguienteEstadoDeSincronizacion(
    SIN_ERROR_DE_SINCRONIZACION,
    temporal,
    AHORA,
    { reiniciar: true },
  );
  assert.deepEqual(resumenDeSincronizacion(reintentando), {
    estado: "REINTENTANDO",
    motivo: temporal.mensaje,
    proximoIntento: "2026-10-15T15:05:00.000Z",
  });
  assert.equal(
    resumenDeSincronizacion({ ...reintentando, templateSyncNextAt: null })?.estado,
    "DETENIDO",
  );
  assert.equal(
    resumenDeSincronizacion(
      siguienteEstadoDeSincronizacion(reintentando, definitivo, AHORA, { reiniciar: false }),
    )?.estado,
    "RECHAZADO",
  );
});
