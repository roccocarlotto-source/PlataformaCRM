import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TEXTO_POR_DEFECTO,
  configDeSeguimientoDeConsultaDeClinicaSchema,
  configDeSeguimientoDeConsultaSchema,
  crearAccionSeguimientoDeConsulta,
  type ContactoParaSeguimiento,
  type DependenciasDelSeguimientoDeConsulta,
} from "../services/automationActions/inquiryFollowUp";
import { variablesDeLaAccion } from "../services/whatsappTemplate.service";
import { ACTION_INQUIRY_FOLLOW_UP } from "../services/automationActions/inquiryFollowUp";
import {
  TOKEN_PRESTACION,
  TOKEN_VEHICULO,
  VARIABLES_DE_CONSULTA,
  VARIABLES_DE_CONSULTA_DE_CLINICA,
} from "../utils/whatsappTemplateText";
import { motivoDeCancelacion } from "../workers/inquiryFollowUpWorker";
import {
  MOTIVO_TURNO_DEL_PACIENTE,
  TEXTO_POR_DEFECTO_DE_CLINICA,
  prestacionParaElMensaje,
} from "./seguimientoDeConsultas";

// ---------------------------------------------------------------------------
// R15 (docs/rubros.md §9.1), sin base: el seguimiento de consultas en una
// clínica. Contra Postgres: seguimientoConTurnos.integration-test.ts.
// ---------------------------------------------------------------------------

const AHORA = new Date("2027-03-01T15:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function contacto(): ContactoParaSeguimiento {
  return {
    id: "c1",
    firstName: "Ana",
    lastName: "Pérez",
    ownerId: "recepcion",
    deletedAt: null,
    noInterestAt: null,
    leadServiceOfInterest: "Limpieza facial",
    vehicleOfInterest: null,
  };
}

function deps(extra: Partial<DependenciasDelSeguimientoDeConsulta> = {}) {
  const registro = { agendados: [] as unknown[], tareas: [] as { body: string }[], frenos: 0 };
  const base: DependenciasDelSeguimientoDeConsulta = {
    leerContacto: async () => contacto(),
    leerConversacion: async () => ({ status: "ACTIVE", assignedUserId: null }),
    humanoHabloUltimo: async () => false,
    hayOportunidadAbierta: async () => false,
    respondioDespues: async () => false,
    mensajesDelCliente: async () => [],
    resolverAsignado: async (_o, candidatos) => candidatos.find((c) => c !== null) ?? "admin",
    agendar: async (data) => {
      registro.agendados.push(data);
      return true;
    },
    agendarYCrearTarea: async (data, tarea) => {
      registro.agendados.push(data);
      registro.tareas.push(tarea);
      return true;
    },
    esClinica: async () => true,
    turnoFrena: async () => {
      registro.frenos++;
      return false;
    },
    ahora: () => AHORA,
    ...extra,
  };
  return { deps: base, registro };
}

function correr(d: DependenciasDelSeguimientoDeConsulta, channel = "WHATSAPP") {
  return crearAccionSeguimientoDeConsulta(d).handler({
    organizationId: "org",
    automationId: "regla",
    config: { messageText: TEXTO_POR_DEFECTO_DE_CLINICA },
    payload: {
      contactId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      channel,
      branchId: "33333333-3333-4333-8333-333333333333",
      ownerId: null,
      lastInboundAt: new Date(AHORA.getTime() - 4 * DIA).toISOString(),
    },
    outboxEventId: "44444444-4444-4444-8444-444444444444",
  });
}

test("acción en una clínica: con un turno que frena, no agenda ni crea tarea", async () => {
  const { deps: d, registro } = deps({ turnoFrena: async () => true });
  await correr(d);
  await correr(d, "MESSENGER");
  assert.deepEqual(registro.agendados, []);
  assert.deepEqual(registro.tareas, []);
});

test("acción en una clínica sin turno: agenda, y la tarea nombra la prestación", async () => {
  const { deps: d, registro } = deps();
  await correr(d);
  assert.equal(registro.agendados.length, 1);
  await correr(d, "MESSENGER");
  assert.equal(registro.tareas.length, 1);
  assert.match(registro.tareas[0].body, /Le interesa: Limpieza facial\./);
  assert.doesNotMatch(registro.tareas[0].body, /vehículo/);
});

test("acción en una automotora: no lee turnos y la tarea es la de siempre", async () => {
  const { deps: d, registro } = deps({ esClinica: async () => false });
  await correr(d, "MESSENGER");
  assert.equal(registro.frenos, 0);
  assert.match(registro.tareas[0].body, /Le interesa: Limpieza facial\./);
});

test("schemas: la clínica acepta {prestacion} y no {vehiculo}; la automotora, el de siempre", () => {
  assert.equal(
    configDeSeguimientoDeConsultaDeClinicaSchema.safeParse({
      messageText: TEXTO_POR_DEFECTO_DE_CLINICA,
    }).success,
    true,
  );
  assert.equal(
    configDeSeguimientoDeConsultaDeClinicaSchema.safeParse({ messageText: TEXTO_POR_DEFECTO })
      .success,
    false,
  );
  assert.equal(
    configDeSeguimientoDeConsultaSchema.safeParse({ messageText: TEXTO_POR_DEFECTO }).success,
    true,
  );
  assert.equal(
    configDeSeguimientoDeConsultaSchema.safeParse({ messageText: TEXTO_POR_DEFECTO_DE_CLINICA })
      .success,
    false,
  );
  assert.equal(crearAccionSeguimientoDeConsulta(deps().deps).schemaPorRubro?.AUTOMOTORA, undefined);
});

test("variables de la plantilla por rubro: sin rubro, las de siempre", () => {
  assert.equal(variablesDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK"), VARIABLES_DE_CONSULTA);
  assert.equal(
    variablesDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK", "AUTOMOTORA"),
    VARIABLES_DE_CONSULTA,
  );
  assert.deepEqual(
    variablesDeLaAccion(ACTION_INQUIRY_FOLLOW_UP, "LINK", "CLINICA").map((v) => v.token),
    ["{saludo}", TOKEN_PRESTACION],
  );
  assert.ok(!VARIABLES_DE_CONSULTA_DE_CLINICA.some((v) => v.token === TOKEN_VEHICULO));
});

test("prestacionParaElMensaje y el motivo del worker", () => {
  assert.equal(prestacionParaElMensaje({ leadServiceOfInterest: " Peeling " }), "Peeling");
  assert.equal(prestacionParaElMensaje({ leadServiceOfInterest: null }), "lo que consultaste");
  assert.equal(prestacionParaElMensaje({ leadServiceOfInterest: "  " }), "lo que consultaste");
  const fila = {
    automation: { isActive: true, deletedAt: null },
    contact: {
      firstName: "Ana",
      lastName: "Pérez",
      phone: "+59899000000",
      source: null,
      deletedAt: null,
      noInterestAt: null,
      leadServiceOfInterest: null,
      vehicleOfInterest: null,
    },
    branch: { deletedAt: null },
  };
  const sigue = { respondio: false, oportunidadAbierta: false };
  assert.equal(motivoDeCancelacion(fila, sigue), null);
  assert.equal(motivoDeCancelacion(fila, { ...sigue, turnoDelPaciente: false }), null);
  assert.equal(
    motivoDeCancelacion(fila, { ...sigue, turnoDelPaciente: true }),
    MOTIVO_TURNO_DEL_PACIENTE,
  );
});
