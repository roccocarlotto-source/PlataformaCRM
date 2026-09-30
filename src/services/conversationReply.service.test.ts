import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MENSAJE_CANAL_NO_SOPORTADO,
  MENSAJE_CERRADA,
  MENSAJE_VENTANA_VENCIDA,
  motivoDelFallo,
  motivoParaNoResponder,
  puedeAtenderLaConversacion,
} from "./conversationReply.service";
import { WhatsappGraphError } from "./whatsappGraph.service";
import {
  VENTANA_DE_WHATSAPP_MS,
  finDeLaVentanaDeWhatsapp,
  ventanaDeWhatsappAbierta,
} from "../utils/ventanaDeWhatsapp";

// Responder desde el CRM (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local): las reglas
// puras, con fechas fijas. El recorrido HTTP está en
// conversationReply.integration-test.ts.

const AHORA = new Date("2026-09-30T12:00:00.000Z");
const HORA = 60 * 60 * 1000;

test("permisos: un ADMIN atiende cualquiera, un USER solo la que tiene asignada", () => {
  const asignada = { assignedUserId: "u-1" };
  assert.equal(puedeAtenderLaConversacion({ userId: "a", role: "ADMIN" }, asignada), true);
  assert.equal(puedeAtenderLaConversacion({ userId: "u-1", role: "USER" }, asignada), true);
  assert.equal(puedeAtenderLaConversacion({ userId: "u-2", role: "USER" }, asignada), false);
  assert.equal(
    puedeAtenderLaConversacion({ userId: "u-1", role: "USER" }, { assignedUserId: null }),
    false,
    "una sin asignar no la toma un vendedor",
  );
});

test("la ventana dura 24 h desde el último mensaje del cliente", () => {
  const ultimo = new Date(AHORA.getTime() - 23 * HORA);
  const fin = finDeLaVentanaDeWhatsapp(ultimo);
  assert.equal(fin?.getTime(), ultimo.getTime() + VENTANA_DE_WHATSAPP_MS);
  assert.equal(ventanaDeWhatsappAbierta(fin, AHORA), true);
  assert.equal(
    ventanaDeWhatsappAbierta(fin, new Date(fin!.getTime())),
    false,
    "justo a las 24 h ya cerró",
  );
  assert.equal(finDeLaVentanaDeWhatsapp(null), null);
  assert.equal(
    ventanaDeWhatsappAbierta(null, AHORA),
    false,
    "sin mensaje del cliente no hay ventana",
  );
});

test("motivoParaNoResponder: cerrada, canal y ventana, en ese orden", () => {
  const abierta = new Date(AHORA.getTime() + HORA);
  const vencida = new Date(AHORA.getTime() - HORA);
  const wa = { channel: "WHATSAPP" as const, status: "TRANSFERRED_TO_HUMAN" as const };

  assert.equal(motivoParaNoResponder(wa, abierta, AHORA), null);
  assert.equal(motivoParaNoResponder({ ...wa, status: "ACTIVE" }, abierta, AHORA), null);
  assert.equal(motivoParaNoResponder(wa, vencida, AHORA), MENSAJE_VENTANA_VENCIDA);
  assert.equal(motivoParaNoResponder(wa, null, AHORA), MENSAJE_VENTANA_VENCIDA);
  assert.equal(
    motivoParaNoResponder({ ...wa, channel: "WEB" }, abierta, AHORA),
    MENSAJE_CANAL_NO_SOPORTADO,
  );
  assert.equal(
    motivoParaNoResponder({ ...wa, channel: "MESSENGER" }, abierta, AHORA),
    MENSAJE_CANAL_NO_SOPORTADO,
  );
  assert.equal(
    motivoParaNoResponder({ channel: "WEB", status: "CLOSED" }, vencida, AHORA),
    MENSAJE_CERRADA,
  );
});

test("motivoDelFallo: el texto de Meta si vino, si no el error tal cual", () => {
  const conMensaje = new WhatsappGraphError(
    400,
    JSON.stringify({
      error: { message: "Re-engagement message", error_user_msg: "Fuera de la ventana" },
    }),
  );
  assert.equal(motivoDelFallo(conMensaje), "Fuera de la ventana");
  assert.equal(
    motivoDelFallo(new WhatsappGraphError(500, "<html>")),
    "WhatsApp rechazó el mensaje (500)",
  );
  assert.match(motivoDelFallo(new Error("fetch failed")), /fetch failed/);
});
