import assert from "node:assert/strict";
import { test } from "node:test";
import { WhatsappGraphError } from "./whatsappGraph.service";
import type { PlantillaConMeta } from "../repositories/whatsappTemplate.repository";
import {
  decidirSincronizacion,
  esAccionConPlantilla,
  esPlantillaInexistenteEnMeta,
  estadoLocalDeMeta,
  nombreDePlantillaNuevo,
  plantillaDeseada,
  resumenDeAprobacion,
} from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// Las decisiones puras del service de plantillas (ítem 160), sin base ni red:
// cómo se traduce el estado de Meta y qué error de Meta cuenta como "ya no
// existe". El flujo completo (guardar la regla, alta en Meta, promoción) va
// por HTTP en automationWhatsapp.integration-test.ts.
// ---------------------------------------------------------------------------

test("estadoLocalDeMeta: solo APPROVED, REINSTATED y FLAGGED mandan", () => {
  for (const estado of ["APPROVED", "REINSTATED", "FLAGGED", "approved"]) {
    assert.deepEqual(estadoLocalDeMeta(estado), { status: "APPROVED", rejectedReason: null });
  }
});

test("estadoLocalDeMeta: PENDING e IN_APPEAL siguen en revisión", () => {
  assert.deepEqual(estadoLocalDeMeta("PENDING"), { status: "PENDING", rejectedReason: null });
  assert.deepEqual(estadoLocalDeMeta("IN_APPEAL", "NONE"), {
    status: "PENDING",
    rejectedReason: null,
  });
});

test("estadoLocalDeMeta: REJECTED con el motivo de Meta; 'NONE' o vacío cuenta como sin motivo", () => {
  assert.deepEqual(estadoLocalDeMeta("REJECTED", "INVALID_FORMAT"), {
    status: "REJECTED",
    rejectedReason: "INVALID_FORMAT",
  });
  assert.deepEqual(estadoLocalDeMeta("REJECTED", "NONE"), {
    status: "REJECTED",
    rejectedReason: "Meta la rechazó sin dar un motivo",
  });
  assert.deepEqual(estadoLocalDeMeta("REJECTED", "  "), {
    status: "REJECTED",
    rejectedReason: "Meta la rechazó sin dar un motivo",
  });
});

test("estadoLocalDeMeta: pausada, deshabilitada o un estado desconocido NO manda, y dice cuál", () => {
  assert.deepEqual(estadoLocalDeMeta("PAUSED", "Calidad baja"), {
    status: "REJECTED",
    rejectedReason: "Meta la dejó en estado PAUSED (Calidad baja)",
  });
  assert.deepEqual(estadoLocalDeMeta("DISABLED"), {
    status: "REJECTED",
    rejectedReason: "Meta la dejó en estado DISABLED",
  });
  assert.equal(estadoLocalDeMeta("ALGO_NUEVO_DE_META").status, "REJECTED");
});

test("esPlantillaInexistenteEnMeta: 404, o un 400 que dice que no existe", () => {
  assert.equal(esPlantillaInexistenteEnMeta(new WhatsappGraphError(404, "")), true);
  assert.equal(
    esPlantillaInexistenteEnMeta(
      new WhatsappGraphError(
        400,
        JSON.stringify({
          error: { message: "Invalid parameter", error_user_msg: "Template not found" },
        }),
      ),
    ),
    true,
  );
});

test("esPlantillaInexistenteEnMeta: cualquier otro error sigue siendo un error", () => {
  assert.equal(esPlantillaInexistenteEnMeta(new WhatsappGraphError(401, "token vencido")), false);
  assert.equal(
    esPlantillaInexistenteEnMeta(new WhatsappGraphError(400, "Invalid parameter")),
    false,
  );
  assert.equal(esPlantillaInexistenteEnMeta(new WhatsappGraphError(503, "not found")), false);
  assert.equal(esPlantillaInexistenteEnMeta(new TypeError("fetch failed")), false);
});

// Ítem 181: solo las reglas que mandan un WhatsApp con plantilla llevan una.
test("esAccionConPlantilla: el QR y el cupón sí; cualquier otra acción no", () => {
  assert.equal(esAccionConPlantilla("opportunity.send_qr_followup"), true);
  assert.equal(esAccionConPlantilla("opportunity.send_discount_voucher"), true);
  assert.equal(esAccionConPlantilla("activity.create_follow_up"), false);
  assert.equal(esAccionConPlantilla("agent.draft_follow_up"), false);
  assert.equal(esAccionConPlantilla(""), false);
});

// ---------------------------------------------------------------------------
// La plantilla integrada a la regla: qué pide la regla, qué hacer con las que
// ya tiene, y el único estado que ve la pantalla.
// ---------------------------------------------------------------------------

const TEXTO_LINK = "Hola {nombre}, gracias. Tu opinión: {link} ¡Gracias!";
const TEXTO_IMAGEN = "Hola {nombre}, te dejamos el QR. ¡Gracias!";

function plantilla(extra: Partial<PlantillaConMeta> = {}): PlantillaConMeta {
  return {
    id: "p1",
    automationId: "regla",
    name: "seguimiento_qr_1",
    language: "es_AR",
    bodyText: TEXTO_LINK,
    headerFormat: "NONE",
    status: "APPROVED",
    rejectedReason: null,
    metaTemplateId: "123",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

const SIN_NADA = { aprobada: null, candidata: null };

test("plantillaDeseada: el formato decide el encabezado; sin messageText vale el texto que ya tiene", () => {
  assert.deepEqual(
    plantillaDeseada({ whatsappFormat: "IMAGE", messageText: TEXTO_IMAGEN }, SIN_NADA),
    {
      bodyText: TEXTO_IMAGEN,
      headerFormat: "IMAGE",
    },
  );
  assert.deepEqual(
    plantillaDeseada({ whatsappFormat: "LINK_AND_IMAGE", messageText: TEXTO_LINK }, SIN_NADA),
    { bodyText: TEXTO_LINK, headerFormat: "IMAGE" },
  );
  // Regla vieja: sin formato ni texto, es "solo link" con el texto aprobado.
  assert.deepEqual(
    plantillaDeseada({ qrCodeId: "x" }, { aprobada: plantilla(), candidata: null }),
    {
      bodyText: TEXTO_LINK,
      headerFormat: "NONE",
    },
  );
  // Sin texto y sin plantillas: no hay con qué armarla.
  assert.equal(plantillaDeseada({}, SIN_NADA), null);
});

test("decidirSincronizacion: una regla vieja que se guarda igual NO pide otra aprobación", () => {
  const par = { aprobada: plantilla(), candidata: null };
  assert.deepEqual(decidirSincronizacion(par, { bodyText: TEXTO_LINK, headerFormat: "NONE" }), {
    accion: "NADA",
  });
});

test("decidirSincronizacion: cambiar formato o texto crea una versión nueva (la aprobada sigue)", () => {
  const par = { aprobada: plantilla(), candidata: null };
  assert.deepEqual(decidirSincronizacion(par, { bodyText: TEXTO_LINK, headerFormat: "IMAGE" }), {
    accion: "CREAR",
    descartarCandidata: false,
  });
  assert.deepEqual(
    decidirSincronizacion(par, {
      bodyText: "Hola {nombre}, otro texto: {link} chau",
      headerFormat: "NONE",
    }),
    { accion: "CREAR", descartarCandidata: false },
  );
  assert.deepEqual(
    decidirSincronizacion(SIN_NADA, { bodyText: TEXTO_LINK, headerFormat: "NONE" }),
    {
      accion: "CREAR",
      descartarCandidata: false,
    },
  );
});

test("decidirSincronizacion: la versión nueva ya en revisión no se duplica; otra distinta la reemplaza", () => {
  const candidata = plantilla({ id: "p2", status: "PENDING", headerFormat: "IMAGE" });
  const par = { aprobada: plantilla(), candidata };
  assert.deepEqual(decidirSincronizacion(par, { bodyText: TEXTO_LINK, headerFormat: "IMAGE" }), {
    accion: "NADA",
  });
  assert.deepEqual(decidirSincronizacion(par, { bodyText: TEXTO_IMAGEN, headerFormat: "IMAGE" }), {
    accion: "CREAR",
    descartarCandidata: true,
  });
});

test("decidirSincronizacion: volver a lo aprobado descarta la candidata; rechazada con el mismo texto, nada", () => {
  const par = {
    aprobada: plantilla(),
    candidata: plantilla({ id: "p2", status: "REJECTED", headerFormat: "IMAGE" }),
  };
  assert.deepEqual(decidirSincronizacion(par, { bodyText: TEXTO_LINK, headerFormat: "NONE" }), {
    accion: "DESCARTAR_CANDIDATA",
  });
  assert.deepEqual(decidirSincronizacion(par, { bodyText: TEXTO_LINK, headerFormat: "IMAGE" }), {
    accion: "NADA",
  });
});

test("resumenDeAprobacion: un solo estado, el de la versión más nueva, y si se sigue mandando la anterior", () => {
  assert.equal(resumenDeAprobacion(SIN_NADA).estado, "SIN_PLANTILLA");
  assert.deepEqual(resumenDeAprobacion({ aprobada: plantilla(), candidata: null }), {
    estado: "APROBADA",
    motivo: null,
    mandaLaAnterior: false,
    bodyText: TEXTO_LINK,
    formato: "LINK",
  });
  assert.deepEqual(
    resumenDeAprobacion({
      aprobada: plantilla(),
      candidata: plantilla({
        id: "p2",
        status: "PENDING",
        headerFormat: "IMAGE",
        bodyText: TEXTO_IMAGEN,
      }),
    }),
    {
      estado: "PENDIENTE",
      motivo: null,
      mandaLaAnterior: true,
      bodyText: TEXTO_IMAGEN,
      formato: "IMAGE",
    },
  );
  assert.deepEqual(
    resumenDeAprobacion({
      aprobada: null,
      candidata: plantilla({
        status: "REJECTED",
        rejectedReason: "INVALID_FORMAT",
        headerFormat: "IMAGE",
      }),
    }),
    {
      estado: "RECHAZADA",
      motivo: "INVALID_FORMAT",
      mandaLaAnterior: false,
      bodyText: TEXTO_LINK,
      formato: "LINK_AND_IMAGE",
    },
  );
});

test("nombreDePlantillaNuevo: válido para Meta, distinto en cada versión, con la acción y la regla", () => {
  const regla = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";
  const uno = nombreDePlantillaNuevo("opportunity.send_qr_followup", regla);
  const otro = nombreDePlantillaNuevo("opportunity.send_qr_followup", regla);
  assert.match(uno, /^seguimiento_qr_5b0f7a4e_[0-9a-f]{8}$/);
  assert.notEqual(uno, otro);
  assert.match(
    nombreDePlantillaNuevo("opportunity.send_discount_voucher", regla),
    /^cupon_descuento_/,
  );
});
