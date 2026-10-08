import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationStatus, InquiryFollowUpKind, InquiryFollowUpStatus } from "@prisma/client";
import { TOKEN_SALUDO, TOKEN_VEHICULO } from "../../utils/whatsappTemplateText";
import {
  ACTION_INQUIRY_FOLLOW_UP,
  TEXTO_POR_DEFECTO,
  configDeSeguimientoDeConsultaSchema,
  crearAccionSeguimientoDeConsulta,
  tareaDeSeguimiento,
  tipoDeSeguimiento,
  vehiculoParaElMensaje,
  type ContactoParaSeguimiento,
  type DependenciasDelSeguimientoDeConsulta,
} from "./inquiryFollowUp";

// ---------------------------------------------------------------------------
// La acción inquiry.follow_up (ítem 185), sin base: las funciones puras y el
// handler con sus dependencias dobladas. El recorrido completo contra
// Postgres está en automationInquiryStalled.integration-test.ts.
// ---------------------------------------------------------------------------

const AHORA = new Date("2026-10-08T15:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function contacto(extra: Partial<ContactoParaSeguimiento> = {}): ContactoParaSeguimiento {
  return {
    id: "c1",
    firstName: "Martín",
    lastName: "Pérez",
    ownerId: "vendedor",
    deletedAt: null,
    noInterestAt: null,
    leadServiceOfInterest: null,
    vehicleOfInterest: { make: "Toyota", model: "Hilux", trim: "SRV", year: 2022 },
    ...extra,
  };
}

test("el texto por defecto pasa el schema; sin {saludo} o con {nombre} no", () => {
  assert.equal(
    configDeSeguimientoDeConsultaSchema.safeParse({ messageText: TEXTO_POR_DEFECTO }).success,
    true,
  );
  assert.ok(TEXTO_POR_DEFECTO.includes(TOKEN_SALUDO) && TEXTO_POR_DEFECTO.includes(TOKEN_VEHICULO));
  const sinSaludo = configDeSeguimientoDeConsultaSchema.safeParse({
    messageText: "Te escribimos por tu consulta. ¿Seguís interesado?",
  });
  assert.equal(sinSaludo.success, false);
  const conNombre = configDeSeguimientoDeConsultaSchema.safeParse({
    messageText: "Hola {nombre}, ¿seguís interesado?",
  });
  assert.equal(conNombre.success, false);
  assert.ok(
    !conNombre.success && conNombre.error.issues[0].message.includes(TOKEN_SALUDO),
    "el mensaje nombra las variables válidas",
  );
  // {vehiculo} es opcional.
  assert.equal(
    configDeSeguimientoDeConsultaSchema.safeParse({ messageText: "¡{saludo}! ¿Seguís interesado?" })
      .success,
    true,
  );
});

test("vehiculoParaElMensaje: la unidad de interés, si no lo último buscado, si no el genérico", () => {
  assert.equal(vehiculoParaElMensaje(contacto()), "Toyota Hilux SRV 2022");
  assert.equal(
    vehiculoParaElMensaje(
      contacto({ vehicleOfInterest: { make: "Fiat", model: "Cronos", trim: null, year: 2021 } }),
    ),
    "Fiat Cronos 2021",
  );
  assert.equal(
    vehiculoParaElMensaje(
      contacto({ vehicleOfInterest: null, leadServiceOfInterest: "una SUV automática" }),
    ),
    "una SUV automática",
  );
  assert.equal(
    vehiculoParaElMensaje(contacto({ vehicleOfInterest: null, leadServiceOfInterest: "  " })),
    "el vehículo que consultaste",
  );
});

test("tipoDeSeguimiento: WhatsApp manda, salvo que una persona atienda; los otros canales son tarea", () => {
  const derivada = { status: ConversationStatus.TRANSFERRED_TO_HUMAN };
  const activa = { status: ConversationStatus.ACTIVE };
  assert.equal(tipoDeSeguimiento("WHATSAPP", activa, false), InquiryFollowUpKind.WHATSAPP);
  // Derivada pero el humano todavía no escribió: el agente sigue atendiendo.
  assert.equal(tipoDeSeguimiento("WHATSAPP", derivada, false), InquiryFollowUpKind.WHATSAPP);
  assert.equal(tipoDeSeguimiento("WHATSAPP", derivada, true), InquiryFollowUpKind.TASK);
  assert.equal(tipoDeSeguimiento("MESSENGER", activa, false), InquiryFollowUpKind.TASK);
  assert.equal(tipoDeSeguimiento("INSTAGRAM", activa, false), InquiryFollowUpKind.TASK);
  assert.equal(tipoDeSeguimiento("WEB", activa, false), InquiryFollowUpKind.TASK);
  assert.equal(tipoDeSeguimiento("WHATSAPP", null, false), InquiryFollowUpKind.WHATSAPP);
});

test("tareaDeSeguimiento: el asunto con el nombre, el canal, los días, la unidad y los últimos mensajes del cliente", () => {
  const hace4 = new Date(AHORA.getTime() - 4 * DIA);
  const tarea = tareaDeSeguimiento(
    contacto(),
    "MESSENGER",
    [
      { content: "Hola", createdAt: new Date(hace4.getTime() - 3 * 60_000) },
      { content: "¿Tienen la Hilux?", createdAt: new Date(hace4.getTime() - 2 * 60_000) },
      { content: "¿Cuánto sale?", createdAt: new Date(hace4.getTime() - 60_000) },
      { content: "¿Aceptan permuta?", createdAt: hace4 },
    ],
    hace4,
    AHORA,
  );
  assert.equal(tarea.subject, "Seguimiento de consulta: Martín Pérez");
  assert.match(tarea.body, /Consultó por Messenger y hace 4 días que no responde\./);
  assert.match(tarea.body, /Le interesa: Toyota Hilux SRV 2022\./);
  // Solo los últimos tres, con su fecha.
  assert.doesNotMatch(tarea.body, /«Hola»/);
  assert.match(tarea.body, /2026-10-04: «¿Tienen la Hilux\?»/);
  assert.match(tarea.body, /«¿Aceptan permuta\?»/);

  // Sin nombre real: el asunto lo dice.
  const anonima = tareaDeSeguimiento(
    contacto({ firstName: "WhatsApp", lastName: "+59899000000" }),
    "WHATSAPP",
    [],
    new Date(AHORA.getTime() - DIA),
    AHORA,
  );
  assert.equal(anonima.subject, "Seguimiento de consulta: consulta sin identificar");
  assert.match(anonima.body, /hace 1 día que no responde/);
  assert.doesNotMatch(anonima.body, /Lo que preguntó/);
});

// ---------------------------------------------------------------------------
// El handler con dependencias dobladas
// ---------------------------------------------------------------------------

interface Registro {
  agendados: unknown[];
  tareas: unknown[];
}

function deps(extra: Partial<DependenciasDelSeguimientoDeConsulta> = {}): {
  deps: DependenciasDelSeguimientoDeConsulta;
  registro: Registro;
} {
  const registro: Registro = { agendados: [], tareas: [] };
  const base: DependenciasDelSeguimientoDeConsulta = {
    leerContacto: async () => contacto(),
    leerConversacion: async () => ({ status: ConversationStatus.ACTIVE, assignedUserId: null }),
    humanoHabloUltimo: async () => false,
    hayOportunidadAbierta: async () => false,
    respondioDespues: async () => false,
    mensajesDelCliente: async () => [{ content: "¿Cuánto sale?", createdAt: AHORA }],
    resolverAsignado: async (_org, candidatos) => candidatos.find((c) => c !== null) ?? "admin",
    agendar: async (data) => {
      registro.agendados.push(data);
      return true;
    },
    agendarYCrearTarea: async (data, tarea) => {
      registro.agendados.push(data);
      registro.tareas.push(tarea);
      return true;
    },
    ahora: () => AHORA,
    ...extra,
  };
  return { deps: base, registro };
}

const PAYLOAD = {
  contactId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  channel: "WHATSAPP",
  branchId: "33333333-3333-4333-8333-333333333333",
  ownerId: null,
  lastInboundAt: new Date(AHORA.getTime() - 4 * DIA).toISOString(),
};

function correr(
  d: DependenciasDelSeguimientoDeConsulta,
  payload: Record<string, unknown> = PAYLOAD,
) {
  return crearAccionSeguimientoDeConsulta(d).handler({
    organizationId: "org",
    automationId: "regla",
    config: { messageText: TEXTO_POR_DEFECTO },
    payload,
    outboxEventId: "44444444-4444-4444-8444-444444444444",
  });
}

test("la acción declara su trigger y su schema", () => {
  const accion = crearAccionSeguimientoDeConsulta(deps().deps);
  assert.equal(accion.actionType, ACTION_INQUIRY_FOLLOW_UP);
  assert.deepEqual(accion.triggers, ["contact.inquiry_stalled"]);
});

test("WhatsApp: agenda una fila PENDING kind WHATSAPP, sin tarea", async () => {
  const { deps: d, registro } = deps();
  await correr(d);
  assert.equal(registro.agendados.length, 1);
  assert.equal(registro.tareas.length, 0);
  assert.deepEqual(registro.agendados[0], {
    organizationId: "org",
    automationId: "regla",
    contactId: PAYLOAD.contactId,
    conversationId: PAYLOAD.conversationId,
    branchId: PAYLOAD.branchId,
    channel: "WHATSAPP",
    outboxEventId: "44444444-4444-4444-8444-444444444444",
    kind: InquiryFollowUpKind.WHATSAPP,
    lastInboundAt: new Date(PAYLOAD.lastInboundAt),
    scheduledFor: AHORA,
  });
});

test("Messenger: crea la tarea para el vendedor del contacto, con la fila SENT", async () => {
  const { deps: d, registro } = deps();
  await correr(d, { ...PAYLOAD, channel: "MESSENGER" });
  assert.equal(registro.tareas.length, 1);
  const tarea = registro.tareas[0] as { assigneeId: string; subject: string; dueDate: Date };
  assert.equal(tarea.assigneeId, "vendedor");
  assert.equal(tarea.subject, "Seguimiento de consulta: Martín Pérez");
  const fila = registro.agendados[0] as { kind: string; status: string; sentAt: Date };
  assert.equal(fila.kind, InquiryFollowUpKind.TASK);
  assert.equal(fila.status, InquiryFollowUpStatus.SENT);
  assert.equal(fila.sentAt, AHORA);
});

test("WhatsApp atendido por una persona: tarea para quien atiende, no un mensaje", async () => {
  const { deps: d, registro } = deps({
    leerConversacion: async () => ({
      status: ConversationStatus.TRANSFERRED_TO_HUMAN,
      assignedUserId: "la-persona",
    }),
    humanoHabloUltimo: async () => true,
  });
  await correr(d);
  assert.equal(registro.tareas.length, 1);
  assert.equal((registro.tareas[0] as { assigneeId: string }).assigneeId, "la-persona");
});

test("sin vendedor ni ADMIN a quien asignar la tarea: falla (queda en la ejecución de la regla)", async () => {
  const { deps: d } = deps({ resolverAsignado: async () => null });
  await assert.rejects(correr(d, { ...PAYLOAD, channel: "WEB" }), /no hay a quién asignarle/);
});

for (const [caso, extra] of [
  ["el contacto ya no existe", { leerContacto: async () => null }],
  ["está marcado sin interés", { leerContacto: async () => contacto({ noInterestAt: AHORA }) }],
  ["tiene una oportunidad abierta", { hayOportunidadAbierta: async () => true }],
  ["volvió a escribir", { respondioDespues: async () => true }],
] as const) {
  test(`no hace nada si ${caso}`, async () => {
    const { deps: d, registro } = deps(extra as Partial<DependenciasDelSeguimientoDeConsulta>);
    await correr(d);
    assert.equal(registro.agendados.length, 0);
    assert.equal(registro.tareas.length, 0);
  });
}

test("la reentrega del evento no duplica: agendar devuelve false y no se crea tarea", async () => {
  const { deps: d, registro } = deps({ agendarYCrearTarea: async () => false });
  await correr(d, { ...PAYLOAD, channel: "INSTAGRAM" });
  assert.equal(registro.tareas.length, 0);
});
