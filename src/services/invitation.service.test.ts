import assert from "node:assert/strict";
import { test } from "node:test";
import { urlParaAceptarLaInvitacion } from "./invitation.service";

// Prueba de la Clínica Demo (2026-10-11): el mail de la invitación lleva a la
// pantalla que la acepta, en el dominio real del frontend (el primero de
// CORS_ORIGIN, igual que la invitación del primer administrador).
test("el mail de una invitación lleva a /invite/accept del primer origen del frontend", () => {
  assert.equal(
    urlParaAceptarLaInvitacion("https://crm.example.com, http://localhost:5173"),
    "https://crm.example.com/invite/accept",
  );
  assert.equal(
    urlParaAceptarLaInvitacion(" http://localhost:5173 "),
    "http://localhost:5173/invite/accept",
  );
});
