import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin";
import { findRoleByName } from "../src/repositories/role.repository";
import { crearRegistroDeAcciones } from "../src/services/automationActions";
import { ACTION_SEND_QR_FOLLOWUP } from "../src/services/automationActions/sendQrFollowup";
import { registrarAutomatizaciones } from "../src/services/automationRegistrations";
import { TRIGGER_OPPORTUNITY_WON } from "../src/services/automationTriggers";
import { createOpportunity, updateOpportunity } from "../src/services/opportunity.service";
import { crearRegistroDeHandlers } from "../src/services/outboxHandlers";
import { createPipeline } from "../src/services/pipeline.service";
import { createStage } from "../src/services/stage.service";
import { soloDigitos } from "../src/services/whatsappContact.service";
import {
  cuerpoDePlantilla,
  sendWhatsappTemplateReal,
  WhatsappGraphError,
  type SendWhatsappTemplate,
  type SendWhatsappTemplateInput,
} from "../src/services/whatsappGraph.service";
import { esUrlDeBaseLocal, hostDeLaUrl } from "../src/utils/baseLocal";
import { drenarOutbox } from "../src/workers/outboxWorker";
import { drenarSeguimientosQr, type DepsDelSeguimiento } from "../src/workers/qrFollowUpWorker";

// ---------------------------------------------------------------------------
// Smoke test del seguimiento por WhatsApp con el QR (ítem 159 de
// docs/frontend-cambios-pendientes.md): el circuito REAL de envío, de punta a
// punta, contra el Supabase LOCAL y el número de prueba de Meta.
//
// QUÉ HACE, en orden:
//   1. Se niega a correr si DATABASE_URL/DIRECT_URL no apuntan a localhost.
//   2. Siembra una organización descartable: sucursal + agente con el
//      WHATSAPP_TEST_PHONE_NUMBER_ID (el número del que sale el mensaje),
//      contacto con WHATSAPP_TEST_RECIPIENT_PHONE (el ÚNICO destinatario
//      permitido), un QR de esa sucursal y una regla
//      opportunity.won -> opportunity.send_qr_followup con delayHours 0.
//   3. Crea una oportunidad con ese contacto y la pasa a WON por el service
//      (emite opportunity.won al outbox), drena el outbox acotado a la
//      organización (el dispatcher corre la regla, la acción agenda la fila).
//   4. Drena el worker de seguimientos con las dependencias REALES
//      (sendWhatsappTemplateReal), envuelto en un freno que aborta si el
//      destino o el número de origen no son los de prueba.
//   5. Muestra la fila de qr_follow_ups como quedó (SENT / FAILED con el
//      motivo que dio Meta) y desmonta la organización.
//
// PLANTILLA SIN VARIABLES (hello_world). Mientras la plantilla real no esté
// aprobada, WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_NAME apunta a la de muestra
// `hello_world`, que NO tiene variables. El worker manda siempre los dos
// parámetros del cuerpo ({{1}} nombre, {{2}} link del QR), así que con esa
// plantilla Meta contesta 400 #132000 ("number of parameters does not
// match") y la fila queda FAILED: ese 400 igual prueba que el worker llegó a
// Meta con el token y el número correctos. Para probar además que el mensaje
// LLEGA al teléfono, con --plantilla-sin-variables (o automáticamente si la
// plantilla se llama hello_world) el script hace antes un envío directo de la
// misma plantilla sin parámetros, con el mismo freno. Con la plantilla real
// aprobada, ese paso no hace falta y la fila termina en SENT.
//
// --dry-run: todo igual, pero el envío es un doble que imprime el cuerpo que
// habría viajado. No necesita ninguna variable WHATSAPP_*.
//
// NUNCA contra producción, NUNCA a otro número: el freno de la base y el del
// destinatario no se pueden apagar por flag.
// ---------------------------------------------------------------------------

const PREFIJO_SLUG = "smoke-qr-followup-";

interface Opciones {
  dryRun: boolean;
  plantillaSinVariables: boolean;
  destino: string;
}

function leerOpciones(argv: string[]): Opciones {
  const opciones: Opciones = {
    dryRun: false,
    plantillaSinVariables: false,
    destino: "https://g.page/r/ejemplo/review",
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opciones.dryRun = true;
    else if (arg === "--plantilla-sin-variables") opciones.plantillaSinVariables = true;
    else if (arg.startsWith("--destino=")) opciones.destino = arg.slice("--destino=".length);
    else throw new Error(`Opción desconocida: ${arg}`);
  }
  return opciones;
}

function assertBaseLocal(): void {
  for (const nombre of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const valor = process.env[nombre];
    if (!esUrlDeBaseLocal(valor)) {
      throw new Error(
        `ABORTADO: ${nombre} no apunta a una base local (host: ${hostDeLaUrl(valor) ?? "(no parseable o vacía)"}). Este script solo corre contra el Supabase local.`,
      );
    }
  }
}

interface ConfiguracionDePrueba {
  accessToken: string;
  phoneNumberId: string;
  destinatario: string;
  plantilla: { name: string; languageCode: string };
}

function leerVariable(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    throw new Error(`Falta ${nombre} en el entorno (sin --dry-run es obligatoria)`);
  }
  return valor;
}

function leerConfiguracion(opciones: Opciones): ConfiguracionDePrueba {
  if (opciones.dryRun) {
    return {
      accessToken: "token-de-prueba",
      phoneNumberId: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID?.trim() || "000000000000000",
      destinatario: process.env.WHATSAPP_TEST_RECIPIENT_PHONE?.trim() || "+5491155550000",
      plantilla: {
        name: process.env.WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_NAME?.trim() || "hello_world",
        languageCode: process.env.WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_LANGUAGE?.trim() || "en_US",
      },
    };
  }
  return {
    accessToken: leerVariable("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: leerVariable("WHATSAPP_TEST_PHONE_NUMBER_ID"),
    destinatario: leerVariable("WHATSAPP_TEST_RECIPIENT_PHONE"),
    plantilla: {
      name: leerVariable("WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_NAME"),
      languageCode: leerVariable("WHATSAPP_REVIEW_FOLLOWUP_TEMPLATE_LANGUAGE"),
    },
  };
}

// EL FRENO DEL DESTINATARIO. Envuelve el envío real: si el worker (o cualquier
// otra cosa) intentara mandar a un número que no es el de prueba, o desde un
// número que no es el de prueba, se aborta ANTES de tocar la red. No se puede
// apagar por flag.
function envioAcotado(
  config: ConfiguracionDePrueba,
  enviar: SendWhatsappTemplate,
): SendWhatsappTemplate {
  const destinoPermitido = soloDigitos(config.destinatario);
  return (input) => {
    if (input.to !== destinoPermitido) {
      return Promise.reject(
        new Error(
          `FRENO: el envío iba a ${input.to} y el único destinatario permitido es ${destinoPermitido} (WHATSAPP_TEST_RECIPIENT_PHONE)`,
        ),
      );
    }
    if (input.phoneNumberId !== config.phoneNumberId) {
      return Promise.reject(
        new Error(
          `FRENO: el envío salía del número ${input.phoneNumberId} y el único permitido es ${config.phoneNumberId} (WHATSAPP_TEST_PHONE_NUMBER_ID)`,
        ),
      );
    }
    return enviar(input);
  };
}

const envioSimulado: SendWhatsappTemplate = (input) => {
  console.log("  [dry-run] no se manda nada. Cuerpo que habría viajado a Meta:");
  console.log(
    `  ${JSON.stringify({ phoneNumberId: input.phoneNumberId, messaging_product: "whatsapp", ...cuerpoDePlantilla(input) })}`,
  );
  return Promise.resolve();
};

interface Escenario {
  organizationId: string;
  authUserId: string;
  userId: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  qrCodeId: string;
  automationId: string;
}

async function desmontarOrganizacion(organizationId: string, authUserId?: string) {
  const where = { organizationId };
  await prisma.qrFollowUp.deleteMany({ where });
  await prisma.automationExecution.deleteMany({ where });
  await prisma.automation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.qrCode.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  const usuarios = await prisma.user.findMany({ where, select: { id: true } });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: organizationId } });
  for (const id of new Set([...usuarios.map((u) => u.id), ...(authUserId ? [authUserId] : [])])) {
    await getSupabaseAdmin()
      .auth.admin.deleteUser(id)
      .catch(() => undefined);
  }
}

// Una corrida anterior que murió a mitad deja su organización (y su agente
// con el phoneNumberId, que es UNIQUE global): se limpia antes de sembrar.
async function limpiarCorridasAnteriores() {
  const viejas = await prisma.organization.findMany({
    where: { slug: { startsWith: PREFIJO_SLUG } },
    select: { id: true, slug: true },
  });
  for (const org of viejas) {
    console.log(`  limpiando la organización de una corrida anterior (${org.slug})`);
    await desmontarOrganizacion(org.id);
  }
}

async function sembrar(config: ConfiguracionDePrueba, opciones: Opciones): Promise<Escenario> {
  const adminRole = await findRoleByName("ADMIN");
  if (!adminRole) {
    throw new Error("No está sembrado el rol ADMIN: correr `npm run prisma:seed` primero.");
  }
  const sufijo = `${String(Date.now())}-${randomUUID().slice(0, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `[SMOKE] Seguimiento QR ${sufijo}`, slug: `${PREFIJO_SLUG}${sufijo}` },
  });
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email: `smoke-qr-followup-${sufijo}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de Supabase Auth: ${error?.message ?? "?"}`);
  }
  const user = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: adminRole.id,
      email: data.user.email ?? `smoke-${sufijo}@example.test`,
      fullName: "Admin smoke",
    },
  });
  const pipeline = await createPipeline(org.id, { name: "Ventas" });
  const stage = await createStage(org.id, { pipelineId: pipeline.id, name: "Contacto" });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Sucursal de prueba", timezone: "America/Montevideo" },
  });
  await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente de prueba",
      instructions: "Solo existe para tener el número de WhatsApp de la sucursal.",
      modelProvider: "openrouter",
      modelName: "smoke/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WHATSAPP"],
      whatsappPhoneNumberId: config.phoneNumberId,
    },
  });
  const qr = await prisma.qrCode.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      displayNumber: 1,
      name: "Reseñas de prueba",
      destinationUrl: opciones.destino,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Prueba",
      lastName: "Smoke",
      phone: config.destinatario,
    },
  });
  const automation = await prisma.automation.create({
    data: {
      organizationId: org.id,
      name: "[SMOKE] QR por WhatsApp al ganar",
      triggerType: TRIGGER_OPPORTUNITY_WON,
      actionType: ACTION_SEND_QR_FOLLOWUP,
      actionConfig: { qrCodeId: qr.id, delayHours: 0 },
    },
  });
  return {
    organizationId: org.id,
    authUserId: data.user.id,
    userId: user.id,
    pipelineId: pipeline.id,
    stageId: stage.id,
    contactId: contact.id,
    qrCodeId: qr.id,
    automationId: automation.id,
  };
}

function describirFallo(err: unknown): string {
  if (err instanceof WhatsappGraphError) {
    return `Meta contestó ${String(err.status)}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  assertBaseLocal();
  const config = leerConfiguracion(opciones);
  const sinVariables = opciones.plantillaSinVariables || config.plantilla.name === "hello_world";
  const enviar = envioAcotado(config, opciones.dryRun ? envioSimulado : sendWhatsappTemplateReal);

  console.log(
    `smoke-qr-followup-whatsapp ${opciones.dryRun ? "(DRY-RUN, sin red)" : "(ENVÍO REAL)"}`,
  );
  console.log(`  base:         ${hostDeLaUrl(process.env.DATABASE_URL) ?? "?"}`);
  console.log(`  origen:       phone_number_id ${config.phoneNumberId}`);
  console.log(`  destinatario: ${config.destinatario} (único permitido)`);
  console.log(`  plantilla:    ${config.plantilla.name} / ${config.plantilla.languageCode}`);
  console.log(`  QR destino:   ${opciones.destino}`);

  let ok = true;

  // Paso previo, solo con una plantilla sin variables: el envío directo que
  // prueba que el mensaje LLEGA (ver el encabezado).
  if (sinVariables) {
    console.log("");
    console.log(
      `1. Envío directo de la plantilla ${config.plantilla.name} SIN parámetros (prueba del circuito: token, número, destinatario)`,
    );
    const directo: SendWhatsappTemplateInput = {
      phoneNumberId: config.phoneNumberId,
      to: soloDigitos(config.destinatario),
      templateName: config.plantilla.name,
      languageCode: config.plantilla.languageCode,
      bodyParameters: [],
      accessToken: config.accessToken,
    };
    try {
      await enviar(directo);
      console.log(
        "  ✔ Meta aceptó el envío directo: el mensaje tiene que haber llegado al número de prueba",
      );
    } catch (err) {
      ok = false;
      console.log(`  ✘ falló el envío directo: ${describirFallo(err)}`);
    }
  }

  console.log("");
  console.log(
    `${sinVariables ? "2" : "1"}. Camino completo: oportunidad ganada -> outbox -> regla -> qr_follow_ups -> worker -> Meta`,
  );
  await limpiarCorridasAnteriores();
  const e = await sembrar(config, opciones);
  try {
    const handlers = crearRegistroDeHandlers();
    registrarAutomatizaciones({ acciones: crearRegistroDeAcciones(), handlers });

    const opp = await createOpportunity(e.organizationId, e.userId, {
      title: "[SMOKE] Venta de prueba",
      pipelineId: e.pipelineId,
      stageId: e.stageId,
      contactId: e.contactId,
    });
    await updateOpportunity(e.organizationId, e.userId, opp.id, { status: "WON" });
    const outbox = await drenarOutbox({ organizationId: e.organizationId, registro: handlers });
    console.log(`  outbox drenado: ${JSON.stringify(outbox)}`);

    const ejecuciones = await prisma.automationExecution.findMany({
      where: { automationId: e.automationId },
    });
    for (const ej of ejecuciones) {
      console.log(`  ejecución de la regla: ${ej.status}${ej.error ? ` — ${ej.error}` : ""}`);
    }

    const agendado = await prisma.qrFollowUp.findFirst({
      where: { organizationId: e.organizationId, opportunityId: opp.id },
    });
    if (!agendado) {
      throw new Error("La acción no agendó ninguna fila en qr_follow_ups");
    }
    console.log(
      `  agendado: status=${agendado.status} scheduledFor=${agendado.scheduledFor.toISOString()} attempts=${String(agendado.attempts)}`,
    );

    const deps: DepsDelSeguimiento = {
      accessToken: () => config.accessToken,
      plantilla: () => config.plantilla,
      // La real: el agente de la sucursal del QR.
      numeroDeLaSucursal: (organizationId, branchId) =>
        prisma.agent
          .findFirst({
            where: {
              organizationId,
              branchId,
              deletedAt: null,
              whatsappPhoneNumberId: { not: null },
            },
            select: { whatsappPhoneNumberId: true },
          })
          .then((a) => a?.whatsappPhoneNumberId ?? null),
      sendTemplate: enviar,
    };
    const resumen = await drenarSeguimientosQr({ organizationId: e.organizationId, deps });
    console.log(`  worker drenado: ${JSON.stringify(resumen)}`);

    const final = await prisma.qrFollowUp.findUniqueOrThrow({ where: { id: agendado.id } });
    console.log(
      `  fila final: status=${final.status} attempts=${String(final.attempts)} sentAt=${final.sentAt?.toISOString() ?? "-"}${final.lastError ? `\n  lastError: ${final.lastError}` : ""}`,
    );

    if (final.status === "SENT") {
      console.log(
        opciones.dryRun
          ? "  ✔ el camino completo funciona (el envío fue simulado)"
          : "  ✔ Meta aceptó el envío del worker: el mensaje tiene que haber llegado al número de prueba",
      );
    } else if (sinVariables && !opciones.dryRun && final.lastError?.includes("132000")) {
      console.log(
        "  ~ esperado con una plantilla sin variables: el worker llegó a Meta con el token y el número correctos, y Meta rechazó los dos parámetros del cuerpo (#132000). Con la plantilla real aprobada esta fila termina en SENT.",
      );
    } else {
      ok = false;
      console.log("  ✘ el worker no logró mandar el seguimiento");
    }
  } finally {
    await desmontarOrganizacion(e.organizationId, e.authUserId);
    console.log("  organización de prueba desmontada");
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((err: unknown) => {
    console.error(
      `\nsmoke-qr-followup-whatsapp: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
