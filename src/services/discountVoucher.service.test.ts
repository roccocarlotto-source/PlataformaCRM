import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Contact, DiscountVoucher, Opportunity } from "@prisma/client";
import { AppError } from "../utils/AppError";
import {
  CUPON_NO_ENCONTRADO,
  CUPON_VENCIDO,
  CUPON_YA_CANJEADO,
  canjearDiscountVoucher,
  crearDiscountVoucher,
  estaVencido,
  getDiscountVoucherPublicState,
  type DependenciasDeCupones,
} from "./discountVoucher.service";

// ---------------------------------------------------------------------------
// Ítem 176: reglas del cupón de descuento sin base, con dobles de las
// dependencias. La atomicidad real del canje (dos requests a la vez) solo se
// puede probar contra Postgres: está en discountVoucher.integration-test.ts.
// ---------------------------------------------------------------------------

const ORG = randomUUID();
const USER = randomUUID();
const AHORA = new Date("2026-10-01T12:00:00.000Z");
const MANANA = new Date("2026-10-02T12:00:00.000Z");
const AYER = new Date("2026-09-30T12:00:00.000Z");

function cupon(extra: Partial<DiscountVoucher> = {}): DiscountVoucher {
  return {
    id: randomUUID(),
    organizationId: ORG,
    opportunityId: randomUUID(),
    contactId: randomUUID(),
    automationId: randomUUID(),
    label: "15% de descuento en el taller",
    status: "ACTIVE",
    expiresAt: MANANA,
    consumedAt: null,
    consumedByUserId: null,
    createdAt: AYER,
    updatedAt: AYER,
    ...extra,
  };
}

interface Registro {
  insertados: unknown[];
  consumos: unknown[][];
}

// Por defecto todo existe y el UPDATE afecta una fila. Cada test pisa lo que
// necesita.
function dobles(
  over: Partial<DependenciasDeCupones> = {},
): DependenciasDeCupones & { registro: Registro } {
  const registro: Registro = { insertados: [], consumos: [] };
  return {
    registro,
    leerOportunidad: async (id) => ({ id }) as Opportunity,
    leerContacto: async (id) => ({ id }) as Contact,
    insertar: async (data) => {
      registro.insertados.push(data);
      return cupon(data);
    },
    leerCupon: async () => null,
    consumir: async (id, organizationId, userId, ahora) => {
      registro.consumos.push([id, organizationId, userId, ahora]);
      return cupon({ id, status: "CONSUMED", consumedAt: ahora, consumedByUserId: userId });
    },
    leerCuponPublico: async () => null,
    ahora: () => AHORA,
    ...over,
  };
}

async function rechazaCon(promesa: Promise<unknown>, status: number, mensaje: string) {
  await assert.rejects(promesa, (err: unknown) => {
    assert.ok(err instanceof AppError, `se esperaba AppError, vino ${String(err)}`);
    assert.equal(err.statusCode, status);
    assert.equal(err.message, mensaje);
    return true;
  });
}

// ---------------------------------------------------------------------------
// estaVencido
// ---------------------------------------------------------------------------

test("estaVencido: solo un ACTIVE con expiresAt ya pasado; un CONSUMED nunca es 'vencido'", () => {
  assert.equal(estaVencido({ status: "ACTIVE", expiresAt: AYER }, AHORA), true);
  assert.equal(estaVencido({ status: "ACTIVE", expiresAt: MANANA }, AHORA), false);
  // El borde cuenta como vencido: el UPDATE del repositorio exige
  // expiresAt > ahora, y los dos lados tienen que coincidir.
  assert.equal(estaVencido({ status: "ACTIVE", expiresAt: AHORA }, AHORA), true);
  assert.equal(estaVencido({ status: "CONSUMED", expiresAt: AYER }, AHORA), false);
});

// ---------------------------------------------------------------------------
// crearDiscountVoucher
// ---------------------------------------------------------------------------

test("crearDiscountVoucher inserta con la organización y el label recortado", async () => {
  const deps = dobles();
  const input = {
    automationId: randomUUID(),
    opportunityId: randomUUID(),
    contactId: randomUUID(),
    label: "  15% de descuento en el taller  ",
    expiresAt: MANANA,
  };
  const creado = await crearDiscountVoucher(ORG, input, deps);

  assert.deepEqual(deps.registro.insertados, [
    { ...input, organizationId: ORG, label: "15% de descuento en el taller" },
  ]);
  assert.equal(creado.status, "ACTIVE");
});

test("crearDiscountVoucher: oportunidad inexistente o de otra organización -> 400, sin insertar", async () => {
  const deps = dobles({ leerOportunidad: async () => null });
  await rechazaCon(
    crearDiscountVoucher(
      ORG,
      {
        automationId: randomUUID(),
        opportunityId: randomUUID(),
        contactId: randomUUID(),
        label: "x",
        expiresAt: MANANA,
      },
      deps,
    ),
    400,
    "El opportunityId indicado no existe, no pertenece a tu organización, o está eliminado",
  );
  assert.equal(deps.registro.insertados.length, 0);
});

test("crearDiscountVoucher: contacto inexistente o de otra organización -> 400, sin insertar", async () => {
  const deps = dobles({ leerContacto: async () => null });
  await rechazaCon(
    crearDiscountVoucher(
      ORG,
      {
        automationId: randomUUID(),
        opportunityId: randomUUID(),
        contactId: randomUUID(),
        label: "x",
        expiresAt: MANANA,
      },
      deps,
    ),
    400,
    "El contactId indicado no existe, no pertenece a tu organización, o está eliminado",
  );
  assert.equal(deps.registro.insertados.length, 0);
});

test("crearDiscountVoucher: label vacío o de más de 200 caracteres -> 400, sin insertar", async () => {
  for (const label of ["   ", "x".repeat(201)]) {
    const deps = dobles();
    await assert.rejects(
      crearDiscountVoucher(
        ORG,
        {
          automationId: randomUUID(),
          opportunityId: randomUUID(),
          contactId: randomUUID(),
          label,
          expiresAt: MANANA,
        },
        deps,
      ),
      (err: unknown) => err instanceof AppError && err.statusCode === 400,
    );
    assert.equal(deps.registro.insertados.length, 0);
  }
});

// ---------------------------------------------------------------------------
// canjearDiscountVoucher — las cuatro ramas, más la carrera perdida
// ---------------------------------------------------------------------------

test("canje OK: ACTIVE y vigente -> consume con el usuario y la hora del canje", async () => {
  const activo = cupon();
  const deps = dobles({ leerCupon: async () => activo });

  const resultado = await canjearDiscountVoucher(ORG, activo.id, USER, deps);

  assert.deepEqual(deps.registro.consumos, [[activo.id, ORG, USER, AHORA]]);
  assert.equal(resultado.status, "CONSUMED");
  assert.equal(resultado.consumedByUserId, USER);
  assert.deepEqual(resultado.consumedAt, AHORA);
});

test("ya canjeado -> 409 con consumedAt en el detalle, sin intentar el UPDATE", async () => {
  const consumido = cupon({ status: "CONSUMED", consumedAt: AYER, consumedByUserId: USER });
  const deps = dobles({ leerCupon: async () => consumido });

  await assert.rejects(canjearDiscountVoucher(ORG, consumido.id, USER, deps), (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, CUPON_YA_CANJEADO);
    assert.deepEqual(err.details, { consumedAt: AYER.toISOString() });
    return true;
  });
  assert.equal(deps.registro.consumos.length, 0);
});

test("vencido (ACTIVE con expiresAt pasado) -> 409 'venció' y NO lo marca consumido", async () => {
  const vencido = cupon({ expiresAt: AYER });
  const deps = dobles({ leerCupon: async () => vencido });

  await rechazaCon(canjearDiscountVoucher(ORG, vencido.id, USER, deps), 409, CUPON_VENCIDO);
  assert.equal(deps.registro.consumos.length, 0, "un vencido sigue siendo vencido, no consumido");
});

test("no existe o es de otra organización -> 404, sin intentar el UPDATE", async () => {
  const deps = dobles({ leerCupon: async () => null });

  await rechazaCon(canjearDiscountVoucher(ORG, randomUUID(), USER, deps), 404, CUPON_NO_ENCONTRADO);
  assert.equal(deps.registro.consumos.length, 0);
});

test("carrera perdida: el UPDATE afecta 0 filas -> se relee y es 409 'ya canjeado', nunca 500", async () => {
  const activo = cupon();
  let lecturas = 0;
  const deps = dobles({
    // Primera lectura: ACTIVE. Entre esa y el UPDATE, otro lo canjeó.
    leerCupon: async () => {
      lecturas += 1;
      return lecturas === 1
        ? activo
        : { ...activo, status: "CONSUMED", consumedAt: AHORA, consumedByUserId: randomUUID() };
    },
    consumir: async () => null,
  });

  await rechazaCon(canjearDiscountVoucher(ORG, activo.id, USER, deps), 409, CUPON_YA_CANJEADO);
  assert.equal(lecturas, 2, "releyó después del UPDATE fallido");
});

// ---------------------------------------------------------------------------
// getDiscountVoucherPublicState
// ---------------------------------------------------------------------------

test("estado público: ACTIVE / CONSUMED tal cual; ACTIVE vencido -> EXPIRED (derivado)", async () => {
  const casos = [
    [{ status: "ACTIVE", expiresAt: MANANA }, "ACTIVE"],
    [{ status: "CONSUMED", expiresAt: AYER }, "CONSUMED"],
    [{ status: "ACTIVE", expiresAt: AYER }, "EXPIRED"],
  ] as const;
  for (const [fila, esperado] of casos) {
    const deps = dobles({ leerCuponPublico: async () => ({ ...fila, label: "15% off" }) });
    assert.deepEqual(await getDiscountVoucherPublicState(randomUUID(), deps), {
      status: esperado,
      label: "15% off",
    });
  }
});

test("estado público: id inexistente o malformado -> null, y el malformado no toca la base", async () => {
  let consultas = 0;
  const deps = dobles({
    leerCuponPublico: async () => {
      consultas += 1;
      return null;
    },
  });
  assert.equal(await getDiscountVoucherPublicState(randomUUID(), deps), null);
  assert.equal(await getDiscountVoucherPublicState("no-es-un-uuid", deps), null);
  assert.equal(consultas, 1);
});
