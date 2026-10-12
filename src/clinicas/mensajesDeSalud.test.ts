import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO,
  MENSAJE_DE_URGENCIA_POR_DEFECTO,
  incluyeUnTelefono,
  mensajeDeConsultaClinica,
  mensajeDeUrgencia,
} from "./config/mensajesDeSalud";
import { TERMINOS_DE_URGENCIA, clasificarMensajeDeSalud } from "./guardrailsDeSalud";
import { REGLAS_DE_CLINICA } from "./reglasDeClinica";
import {
  SALUD_DE_LA_CLINICA_POR_DEFECTO,
  type SaludDeLaClinica,
} from "./repositories/clinicSettings.repository";
import {
  MAX_TERMINOS_POR_LISTA,
  URGENCIA_SIN_TELEFONO,
  diferenciasDeSalud,
  normalizarMensajesDeSalud,
} from "./services/mensajesDeSalud.service";

// ---------------------------------------------------------------------------
// Mensajes de salud configurables por el ADMIN (docs/rubros.md §5.3, D11
// revisada el 2026-10-12), sin base ni red: la validación del PUT, el detector
// con los términos de la clínica y las reglas con lo configurado.
// ---------------------------------------------------------------------------

const VACIO: SaludDeLaClinica = SALUD_DE_LA_CLINICA_POR_DEFECTO;

function con(cambios: Partial<SaludDeLaClinica>): SaludDeLaClinica {
  return { ...VACIO, ...cambios };
}

function error400(fn: () => unknown, mensaje?: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    if (mensaje) assert.equal(err.message, mensaje);
    return true;
  });
}

test("los textos por defecto son los de antes, byte a byte", () => {
  assert.equal(
    mensajeDeUrgencia("Clínica Sol"),
    "Si es una urgencia, llamá ya al 911 o a tu servicio de emergencia móvil. Este chat no puede ayudarte con eso. Ya le avisamos al equipo de Clínica Sol.",
  );
  assert.equal(
    mensajeDeConsultaClinica("Clínica Sol"),
    "Esa consulta la tiene que ver un profesional. Por acá no podemos darte indicaciones médicas. Ya le pasamos tu mensaje al equipo de Clínica Sol para que te contacte.",
  );
});

test("el texto de la clínica reemplaza al por defecto, con {clinica} como única variable", () => {
  assert.equal(
    mensajeDeUrgencia("Clínica Sol", "Llamá al 105. Te escribimos desde {clinica}."),
    "Llamá al 105. Te escribimos desde Clínica Sol.",
  );
  assert.equal(
    mensajeDeConsultaClinica("Clínica Sol", "Te va a llamar un profesional."),
    "Te va a llamar un profesional.",
  );
});

test("incluyeUnTelefono: de 3 a 15 dígitos, con espacios o guiones", () => {
  for (const texto of [
    "llamá al 911",
    "Llamá al 105 ya",
    "0800 1234",
    "2487-1000",
    "+598 99 123 456",
  ]) {
    assert.equal(incluyeUnTelefono(texto), true, texto);
  }
  for (const texto of [
    "llamá a emergencias",
    "en 24 h",
    "sala 12",
    "tu servicio de emergencia móvil",
  ]) {
    assert.equal(incluyeUnTelefono(texto), false, texto);
  }
});

test("el mensaje de urgencia sin teléfono es un 400", () => {
  error400(
    () =>
      normalizarMensajesDeSalud(
        con({ urgencyMessageText: "Si es una urgencia, andá a la guardia más cercana ya." }),
      ),
    URGENCIA_SIN_TELEFONO,
  );
});

test("vacío o igual al texto por defecto se guarda como null (sigue el del código)", () => {
  const resultado = normalizarMensajesDeSalud(
    con({
      urgencyMessageText: `  ${MENSAJE_DE_URGENCIA_POR_DEFECTO}  `,
      clinicalMessageText: "   ",
    }),
  );
  assert.equal(resultado.urgencyMessageText, null);
  assert.equal(resultado.clinicalMessageText, null);
  assert.equal(
    normalizarMensajesDeSalud(con({ clinicalMessageText: MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO }))
      .clinicalMessageText,
    null,
  );
});

test("un texto muy corto o muy largo es un 400", () => {
  error400(() => normalizarMensajesDeSalud(con({ clinicalMessageText: "Muy corto" })));
  error400(() => normalizarMensajesDeSalud(con({ clinicalMessageText: "a".repeat(501) })));
});

test("los términos se normalizan, sin repetidos y sin los que ya están en el código", () => {
  const resultado = normalizarMensajesDeSalud(
    con({
      extraUrgencyTerms: ["Código Rojo", "codigo rojo", "no puedo respirar", "  "],
      extraClinicalTerms: ["¿Botox?", "rellenos*"],
    }),
  );
  // "no puedo respirar" ya es del código: no se duplica (ni se puede sacar).
  assert.deepEqual(resultado.extraUrgencyTerms, ["codigo rojo"]);
  // El asterisco no llega a ser comodín: normalizar saca los signos (y reduce
  // las letras repetidas, como en el mensaje).
  assert.deepEqual(resultado.extraClinicalTerms, ["botox", "relenos"]);
});

test("un término de menos de 4 letras, uno muy largo o más de 100 son un 400", () => {
  error400(() => normalizarMensajesDeSalud(con({ extraClinicalTerms: ["ojo"] })));
  error400(() => normalizarMensajesDeSalud(con({ extraClinicalTerms: ["abcdefghij ".repeat(6)] })));
  // Distintos también después de normalizar (que reduce "100" a "10"): dos
  // letras distintas al final.
  const letras = "abcdefghijklmnopqrstuvwxyz";
  const muchos = Array.from(
    { length: MAX_TERMINOS_POR_LISTA + 1 },
    (_, i) => `termino ${letras[Math.floor(i / 25)]}${letras[(i % 25) + 1]}`,
  );
  assert.equal(new Set(muchos).size, MAX_TERMINOS_POR_LISTA + 1);
  error400(() => normalizarMensajesDeSalud(con({ extraUrgencyTerms: muchos })));
});

test("el detector suma los términos de la clínica a los del código, nunca los reemplaza", () => {
  const deLaClinica = { urgencia: ["codigo rojo"], clinicos: ["botox"] };
  assert.equal(clasificarMensajeDeSalud("tenemos un código rojo", deLaClinica), "URGENCIA");
  assert.equal(clasificarMensajeDeSalud("¿hacen botox?", deLaClinica), "CLINICA");
  // Sin los términos de la clínica, las mismas frases no disparan.
  assert.equal(clasificarMensajeDeSalud("tenemos un código rojo"), "NINGUNO");
  assert.equal(clasificarMensajeDeSalud("¿hacen botox?"), "NINGUNO");
  // Los del código siguen disparando con términos de la clínica cargados.
  assert.equal(clasificarMensajeDeSalud("no puedo respirar", deLaClinica), "URGENCIA");
  assert.equal(clasificarMensajeDeSalud("me arde la cara", deLaClinica), "CLINICA");
  assert.ok(TERMINOS_DE_URGENCIA.length > 0);
});

test("las reglas de clínica mandan el texto configurado y disparan con los términos agregados", () => {
  const contexto = {
    nombreDeLaOrganizacion: "Clínica Sol",
    saludDeLaClinica: con({
      urgencyMessageText: "Llamá al 105 ahora. Avisamos a {clinica}.",
      clinicalMessageText: "Lo tiene que ver un profesional de {clinica}.",
      extraUrgencyTerms: ["codigo rojo"],
      extraClinicalTerms: ["botox"],
    }),
  };
  const [prioritaria] = REGLAS_DE_CLINICA.entradaPrioritaria;
  const [entrada] = REGLAS_DE_CLINICA.entrada;
  const [salida] = REGLAS_DE_CLINICA.salida;

  assert.equal(
    prioritaria(["es un código rojo"], contexto)?.mensaje,
    "Llamá al 105 ahora. Avisamos a Clínica Sol.",
  );
  assert.equal(
    prioritaria(["no puedo respirar"], contexto)?.mensaje,
    "Llamá al 105 ahora. Avisamos a Clínica Sol.",
  );
  assert.equal(
    entrada(["¿me ponen botox?"], contexto)?.mensaje,
    "Lo tiene que ver un profesional de Clínica Sol.",
  );
  // La capa 3 no es configurable, pero su mensaje es el de la clínica.
  assert.equal(
    salida("Tomá 500 mg cada 8 horas.", contexto)?.mensaje,
    "Lo tiene que ver un profesional de Clínica Sol.",
  );
  // Sin configuración: los textos por defecto.
  assert.equal(
    prioritaria(["no puedo respirar"], { nombreDeLaOrganizacion: "Clínica Sol" })?.mensaje,
    mensajeDeUrgencia("Clínica Sol"),
  );
  assert.equal(entrada(["¿me ponen botox?"], { nombreDeLaOrganizacion: "Clínica Sol" }), null);
});

test("diferenciasDeSalud: solo los campos que cambiaron, con el antes y el después", () => {
  assert.deepEqual(diferenciasDeSalud(VACIO, VACIO), {});
  assert.deepEqual(
    diferenciasDeSalud(
      VACIO,
      con({ extraClinicalTerms: ["botox"], urgencyMessageText: "Llamá al 911." }),
    ),
    {
      urgencyMessageText: { antes: null, despues: "Llamá al 911." },
      extraClinicalTerms: { antes: [], despues: ["botox"] },
    },
  );
});
