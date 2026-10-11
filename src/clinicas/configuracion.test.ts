import assert from "node:assert/strict";
import { test } from "node:test";
import { CLINICA_HABILITADA, ROLES_POR_RUBRO, rubrosDisponibles } from "../config/ediciones";
import { VOCABULARIO_AUTOMOTORA, vocabularioDe } from "../config/vocabulario";
import {
  CONFIGURACION_DE_CLINICA_POR_DEFECTO,
  CONFIGURACION_DE_SEDE_POR_DEFECTO,
} from "./repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// Alta y configuración de la clínica (docs/rubros.md §15, R3), sin base: la
// llave, los rubros que se ofrecen, los roles por rubro y el vocabulario.
// ---------------------------------------------------------------------------

test("CLINICA_HABILITADA está en false: nadie puede crear una clínica a medias", () => {
  // Se pone en true en un PR posterior, a propósito y con este test cambiado.
  assert.equal(CLINICA_HABILITADA, false);
  assert.deepEqual(rubrosDisponibles(), ["AUTOMOTORA"]);
});

test("rubrosDisponibles: con la llave en true, AUTOMOTORA primero y después CLINICA", () => {
  assert.deepEqual(rubrosDisponibles(true), ["AUTOMOTORA", "CLINICA"]);
  assert.deepEqual(rubrosDisponibles(false), ["AUTOMOTORA"]);
});

test("ROLES_POR_RUBRO: una automotora admite los roles de hoy; una clínica, ADMIN y Recepción (R12)", () => {
  assert.deepEqual(ROLES_POR_RUBRO.AUTOMOTORA, ["ADMIN", "USER"]);
  assert.deepEqual(ROLES_POR_RUBRO.CLINICA, ["ADMIN", "RECEPCION"]);
});

test("los defaults del código son los de las columnas de la migración", () => {
  assert.deepEqual(CONFIGURACION_DE_CLINICA_POR_DEFECTO, {
    contactTerm: "PACIENTE",
    privacyNoticeText: null,
    privacyPolicyUrl: null,
  });
  assert.deepEqual(CONFIGURACION_DE_SEDE_POR_DEFECTO, {
    reminderHoursBefore: 24,
    lateBookingReminder: "NO_ENVIAR",
    lateBookingHoursBefore: 2,
    noResponseTaskHours: 4,
    minHoursToChangeBooking: null,
  });
});

test("vocabulario de una automotora: el mismo objeto con o sin término (no lo tiene)", () => {
  assert.equal(vocabularioDe("AUTOMOTORA", null), VOCABULARIO_AUTOMOTORA);
  assert.equal(vocabularioDe("AUTOMOTORA", "PACIENTE"), VOCABULARIO_AUTOMOTORA);
});

test("vocabulario de una clínica: paciente por defecto, cliente si lo eligió, y los términos del rubro", () => {
  const conPaciente = vocabularioDe("CLINICA", null);
  assert.deepEqual(conPaciente.contacto, {
    singular: "paciente",
    plural: "pacientes",
    singularTitulo: "Paciente",
    pluralTitulo: "Pacientes",
    genero: "masculino",
  });
  assert.equal(vocabularioDe("CLINICA", "PACIENTE").contacto.plural, "pacientes");
  assert.equal(vocabularioDe("CLINICA", "CLIENTE").contacto.pluralTitulo, "Clientes");
  assert.equal(conPaciente.recurso.pluralTitulo, "Profesionales");
  assert.equal(conPaciente.tipoDeServicio.pluralTitulo, "Prestaciones");
  assert.equal(conPaciente.reserva.pluralTitulo, "Turnos");
  assert.equal(conPaciente.agenda.singularTitulo, "Agenda");
  assert.equal(conPaciente.responsable.singularTitulo, "Responsable");
  assert.equal(conPaciente.marca, VOCABULARIO_AUTOMOTORA.marca);
});
