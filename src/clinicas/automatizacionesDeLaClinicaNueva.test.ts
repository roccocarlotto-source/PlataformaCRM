import assert from "node:assert/strict";
import { test } from "node:test";
import { modulosDe } from "../config/ediciones";
import { crearRegistroDeAcciones } from "../services/automationActions";
import { registrarAutomatizaciones } from "../services/automationRegistrations";
import {
  CONFIG_DE_TRIGGER,
  MODULO_DEL_TRIGGER,
  esTriggerConocido,
} from "../services/automationTriggers";
import { crearRegistroDeHandlers } from "../services/outboxHandlers";
import { AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA } from "./automatizacionesDeLaClinicaNueva";
import { QR_DE_RESENA_REQUERIDO_PARA_ACTIVAR } from "./postTurno/acciones";
import { ACTION_BOOKING_SEND_QR_REVIEW } from "./postTurno/config";

// Las reglas con las que nace una clínica se escriben sin pasar por el CRUD
// (la organización todavía no está commiteada). Este test es lo que garantiza
// que cada una es exactamente lo que el CRUD habría guardado.

function registro() {
  const acciones = crearRegistroDeAcciones();
  registrarAutomatizaciones({ acciones, handlers: crearRegistroDeHandlers() });
  return acciones;
}

test("son las cinco del catálogo de clínica, una por acción", () => {
  assert.deepEqual(
    AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA.map((r) => [r.triggerType, r.actionType]),
    [
      ["booking.reminder_due", "booking.send_reminder"],
      ["booking.completed", "booking.send_qr_review"],
      ["booking.completed", "booking.schedule_control"],
      ["booking.completed", "activity.create_follow_up"],
      ["contact.inquiry_stalled", "inquiry.follow_up"],
    ],
  );
});

test("cada config es la que guardaría el CRUD de una clínica: pasa su schema sin cambiar", () => {
  const acciones = registro();
  for (const regla of AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA) {
    const accion = acciones.obtener(regla.actionType);
    assert.ok(accion, regla.actionType);
    assert.ok(
      accion.triggers === undefined ||
        (accion.triggers as readonly string[]).includes(regla.triggerType),
      `${regla.actionType} admite ${regla.triggerType}`,
    );
    const schema = accion.schemaPorRubro?.CLINICA ?? accion.schema;
    assert.deepEqual(schema.parse(regla.actionConfig), regla.actionConfig, regla.name);

    assert.ok(esTriggerConocido(regla.triggerType), regla.triggerType);
    assert.deepEqual(
      CONFIG_DE_TRIGGER[regla.triggerType].parse(regla.triggerConfig),
      regla.triggerConfig,
      regla.name,
    );
  }
});

test("las dos ediciones de clínica tienen los módulos de las cinco", () => {
  const acciones = registro();
  for (const edicion of ["ESENCIAL", "COMPLETA"] as const) {
    const modulos = modulosDe(edicion, "CLINICA");
    for (const regla of AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA) {
      const delAccion = acciones.obtener(regla.actionType)?.modulo;
      assert.ok(delAccion === undefined || modulos.has(delAccion), `${edicion}: ${regla.name}`);
      const delTrigger = esTriggerConocido(regla.triggerType)
        ? MODULO_DEL_TRIGGER[regla.triggerType]
        : undefined;
      assert.ok(delTrigger === undefined || modulos.has(delTrigger), `${edicion}: ${regla.name}`);
    }
  }
});

test("el QR de reseña nace sin QR: apagada vale, para prenderla falta elegirlo", () => {
  const qr = registro().obtener(ACTION_BOOKING_SEND_QR_REVIEW);
  const regla = AUTOMATIZACIONES_DE_LA_CLINICA_NUEVA.find(
    (r) => r.actionType === ACTION_BOOKING_SEND_QR_REVIEW,
  );
  assert.ok(qr?.faltaParaActivar && regla);
  assert.equal("qrCodeId" in regla.actionConfig, false);
  assert.equal(qr.faltaParaActivar(regla.actionConfig), QR_DE_RESENA_REQUERIDO_PARA_ACTIVAR);
  assert.equal(
    qr.faltaParaActivar({
      ...regla.actionConfig,
      qrCodeId: "11111111-1111-4111-8111-111111111111",
    }),
    null,
  );
});
