import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import type { ResumenDeActualizacion } from "./exchangeRate.service";
import { updateOrganizationCurrency } from "./organization.service";

// ---------------------------------------------------------------------------
// updateOrganizationCurrency contra Postgres real, con la búsqueda de
// cotización INYECTADA (§24 de docs/frontend-cambios-pendientes.md): guardar
// una moneda distinta de USD la dispara; guardar solo USD no; el service
// resuelve sin esperarla; y un fallo de la búsqueda no hace fallar el
// guardado ni sube al caller. El recorrido completo por HTTP, con la fuente
// stubbeada a nivel de fetch, está en organization.controller.integration-test.ts.
//
// La moneda de acá (ZX*) no la usa ningún otro archivo, y como la búsqueda
// está mockeada no se escribe ninguna fila en exchange_rates.
// ---------------------------------------------------------------------------

const MONEDA = "ZXA";

let orgId: string;

// Una promesa que resuelve o rechaza cuando el TEST lo decide, para fijar el
// orden de los eventos sin timers.
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (motivo: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

const dejarCorrer = () => new Promise<void>((resolve) => setImmediate(resolve));

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Org currency service ${randomUUID()}`,
      slug: `org-currency-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;
});

after(async () => {
  if (orgId) {
    await prisma.organization.delete({ where: { id: orgId } });
  }
});

test(
  "guardar una moneda distinta de USD dispara la búsqueda de cotización, y el service resuelve sin esperarla",
  // Si el service esperara la búsqueda, se colgaría acá: la promesa se libera
  // recién DESPUÉS de que devolvió. El tope convierte ese cuelgue en un fallo
  // legible en vez de una suite que no termina.
  { timeout: 5_000 },
  async () => {
    const busqueda = diferida<ResumenDeActualizacion>();
    const actualizar = mock.fn(() => busqueda.promesa);
    const infoLog = mock.method(logger, "info", () => undefined);
    try {
      const settings = await updateOrganizationCurrency(
        orgId,
        { preferredCurrency: MONEDA },
        { actualizarCotizaciones: actualizar },
      );

      assert.equal(actualizar.mock.callCount(), 1);
      assert.equal(settings.preferredCurrency, MONEDA);
      // Respondió con lo que había en la base en ese momento: la búsqueda
      // todavía no terminó (ni empezó a escribir).
      assert.deepEqual(settings.exchangeRates, []);

      busqueda.resolver({ actualizadas: 1, fallidas: 0 });
      await dejarCorrer();
    } finally {
      infoLog.mock.restore();
    }
  },
);

test("guardar solo USD, o des-configurar, no dispara ninguna búsqueda", async () => {
  const actualizar = mock.fn(() => Promise.resolve({ actualizadas: 0, fallidas: 0 }));

  const settings = await updateOrganizationCurrency(
    orgId,
    { preferredCurrency: "USD", alternateCurrency: null },
    { actualizarCotizaciones: actualizar },
  );

  assert.equal(settings.preferredCurrency, "USD");
  assert.equal(settings.alternateCurrency, null);
  assert.equal(actualizar.mock.callCount(), 0);
});

test("un fallo de la búsqueda no hace fallar el guardado ni se propaga al caller; queda logueado", async () => {
  const falla = new Error("se cayó la consulta de organizaciones");
  const errorLog = mock.method(logger, "error", () => undefined);
  try {
    const settings = await updateOrganizationCurrency(
      orgId,
      { alternateCurrency: MONEDA },
      { actualizarCotizaciones: () => Promise.reject(falla) },
    );

    // El guardado se hizo igual: en la respuesta y en la fila.
    assert.equal(settings.alternateCurrency, MONEDA);
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    assert.equal(row.alternateCurrency, MONEDA);

    await dejarCorrer();
    assert.equal(errorLog.mock.callCount(), 1);
    const [contexto] = errorLog.mock.calls[0].arguments as [{ err: unknown }];
    assert.equal(contexto.err, falla);
  } finally {
    errorLog.mock.restore();
  }
});
