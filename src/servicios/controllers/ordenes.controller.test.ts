import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actualizarOrdenSchema,
  aprobacionSchema,
  cambiarEstadoSchema,
  crearOrdenSchema,
  listarOrdenesQuerySchema,
} from "./ordenes.controller";

// La frontera de validación de las órdenes, sin base ni HTTP.

const UUID = "11111111-1111-4111-8111-111111111111";

test("alta: solo nace en Agendado o Recibido", () => {
  for (const estado of ["AGENDADO", "RECIBIDO"]) {
    assert.ok(crearOrdenSchema.safeParse({ customerVehicleId: UUID, estado }).success, estado);
  }
  for (const estado of ["EN_TRABAJO", "ENTREGADO", "CANCELADO", "OTRO"]) {
    assert.ok(!crearOrdenSchema.safeParse({ customerVehicleId: UUID, estado }).success, estado);
  }
});

test("monto: no negativo, hasta dos decimales (con tolerancia de coma flotante); moneda ISO", () => {
  const base = { customerVehicleId: UUID, estado: "RECIBIDO" };
  assert.ok(crearOrdenSchema.safeParse({ ...base, amount: 0.29 }).success);
  assert.ok(crearOrdenSchema.safeParse({ ...base, amount: 1234.5 }).success);
  assert.ok(!crearOrdenSchema.safeParse({ ...base, amount: 1.234 }).success);
  assert.ok(!crearOrdenSchema.safeParse({ ...base, amount: -1 }).success);
  const r = crearOrdenSchema.safeParse({ ...base, amount: 1, currency: "uyu" });
  assert.ok(r.success);
  assert.equal(r.data.currency, "UYU");
  assert.ok(!crearOrdenSchema.safeParse({ ...base, currency: "PESOS" }).success);
});

test("editar: al menos un campo, y nada que no sea editable (el estado va por /estado)", () => {
  assert.ok(!actualizarOrdenSchema.safeParse({}).success);
  assert.ok(!actualizarOrdenSchema.safeParse({ status: "ENTREGADO" }).success);
  assert.ok(!actualizarOrdenSchema.safeParse({ branchId: UUID }).success);
  assert.ok(actualizarOrdenSchema.safeParse({ notes: "", assigneeId: null }).success);
});

test("estado: desde y hacia del enum, próximo service AAAA-MM-DD o null", () => {
  assert.ok(cambiarEstadoSchema.safeParse({ desde: "RECIBIDO", hacia: "EN_TRABAJO" }).success);
  assert.ok(!cambiarEstadoSchema.safeParse({ hacia: "EN_TRABAJO" }).success);
  assert.ok(
    cambiarEstadoSchema.safeParse({
      desde: "LISTO_PARA_RETIRAR",
      hacia: "ENTREGADO",
      proximoService: null,
    }).success,
  );
  assert.ok(
    !cambiarEstadoSchema.safeParse({
      desde: "LISTO_PARA_RETIRAR",
      hacia: "ENTREGADO",
      proximoService: "2027-02-30",
    }).success,
  );
  assert.ok(
    !cambiarEstadoSchema.safeParse({ desde: "RECIBIDO", hacia: "EN_TRABAJO", extra: 1 }).success,
  );
});

test("aprobación: cuándo dijo que sí no puede ser futura", () => {
  const base = {
    description: "Pastillas",
    decision: "APROBADO",
    approverName: "El titular",
    channel: "TELEFONO",
  };
  assert.ok(aprobacionSchema.safeParse({ ...base, decidedAt: new Date().toISOString() }).success);
  const manana = new Date(Date.now() + 86_400_000).toISOString();
  assert.ok(!aprobacionSchema.safeParse({ ...base, decidedAt: manana }).success);
  assert.ok(
    !aprobacionSchema.safeParse({ ...base, channel: "MAIL", decidedAt: new Date() }).success,
  );
});

test("listado: estados separados por coma, tope de 200 por página", () => {
  const r = listarOrdenesQuerySchema.parse({ estados: "RECIBIDO,EN_TRABAJO", pageSize: "200" });
  assert.deepEqual(r.estados, ["RECIBIDO", "EN_TRABAJO"]);
  assert.ok(!listarOrdenesQuerySchema.safeParse({ estados: "RECIBIDO,NADA" }).success);
  assert.ok(!listarOrdenesQuerySchema.safeParse({ pageSize: "201" }).success);
});
