import assert from "node:assert/strict";
import { test } from "node:test";
import { armarSystemPrompt } from "../../services/agentOrchestration.service";
import { reglasDelRubro } from "../../services/reglasDelRubro";
import { TOOLS_DE_TURNOS_DE_CLINICA } from "../toolsDeTurnos";
import {
  INSTRUCCION_SALUD,
  clasificarMensajeDeSalud,
  daIndicacionClinica,
} from "../guardrailsDeSalud";
import { TERMINO_DEL_CONTACTO } from "./rubro";
import { textosDeClinica } from "./textosDelAgente";

// ---------------------------------------------------------------------------
// Los textos del prompt de una clínica (docs/rubros.md §3.2, R11).
// ---------------------------------------------------------------------------

// Lo que en una clínica no se puede leer en el prompt.
const DE_AUTOS =
  /\bautos?\b|automotor|permuta|financ|veh[ií]cul|la unidad|unidades|stock|concesionari|test drive|reserve_vehicle|create_opportunity|vendedor/i;

function promptDeClinica(termino: "PACIENTE" | "CLIENTE", conGestionDeTurnos: boolean) {
  return armarSystemPrompt(
    { instructions: "Sos el asistente de Clínica Ejemplo.", tone: null, guardrails: {} },
    [],
    { ahora: new Date("2027-03-01T12:00:00Z"), zona: "America/Montevideo" },
    undefined,
    null,
    [],
    "WHATSAPP",
    [],
    null,
    reglasDelRubro("CLINICA").instruccionesDelPrompt,
    true,
    textosDeClinica(TERMINO_DEL_CONTACTO[termino], conGestionDeTurnos),
  );
}

test("el prompt de una clínica no menciona autos, permutas, financiación, vehículos ni «la unidad»", () => {
  for (const termino of ["PACIENTE", "CLIENTE"] as const) {
    for (const conGestion of [true, false]) {
      const prompt = promptDeClinica(termino, conGestion);
      assert.doesNotMatch(prompt, DE_AUTOS, `${termino}, gestión ${conGestion}`);
      const textos = textosDeClinica(TERMINO_DEL_CONTACTO[termino], conGestion);
      assert.doesNotMatch(textos.mensajeDeFugaBloqueada, DE_AUTOS);
      assert.doesNotMatch(textos.cierrePorTope, DE_AUTOS);
    }
  }
});

test("las descripciones de las tools de turnos tampoco hablan de autos", () => {
  for (const tool of Object.values(TOOLS_DE_TURNOS_DE_CLINICA)) {
    assert.doesNotMatch(JSON.stringify(tool.definition), DE_AUTOS, tool.definition.name);
  }
});

test("los textos usan el término del contacto de la organización", () => {
  assert.match(promptDeClinica("PACIENTE", true), /el paciente quiere ver, cambiar o cancelar/);
  const conCliente = promptDeClinica("CLIENTE", true);
  assert.match(conCliente, /el cliente quiere ver, cambiar o cancelar/);
  assert.doesNotMatch(
    textosDeClinica(TERMINO_DEL_CONTACTO.CLIENTE, true).soloLoQueTeConsta,
    /paciente/,
  );
});

test("la gestión de turnos va solo si se ofrecen sus tools, y la instrucción de salud sigue en el prompt", () => {
  const con = promptDeClinica("PACIENTE", true);
  const sin = promptDeClinica("PACIENTE", false);
  assert.match(con, /get_contact_bookings/);
  assert.match(con, /confirmá con el paciente/);
  assert.match(con, /nunca ofrezcas un turno de más/);
  assert.doesNotMatch(sin, /get_contact_bookings|reschedule_booking|cancel_booking/);
  for (const prompt of [con, sin]) assert.ok(prompt.includes(INSTRUCCION_SALUD));
});

test("los textos de clínica no contradicen los guardrails de salud: ninguno da una indicación clínica ni dispara una regla", () => {
  for (const termino of ["PACIENTE", "CLIENTE"] as const) {
    const textos = textosDeClinica(TERMINO_DEL_CONTACTO[termino], true);
    for (const [clave, texto] of Object.entries(textos)) {
      if (texto === null) continue;
      assert.equal(daIndicacionClinica(texto), false, clave);
      assert.equal(clasificarMensajeDeSalud(texto), "NINGUNO", clave);
      // Nada que habilite a hablar de salud.
      assert.doesNotMatch(
        texto,
        /diagn[oó]stic|s[ií]ntoma|tratamiento|medicaci[oó]n|dosis/i,
        clave,
      );
    }
  }
});
