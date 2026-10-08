import assert from "node:assert/strict";
import { test } from "node:test";
import { motivoDeCancelacion, saludoParaElCliente } from "./inquiryFollowUpWorker";

// Las funciones puras del worker de seguimientos de consultas (ítem 185). El
// envío de punta a punta está en automationInquiryStalled.integration-test.ts.

test("saludoParaElCliente: con nombre real o de perfil, 'Hola <nombre>'; provisorio o sin letras, 'Hola'", () => {
  assert.equal(saludoParaElCliente({ firstName: "Martín", lastName: "Pérez" }), "Hola Martín");
  // El perfil de WhatsApp de una palabra también es un nombre para saludar.
  assert.equal(saludoParaElCliente({ firstName: "Martín", lastName: "" }), "Hola Martín");
  assert.equal(saludoParaElCliente({ firstName: " Juancho 🚗 ", lastName: "" }), "Hola Juancho 🚗");
  for (const provisorio of [
    { firstName: "WhatsApp", lastName: "+59899123456" },
    { firstName: "Visitante", lastName: "caa2c873" },
    { firstName: "Messenger", lastName: "…08366039" },
    { firstName: "@usuario", lastName: "" },
    { firstName: "", lastName: "" },
    { firstName: ".", lastName: "" },
    { firstName: "🚗", lastName: "🚗" },
  ]) {
    assert.equal(saludoParaElCliente(provisorio), "Hola", JSON.stringify(provisorio));
  }
});

function fila(extra: {
  automation?: { isActive: boolean; deletedAt: Date | null };
  contact?: { deletedAt: Date | null; noInterestAt: Date | null };
  branch?: { deletedAt: Date | null };
}) {
  return {
    automation: extra.automation ?? { isActive: true, deletedAt: null },
    contact: {
      firstName: "Ana",
      lastName: "Gómez",
      phone: "+59899000000",
      source: null,
      deletedAt: null,
      noInterestAt: null,
      leadServiceOfInterest: null,
      vehicleOfInterest: null,
      ...extra.contact,
    },
    branch: extra.branch ?? { deletedAt: null },
  };
}

test("motivoDeCancelacion: cada razón, en orden, y null si sigue correspondiendo", () => {
  const sigue = { respondio: false, oportunidadAbierta: false };
  assert.equal(motivoDeCancelacion(fila({}), sigue), null);
  assert.match(
    motivoDeCancelacion(fila({ automation: { isActive: true, deletedAt: new Date() } }), sigue) ??
      "",
    /borró la automatización/,
  );
  assert.match(
    motivoDeCancelacion(fila({ automation: { isActive: false, deletedAt: null } }), sigue) ?? "",
    /desactivada/,
  );
  assert.match(
    motivoDeCancelacion(fila({ contact: { deletedAt: new Date(), noInterestAt: null } }), sigue) ??
      "",
    /borró el contacto/,
  );
  assert.match(
    motivoDeCancelacion(fila({ contact: { deletedAt: null, noInterestAt: new Date() } }), sigue) ??
      "",
    /sin interés/,
  );
  assert.match(
    motivoDeCancelacion(fila({ branch: { deletedAt: new Date() } }), sigue) ?? "",
    /sucursal/,
  );
  assert.match(
    motivoDeCancelacion(fila({}), { respondio: true, oportunidadAbierta: false }) ?? "",
    /volvió a escribir/,
  );
  assert.match(
    motivoDeCancelacion(fila({}), { respondio: false, oportunidadAbierta: true }) ?? "",
    /oportunidad abierta/,
  );
});
