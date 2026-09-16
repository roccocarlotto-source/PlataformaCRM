import "dotenv/config";
import {
  ActivityType,
  BookingStatus,
  ConnectionStatus,
  ConversationChannel,
  ConversationStatus,
  IngestionStatus,
  InvitationStatus,
  LeadUrgency,
  LifecycleStage,
  MessageDirection,
  MessageSenderType,
  OpportunityFinancingType,
  OpportunityLeadSource,
  OpportunityStatus,
  OutboxStatus,
  QrSubscriptionChangeSource,
  QrSubscriptionStatus,
  ResourceType,
  SourceType,
  VehicleBodyType,
  VehicleColorFinish,
  VehicleCondition,
  VehicleDrivetrain,
  VehicleFuelType,
  VehicleOrigin,
  VehiclePublicationCurrency,
  VehicleStatus,
  VehicleTransmission,
  VehicleWarranty,
  Weekday,
  AutomationExecutionStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Datos de prueba para el Supabase LOCAL — SOLO desarrollo.
//
// QUÉ HACE: cuelga de la organización `test-local` al menos una fila por cada
// valor de cada enum del schema, para probar la CRM a mano con todas las
// variantes a la vista. No es el producto cartesiano: por entidad se crean
// tantas filas como valores tiene su enum más grande, y los enums menores se
// reparten sobre esas mismas filas (Vehicle tiene 9 filas porque
// VehicleBodyType tiene 9 valores; sus otros diez enums caben en ellas).
//
// QUÉ NO ES: no es prisma/seed.ts. Ese carga el catálogo de roles y corre en
// cualquier entorno, incluido producción. Este no puede correr en producción
// bajo ninguna circunstancia, y por eso lo primero que hace es negarse si la
// base no está en localhost (ver assertBaseLocal).
//
// CÓMO SE ENCUENTRA DESPUÉS: el texto principal de cada fila (nombre, asunto,
// título, marca) empieza con "[SEED]". Las entidades sin texto propio
// (Booking, WorkingHours, OutboxEvent, QrSubscriptionStatusChange,
// AutomationExecution) se reconocen por lo que referencian, o por el
// eventType `seed.example` en el caso del outbox.
//
// POR QUÉ SERVICES Y NO SOLO PRISMA: donde el service aporta una regla que la
// base no conoce (el correlativo STK- de Vehicle, la regla de consignación y
// de garantía, el orden de Stage, el owner por defecto, el evento
// opportunity.won al outbox), se llama al service, así los datos quedan tan
// válidos como si los hubiera creado la app. Donde el service habla con un
// tercero (Invitation manda un email por Supabase, Booking refleja en Google)
// o donde el estado buscado solo existe por transición (CANCELLED, EXPIRED,
// DEAD_LETTER), se escribe con Prisma directo, respetando los CHECK de las
// migraciones.
// ---------------------------------------------------------------------------

const PREFIJO = "[SEED]";
const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost"]);
const ORG_SLUG = "test-local";
const ADMIN_EMAIL = "roccocarlotto@gmail.com";
const OUTBOX_SEED_EVENT_TYPE = "seed.example";

// Un PENDING de outbox/ingesta con next_attempt_at en el futuro lejano no lo
// reclama ningún worker (los dos filtran por coalesce(next_attempt_at,
// created_at) <= now()), así que la fila se queda PENDING aunque el servidor
// esté corriendo. Sin esto, el worker la procesaría en segundos y el estado
// desaparecería del listado.
const NUNCA = new Date("2099-01-01T00:00:00.000Z");

// ---------------------------------------------------------------------------
// FRENO DE SEGURIDAD. Corre antes de tocar Prisma y antes de cualquier insert.
// Se miran LAS DOS variables si están definidas: PrismaClient usa DATABASE_URL
// en runtime y DIRECT_URL para migraciones, y con que una apunte afuera
// alcanza para que este script no tenga nada que hacer acá. Se compara el
// hostname parseado, no un substring: una contraseña que contenga
// "localhost" no puede colar una URL remota.
// ---------------------------------------------------------------------------
function assertBaseLocal(): void {
  const candidatas = (["DIRECT_URL", "DATABASE_URL"] as const)
    .map((nombre) => ({ nombre, valor: process.env[nombre] }))
    .filter((v): v is { nombre: "DIRECT_URL" | "DATABASE_URL"; valor: string } =>
      Boolean(v.valor && v.valor.trim().length > 0),
    );

  if (candidatas.length === 0) {
    throw new Error(
      "ABORTADO: ni DIRECT_URL ni DATABASE_URL están definidas en el entorno. Este script solo corre contra el Supabase local.",
    );
  }

  for (const { nombre, valor } of candidatas) {
    let hostname: string;
    try {
      hostname = new URL(valor).hostname;
    } catch {
      throw new Error(
        `ABORTADO: ${nombre} no es una URL válida y no se puede comprobar que apunte a localhost.`,
      );
    }
    if (!HOSTS_LOCALES.has(hostname)) {
      throw new Error(
        `ABORTADO: ${nombre} apunta a "${hostname}", que no es 127.0.0.1 ni localhost. Este script es SOLO para el Supabase local y no va a ejecutar ningún insert contra esa base.`,
      );
    }
  }
}

try {
  assertBaseLocal();
} catch (err: unknown) {
  console.error(`seed-dev-data: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// Los imports del proyecto van DESPUÉS del freno a propósito. `import`
// estático se iza al tope del módulo, así que si estuvieran arriba se
// evaluarían (y src/config/env.ts validaría el entorno) antes de la
// comprobación. Con require dinámico el orden es el que se lee.
/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const { createBranch } =
  require("../src/services/branch.service") as typeof import("../src/services/branch.service");
const { createCompany } =
  require("../src/services/company.service") as typeof import("../src/services/company.service");
const { createPipeline } =
  require("../src/services/pipeline.service") as typeof import("../src/services/pipeline.service");
const { createStage } =
  require("../src/services/stage.service") as typeof import("../src/services/stage.service");
const { createContact, qualifyLead } =
  require("../src/services/contact.service") as typeof import("../src/services/contact.service");
const { createVehicle } =
  require("../src/services/vehicle.service") as typeof import("../src/services/vehicle.service");
const { createOpportunity } =
  require("../src/services/opportunity.service") as typeof import("../src/services/opportunity.service");
const { createActivity } =
  require("../src/services/activity.service") as typeof import("../src/services/activity.service");
const { createSource } =
  require("../src/services/source.service") as typeof import("../src/services/source.service");
const { createResource } =
  require("../src/services/resource.service") as typeof import("../src/services/resource.service");
const { createServiceType } =
  require("../src/services/serviceType.service") as typeof import("../src/services/serviceType.service");
const { replaceWorkingHoursForResource } =
  require("../src/services/workingHours.service") as typeof import("../src/services/workingHours.service");
const { createAgent } =
  require("../src/services/agent.service") as typeof import("../src/services/agent.service");
const { createAutomation } =
  require("../src/services/automation.service") as typeof import("../src/services/automation.service");
const { registrarAutomatizaciones } =
  require("../src/services/automationRegistrations") as typeof import("../src/services/automationRegistrations");
const { TRIGGER_OPPORTUNITY_WON } =
  require("../src/services/automationTriggers") as typeof import("../src/services/automationTriggers");
const { ACTION_CREATE_FOLLOW_UP } =
  require("../src/services/automationActions/createFollowUpActivity") as typeof import("../src/services/automationActions/createFollowUpActivity");
const { getCifrador } =
  require("../src/utils/encryption") as typeof import("../src/utils/encryption");
/* eslint-enable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// El valor i-ésimo de un enum, dando la vuelta: con N filas y un enum de M
// valores (M <= N), cada valor aparece al menos una vez.
function ciclo<T>(valores: readonly T[], i: number): T {
  return valores[i % valores.length];
}

function dias(n: number, desde = new Date()): Date {
  return new Date(desde.getTime() + n * 24 * 60 * 60 * 1000);
}

// Fecha de calendario sin hora (para los @db.Date).
function fecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// El próximo lunes (o el siguiente) a las 13:00Z = 10:00 en Montevideo, que
// cae dentro del horario 09:00–17:00 de WorkingHours y en la grilla de 60'.
function proximoDiaDeSemana(weekdayIso: number, semanasMas = 0): Date {
  const hoy = new Date();
  const base = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 13));
  const delta = ((weekdayIso - base.getUTCDay() + 7) % 7) + 7 * semanasMas || 7;
  return new Date(base.getTime() + delta * 24 * 60 * 60 * 1000);
}

const creados: Record<string, number> = {};
function contar(entidad: string, n = 1): void {
  creados[entidad] = (creados[entidad] ?? 0) + n;
}

// ---------------------------------------------------------------------------
// Semilla
// ---------------------------------------------------------------------------

async function main() {
  console.log("seed-dev-data — datos de prueba para el Supabase LOCAL");
  console.log(`  Organización: slug "${ORG_SLUG}"`);
  console.log("");

  // --- Organización y actor -----------------------------------------------
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org || org.deletedAt) {
    throw new Error(
      `ABORTADO: no existe la organización con slug "${ORG_SLUG}". Creala primero (POST /api/onboarding) y volvé a correr el script — este script no crea organizaciones.`,
    );
  }
  const organizationId = org.id;

  const admin = await prisma.user.findFirst({
    where: { organizationId, email: ADMIN_EMAIL, deletedAt: null, isActive: true },
    include: { role: true },
  });
  if (!admin || admin.role.name !== "ADMIN") {
    throw new Error(
      `ABORTADO: no hay un usuario ADMIN activo con email ${ADMIN_EMAIL} en la organización "${ORG_SLUG}".`,
    );
  }
  const adminId = admin.id;

  const roleUser = await prisma.role.findUnique({ where: { name: "USER" } });
  if (!roleUser) {
    throw new Error(
      "ABORTADO: falta el rol USER en el catálogo — corré `npm run prisma:seed` primero.",
    );
  }

  // No idempotente a propósito: volver a correrlo duplicaría filas (y el
  // pipeline chocaría por nombre). Se corta con un mensaje en vez de adivinar.
  const yaSembrado = await prisma.company.count({
    where: { organizationId, name: { startsWith: PREFIJO } },
  });
  if (yaSembrado > 0) {
    throw new Error(
      `ABORTADO: la organización "${ORG_SLUG}" ya tiene datos ${PREFIJO}. Borralos antes de volver a sembrar (buscá el prefijo ${PREFIJO} en cada tabla).`,
    );
  }

  // --- Sucursales (3: una por estado de GoogleCalendarConnection) ------------
  const sucursales = [];
  for (const nombre of ["Sucursal Centro", "Sucursal Este", "Sucursal Norte"]) {
    sucursales.push(
      await createBranch(organizationId, {
        name: `${PREFIJO} ${nombre}`,
        timezone: "America/Montevideo",
      }),
    );
    contar("Branch");
  }
  const sucursal = sucursales[0];

  // --- Empresas (2) ---------------------------------------------------------
  const empresas = [];
  for (const [i, nombre] of ["Automotora Sur SA", "Taller Norte SRL"].entries()) {
    empresas.push(
      await createCompany(organizationId, adminId, {
        name: `${PREFIJO} ${nombre}`,
        domain: `seed-${i + 1}.local`,
        industry: "Automotriz",
        city: "Montevideo",
        country: "Uruguay",
      }),
    );
    contar("Company");
  }

  // --- Pipeline y etapas ----------------------------------------------------
  const hayDefault = await prisma.pipeline.count({
    where: { organizationId, isDefault: true, deletedAt: null },
  });
  const pipeline = await createPipeline(organizationId, {
    name: `${PREFIJO} Pipeline Ventas`,
    isDefault: hayDefault === 0,
  });
  contar("Pipeline");

  const etapas = {} as Record<"nuevo" | "negociacion" | "ganada" | "perdida", { id: string }>;
  const defEtapas = [
    { clave: "nuevo", name: "Nuevo", probability: 10 },
    { clave: "negociacion", name: "Negociación", probability: 50 },
    { clave: "ganada", name: "Ganada", probability: 100, isWon: true },
    { clave: "perdida", name: "Perdida", probability: 0, isLost: true },
  ] as const;
  for (const e of defEtapas) {
    etapas[e.clave] = await createStage(organizationId, {
      pipelineId: pipeline.id,
      name: `${PREFIJO} ${e.name}`,
      probability: e.probability,
      isWon: "isWon" in e ? e.isWon : false,
      isLost: "isLost" in e ? e.isLost : false,
    });
    contar("Stage");
  }

  // --- Contactos (5: LifecycleStage; LeadUrgency sobre los 3 primeros) -------
  const nombres = ["Ana", "Bruno", "Carla", "Diego", "Elena"];
  const stagesDeContacto = Object.values(LifecycleStage);
  const urgencias = Object.values(LeadUrgency);
  const contactos = [];
  for (let i = 0; i < stagesDeContacto.length; i++) {
    const contacto = await createContact(organizationId, adminId, {
      firstName: `${PREFIJO} ${nombres[i]}`,
      lastName: "Prueba",
      email: `seed-${nombres[i].toLowerCase()}@seed.local`,
      phone: `+5989900000${i}`,
      jobTitle: "Comprador",
      lifecycleStage: stagesDeContacto[i],
      source: "seed",
      companyId: empresas[i % empresas.length].id,
    });
    if (i < urgencias.length) {
      await qualifyLead(organizationId, contacto.id, {
        urgency: urgencias[i],
        score: 30 + i * 30,
        intent: `${PREFIJO} interés en un usado`,
        notes: `${PREFIJO} calificado por el seed`,
      });
    }
    contactos.push(contacto);
    contar("Contact");
  }

  // --- Vehículos (9: VehicleBodyType; los otros diez enums ciclan) ----------
  const carrocerias = Object.values(VehicleBodyType);
  const marcas = [
    ["Toyota", "Corolla"],
    ["Volkswagen", "Golf"],
    ["Hyundai", "Tucson"],
    ["Ford", "Ranger"],
    ["BMW", "Serie 2"],
    ["Subaru", "Outback"],
    ["Renault", "Kangoo"],
    ["Fiat", "Fiorino"],
    ["Chevrolet", "Spin"],
  ];
  const vehiculos = [];
  for (let i = 0; i < carrocerias.length; i++) {
    const condition = ciclo(Object.values(VehicleCondition), i);
    const origin = ciclo(Object.values(VehicleOrigin), i);
    const warranty = ciclo(Object.values(VehicleWarranty), i);
    const usado = condition === "USED";
    const vehiculo = await createVehicle(organizationId, {
      condition,
      make: `${PREFIJO} ${marcas[i][0]}`,
      model: marcas[i][1],
      year: 2018 + i,
      branchId: sucursal.id,
      bodyType: carrocerias[i],
      status: ciclo(Object.values(VehicleStatus), i),
      origin,
      publicationCurrency: ciclo(Object.values(VehiclePublicationCurrency), i),
      transmission: ciclo(Object.values(VehicleTransmission), i),
      fuelType: ciclo(Object.values(VehicleFuelType), i),
      colorFinish: ciclo(Object.values(VehicleColorFinish), i),
      drivetrain: ciclo(Object.values(VehicleDrivetrain), i),
      warranty,
      warrantyOther: warranty === "OTHER" ? `${PREFIJO} garantía extendida 3 meses` : null,
      priceListUsd: 12000 + i * 1500,
      priceListLocal: (12000 + i * 1500) * 40,
      mileage: usado ? 45000 + i * 5000 : 0,
      licensePlate: usado ? `SEED${String(i).padStart(3, "0")}` : null,
      vin: `SEED0000000000${String(i).padStart(3, "0")}`,
      exteriorColor: ciclo(["Blanco", "Gris", "Negro", "Rojo"], i),
      doors: ciclo([4, 5, 2], i),
      seats: ciclo([5, 7, 2], i),
      stockEnteredAt: fecha(`2026-09-0${(i % 9) + 1}`),
      assignedSalespersonId: i % 2 === 0 ? adminId : null,
      internalNotes: `${PREFIJO} unidad de prueba nro ${i + 1}`,
      ...(origin === "CONSIGNMENT"
        ? {
            consignorName: `${PREFIJO} Consignante`,
            consignorPhone: "+59899000099",
            consignmentAgreedPriceUsd: 11000,
            consignmentCommissionPercent: 5,
          }
        : {}),
    });
    vehiculos.push(vehiculo);
    contar("Vehicle");
  }
  // El segundo AVAILABLE (i = 5) se vincula a la oportunidad abierta de abajo;
  // createOpportunity lo pasa a RESERVED, y el primero (i = 0) sigue AVAILABLE.
  const vehiculoParaVincular = vehiculos.find(
    (v, i) => i > 0 && v.status === VehicleStatus.AVAILABLE,
  );

  // --- Oportunidades (5: OpportunityLeadSource; status y financiación) -------
  const leadSources = Object.values(OpportunityLeadSource);
  const financiaciones = Object.values(OpportunityFinancingType);
  const defOportunidades = [
    { status: OpportunityStatus.OPEN, etapa: etapas.nuevo, titulo: "Corolla para Ana" },
    { status: OpportunityStatus.WON, etapa: etapas.ganada, titulo: "Golf vendido a Bruno" },
    { status: OpportunityStatus.LOST, etapa: etapas.perdida, titulo: "Tucson perdida con Carla" },
    { status: OpportunityStatus.OPEN, etapa: etapas.negociacion, titulo: "Ranger para Diego" },
    { status: OpportunityStatus.OPEN, etapa: etapas.nuevo, titulo: "Spin para Elena" },
  ];
  const oportunidades = [];
  for (const [i, def] of defOportunidades.entries()) {
    const oportunidad = await createOpportunity(organizationId, adminId, {
      title: `${PREFIJO} ${def.titulo}`,
      pipelineId: pipeline.id,
      stageId: def.etapa.id,
      status: def.status,
      amount: 15000 + i * 2000,
      currency: "USD",
      contactId: contactos[i].id,
      companyId: empresas[i % empresas.length].id,
      leadSource: leadSources[i],
      // Cuatro con financiación y una sin (null también es un estado visible).
      financingType: i < financiaciones.length ? financiaciones[i] : undefined,
      expectedCloseDate: def.status === "OPEN" ? dias(30) : undefined,
      actualCloseDate: def.status === "OPEN" ? undefined : dias(-2),
      lostReason: def.status === "LOST" ? `${PREFIJO} compró en otra automotora` : undefined,
      vehicleId: i === 0 && vehiculoParaVincular ? vehiculoParaVincular.id : undefined,
    });
    oportunidades.push(oportunidad);
    contar("Opportunity");
  }

  // --- Actividades (5: ActivityType) ----------------------------------------
  const tiposDeActividad = Object.values(ActivityType);
  for (const [i, type] of tiposDeActividad.entries()) {
    await createActivity(organizationId, adminId, {
      type,
      subject: `${PREFIJO} ${type} con ${nombres[i]}`,
      body: `${PREFIJO} actividad de prueba de tipo ${type}`,
      contactId: contactos[i].id,
      opportunityId: oportunidades[i].id,
      assigneeId: adminId,
      dueDate: type === "TASK" ? dias(3) : undefined,
      completedAt: type === "NOTE" ? new Date() : undefined,
    });
    contar("Activity");
  }

  // --- Invitaciones (4: InvitationStatus) -----------------------------------
  // Prisma directo: createInvitation manda el email por Supabase, y los
  // estados no PENDING solo existen por transición.
  for (const status of Object.values(InvitationStatus)) {
    await prisma.invitation.create({
      data: {
        organizationId,
        email: `seed-invitado-${status.toLowerCase()}@seed.local`,
        roleId: roleUser.id,
        invitedById: adminId,
        status,
        expiresAt: status === "EXPIRED" ? dias(-1) : dias(7),
        acceptedAt: status === "ACCEPTED" ? dias(-1) : null,
      },
    });
    contar("Invitation");
  }

  // --- Fuentes (3: SourceType) ----------------------------------------------
  // EXTERNAL_DB está pospuesto en el producto (ingestion-architecture §7) y el
  // controller no lo acepta; acá se crea inactivo solo para cubrir el valor.
  const fuentes = {} as Record<SourceType, { id: string }>;
  for (const type of Object.values(SourceType)) {
    fuentes[type] = await createSource(organizationId, {
      name: `${PREFIJO} Fuente ${type}`,
      type,
      isActive: type !== "EXTERNAL_DB",
    });
    contar("Source");
  }

  // --- Eventos de ingesta (5: IngestionStatus) ------------------------------
  for (const status of Object.values(IngestionStatus)) {
    await prisma.ingestionEvent.create({
      data: {
        organizationId,
        sourceId: fuentes.WEBHOOK.id,
        externalId: `${PREFIJO}-ingestion-${status}`,
        rawPayload: {
          seed: PREFIJO,
          firstName: `${PREFIJO} Lead ${status}`,
          email: `seed-lead-${status.toLowerCase()}@seed.local`,
        },
        status,
        nextAttemptAt: status === "PENDING" ? NUNCA : null,
        attempts: status === "DEAD_LETTER" ? 5 : status === "PENDING" ? 0 : 1,
        errorMessage: status === "FAILED" ? `${PREFIJO} email inválido` : null,
        lastError: status === "DEAD_LETTER" ? `${PREFIJO} agotó los reintentos` : null,
        promotedContactId: status === "PROCESSED" ? contactos[0].id : null,
      },
    });
    contar("IngestionEvent");
  }

  // --- Outbox (3: OutboxStatus) — solo agrega, nunca toca filas ajenas -------
  const outbox = {} as Record<OutboxStatus, { id: string }>;
  for (const status of Object.values(OutboxStatus)) {
    outbox[status] = await prisma.outboxEvent.create({
      data: {
        organizationId,
        eventType: OUTBOX_SEED_EVENT_TYPE,
        payload: { seed: PREFIJO, status },
        status,
        nextAttemptAt: status === "PENDING" ? NUNCA : null,
        attempts: status === "DEAD_LETTER" ? 5 : status === "PENDING" ? 0 : 1,
        lastError: status === "DEAD_LETTER" ? `${PREFIJO} no hay handler registrado` : null,
      },
    });
    contar("OutboxEvent");
  }

  // --- Recursos (3: ResourceType), servicio y horario semanal (7: Weekday) ---
  const recursos = {} as Record<ResourceType, { id: string }>;
  const nombresDeRecurso: Record<ResourceType, string> = {
    PERSON: "Vendedor de turno",
    ROOM: "Sala de entrega",
    CLASS: "Charla grupal",
  };
  for (const type of Object.values(ResourceType)) {
    recursos[type] = await createResource(organizationId, {
      branchId: sucursal.id,
      name: `${PREFIJO} ${nombresDeRecurso[type]}`,
      type,
    });
    contar("Resource");
  }

  const servicio = await createServiceType(organizationId, {
    branchId: sucursal.id,
    resourceId: recursos.PERSON.id,
    name: `${PREFIJO} Test drive`,
    durationMin: 60,
    capacity: 1,
  });
  contar("ServiceType");

  const franjas = await replaceWorkingHoursForResource(
    organizationId,
    recursos.PERSON.id,
    Object.values(Weekday).map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 })),
  );
  contar("WorkingHours", franjas.length);

  // --- Conexiones de Google Calendar (3: ConnectionStatus, una por sucursal) -
  // ACTIVE exige refresh_token NOT NULL (CHECK de la migración 20260829120000)
  // y la app lo descifra con SECRET_ENCRYPTION_KEY, así que se guarda un token
  // falso cifrado con la clave real: la primera llamada a Google fallará y la
  // conexión pasará a ERROR, que es exactamente lo que haría con un token
  // revocado. Va en la tercera sucursal para no interferir con las reservas de
  // la principal, que queda con una conexión REVOKED (= sin Google).
  const conexiones: Array<[ConnectionStatus, { id: string }]> = [
    [ConnectionStatus.REVOKED, sucursales[0]],
    [ConnectionStatus.ERROR, sucursales[1]],
    [ConnectionStatus.ACTIVE, sucursales[2]],
  ];
  for (const [status, branch] of conexiones) {
    await prisma.googleCalendarConnection.create({
      data: {
        organizationId,
        branchId: branch.id,
        status,
        calendarId: `${PREFIJO} primary`,
        refreshToken:
          status === "ACTIVE" ? getCifrador().encrypt(`${PREFIJO} refresh token falso`) : null,
        lastErrorAt: status === "ERROR" ? dias(-1) : null,
        lastErrorMessage: status === "ERROR" ? `${PREFIJO} invalid_grant simulado` : null,
      },
    });
    contar("GoogleCalendarConnection");
  }

  // --- Reservas (4: BookingStatus) ------------------------------------------
  // Prisma directo: createBooking exige un horario futuro y reflejaría en
  // Google; COMPLETED y NO_SHOW son, por definición, reservas pasadas. Los
  // horarios caen igual dentro del horario semanal y en la grilla de 60'.
  const reservas: Array<[BookingStatus, Date]> = [
    [BookingStatus.CONFIRMED, proximoDiaDeSemana(1)],
    [BookingStatus.CANCELLED, proximoDiaDeSemana(2)],
    [BookingStatus.COMPLETED, dias(-7, proximoDiaDeSemana(1))],
    [BookingStatus.NO_SHOW, dias(-7, proximoDiaDeSemana(2))],
  ];
  for (const [i, [status, startsAt]] of reservas.entries()) {
    await prisma.booking.create({
      data: {
        organizationId,
        branchId: sucursal.id,
        serviceTypeId: servicio.id,
        resourceId: recursos.PERSON.id,
        contactId: contactos[i].id,
        opportunityId: oportunidades[i].id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        status,
      },
    });
    contar("Booking");
  }

  // --- Agente, conversaciones (3) y mensajes (3) ----------------------------
  const agente = await createAgent(organizationId, {
    branchId: sucursal.id,
    name: `${PREFIJO} Agente Web`,
    goal: `${PREFIJO} calificar leads y agendar test drives`,
    instructions: `${PREFIJO} Sos el asistente de la automotora. Respondé en español rioplatense.`,
    tone: "cordial",
    modelProvider: "openrouter",
    modelName: "anthropic/claude-sonnet-4.5",
    enabledTools: ["create_lead", "get_availability"],
    channels: Object.values(ConversationChannel),
    guardrails: { maxTurns: 20 },
    allowedOrigins: [],
  });
  contar("Agent");

  const defConversaciones: Array<[ConversationChannel, ConversationStatus]> = [
    [ConversationChannel.WEB, ConversationStatus.ACTIVE],
    [ConversationChannel.WHATSAPP, ConversationStatus.TRANSFERRED_TO_HUMAN],
    [ConversationChannel.WEB, ConversationStatus.CLOSED],
  ];
  const conversaciones = [];
  for (const [i, [channel, status]] of defConversaciones.entries()) {
    conversaciones.push(
      await prisma.conversation.create({
        data: {
          organizationId,
          branchId: sucursal.id,
          agentId: agente.id,
          contactId: contactos[i].id,
          channel,
          status,
          assignedUserId: status === "TRANSFERRED_TO_HUMAN" ? adminId : null,
          externalThreadId: `${PREFIJO} thread ${i + 1}`,
          lastMessageAt: dias(-i),
        },
      }),
    );
    contar("Conversation");
  }

  // Los tres en la conversación activa: entra el contacto, contesta el agente,
  // remata una persona. HUMAN exige sender_user_id (CHECK de 20260912130000).
  const mensajes: Array<[MessageDirection, MessageSenderType, string]> = [
    [MessageDirection.INBOUND, MessageSenderType.CONTACT, "Hola, ¿tienen un Corolla usado?"],
    [MessageDirection.OUTBOUND, MessageSenderType.AGENT, "¡Hola! Sí, tenemos un Corolla 2018."],
    [MessageDirection.OUTBOUND, MessageSenderType.HUMAN, "Te escribo yo, Rocco, para coordinar."],
  ];
  for (const [direction, senderType, texto] of mensajes) {
    await prisma.message.create({
      data: {
        organizationId,
        conversationId: conversaciones[0].id,
        direction,
        senderType,
        senderUserId: senderType === "HUMAN" ? adminId : null,
        content: `${PREFIJO} ${texto}`,
      },
    });
    contar("Message");
  }

  // --- Cambios de suscripción QR (2: QrSubscriptionStatus y ChangeSource) ---
  // PLATFORM_ADMIN exige changed_by_platform_admin_id (CHECK de 20260903120000)
  // con FK a platform_admins. Si la base local no tiene ninguno, se registra
  // al ADMIN de la organización como platform admin — SOLO tiene sentido en
  // local, y se avisa. La organización no cambia de estado: solo se registra
  // el historial (INACTIVE → ACTIVE por webhook, ACTIVE → INACTIVE por admin).
  let platformAdmin = await prisma.platformAdmin.findFirst();
  if (!platformAdmin) {
    platformAdmin = await prisma.platformAdmin.create({ data: { userId: adminId } });
    contar("PlatformAdmin (creado para poder cubrir PLATFORM_ADMIN)");
  }
  const cambiosQr: Array<
    [QrSubscriptionStatus, QrSubscriptionStatus, QrSubscriptionChangeSource, string | null]
  > = [
    [
      QrSubscriptionStatus.INACTIVE,
      QrSubscriptionStatus.ACTIVE,
      QrSubscriptionChangeSource.MERCADOPAGO_WEBHOOK,
      null,
    ],
    [
      QrSubscriptionStatus.ACTIVE,
      QrSubscriptionStatus.INACTIVE,
      QrSubscriptionChangeSource.PLATFORM_ADMIN,
      platformAdmin.userId,
    ],
  ];
  for (const [previousStatus, newStatus, source, changedByPlatformAdminId] of cambiosQr) {
    await prisma.qrSubscriptionStatusChange.create({
      data: {
        organizationId,
        previousStatus,
        newStatus,
        source,
        changedByPlatformAdminId,
        reason: `${PREFIJO} cambio ${previousStatus} → ${newStatus} vía ${source}`,
      },
    });
    contar("QrSubscriptionStatusChange");
  }

  // --- Automatización (1) y ejecuciones (2: AutomationExecutionStatus) -----
  // El registro de acciones arranca vacío en cada proceso y lo llena
  // server.ts; acá se hace lo mismo para que createAutomation valide la regla
  // contra el catálogo real. Al quedar ACTIVA, cuando el servidor procese el
  // opportunity.won que emitió la oportunidad ganada de arriba, va a crear una
  // Activity "[SEED] Seguimiento post-venta" — es el motor funcionando, no un
  // efecto raro.
  registrarAutomatizaciones();
  const automatizacion = await createAutomation(organizationId, {
    name: `${PREFIJO} Seguimiento post-venta`,
    triggerType: TRIGGER_OPPORTUNITY_WON,
    actionType: ACTION_CREATE_FOLLOW_UP,
    actionConfig: { subject: `${PREFIJO} Seguimiento post-venta`, daysUntilDue: 3 },
  });
  contar("Automation");

  const ejecuciones: Array<[AutomationExecutionStatus, { id: string }, string | null]> = [
    [AutomationExecutionStatus.SUCCESS, outbox.PROCESSED, null],
    [AutomationExecutionStatus.FAILED, outbox.DEAD_LETTER, `${PREFIJO} fallo simulado`],
  ];
  for (const [status, evento, error] of ejecuciones) {
    await prisma.automationExecution.create({
      data: {
        organizationId,
        automationId: automatizacion.id,
        outboxEventId: evento.id,
        status,
        error,
      },
    });
    contar("AutomationExecution");
  }

  // --- Resumen ----------------------------------------------------------------
  console.log("Filas creadas:");
  for (const [entidad, n] of Object.entries(creados)) {
    console.log(`  ${entidad.padEnd(28)} ${String(n)}`);
  }
  console.log("");

  await verificarCobertura(organizationId);
}

// ---------------------------------------------------------------------------
// Verificación: lee de la base, no de lo que el script cree haber escrito,
// qué valores de cada enum existen en la organización. Si falta alguno, el
// script termina con error — un seed que dice "cubierto" y no lo está es peor
// que ninguno.
// ---------------------------------------------------------------------------
async function verificarCobertura(organizationId: string): Promise<void> {
  const where = { organizationId };

  // Los diez enums de Vehicle se leen de una sola vez y se reparten abajo.
  const enumsDeVehiculo = [
    ["condition", VehicleCondition],
    ["bodyType", VehicleBodyType],
    ["status", VehicleStatus],
    ["origin", VehicleOrigin],
    ["publicationCurrency", VehiclePublicationCurrency],
    ["transmission", VehicleTransmission],
    ["fuelType", VehicleFuelType],
    ["colorFinish", VehicleColorFinish],
    ["drivetrain", VehicleDrivetrain],
    ["warranty", VehicleWarranty],
  ] as const;
  const vehiculos = await prisma.vehicle.findMany({
    where,
    select: Object.fromEntries(enumsDeVehiculo.map(([campo]) => [campo, true])) as Record<
      (typeof enumsDeVehiculo)[number][0],
      true
    >,
  });

  type Lectura = () => Promise<Array<string | null>>;
  const cobertura: Array<{ campo: string; valores: string[]; leer: Lectura }> = [
    {
      campo: "Contact.lifecycleStage",
      valores: Object.values(LifecycleStage),
      leer: async () =>
        (await prisma.contact.findMany({ where, select: { lifecycleStage: true } })).map(
          (r) => r.lifecycleStage,
        ),
    },
    {
      campo: "Contact.leadUrgency",
      valores: Object.values(LeadUrgency),
      leer: async () =>
        (await prisma.contact.findMany({ where, select: { leadUrgency: true } })).map(
          (r) => r.leadUrgency,
        ),
    },
    {
      campo: "Opportunity.status",
      valores: Object.values(OpportunityStatus),
      leer: async () =>
        (await prisma.opportunity.findMany({ where, select: { status: true } })).map(
          (r) => r.status,
        ),
    },
    {
      campo: "Opportunity.leadSource",
      valores: Object.values(OpportunityLeadSource),
      leer: async () =>
        (await prisma.opportunity.findMany({ where, select: { leadSource: true } })).map(
          (r) => r.leadSource,
        ),
    },
    {
      campo: "Opportunity.financingType",
      valores: Object.values(OpportunityFinancingType),
      leer: async () =>
        (await prisma.opportunity.findMany({ where, select: { financingType: true } })).map(
          (r) => r.financingType,
        ),
    },
    {
      campo: "Activity.type",
      valores: Object.values(ActivityType),
      leer: async () =>
        (await prisma.activity.findMany({ where, select: { type: true } })).map((r) => r.type),
    },
    {
      campo: "Invitation.status",
      valores: Object.values(InvitationStatus),
      leer: async () =>
        (await prisma.invitation.findMany({ where, select: { status: true } })).map(
          (r) => r.status,
        ),
    },
    {
      campo: "Source.type",
      valores: Object.values(SourceType),
      leer: async () =>
        (await prisma.source.findMany({ where, select: { type: true } })).map((r) => r.type),
    },
    {
      campo: "IngestionEvent.status",
      valores: Object.values(IngestionStatus),
      leer: async () =>
        (await prisma.ingestionEvent.findMany({ where, select: { status: true } })).map(
          (r) => r.status,
        ),
    },
    {
      campo: "OutboxEvent.status",
      valores: Object.values(OutboxStatus),
      leer: async () =>
        (
          await prisma.outboxEvent.findMany({
            where: { ...where, eventType: OUTBOX_SEED_EVENT_TYPE },
            select: { status: true },
          })
        ).map((r) => r.status),
    },
    {
      campo: "AutomationExecution.status",
      valores: Object.values(AutomationExecutionStatus),
      leer: async () =>
        (await prisma.automationExecution.findMany({ where, select: { status: true } })).map(
          (r) => r.status,
        ),
    },
    {
      campo: "Resource.type",
      valores: Object.values(ResourceType),
      leer: async () =>
        (await prisma.resource.findMany({ where, select: { type: true } })).map((r) => r.type),
    },
    {
      campo: "GoogleCalendarConnection.status",
      valores: Object.values(ConnectionStatus),
      leer: async () =>
        (await prisma.googleCalendarConnection.findMany({ where, select: { status: true } })).map(
          (r) => r.status,
        ),
    },
    {
      campo: "WorkingHours.weekday",
      valores: Object.values(Weekday),
      leer: async () =>
        (await prisma.workingHours.findMany({ where, select: { weekday: true } })).map(
          (r) => r.weekday,
        ),
    },
    {
      campo: "Booking.status",
      valores: Object.values(BookingStatus),
      leer: async () =>
        (await prisma.booking.findMany({ where, select: { status: true } })).map((r) => r.status),
    },
    {
      campo: "Conversation.channel",
      valores: Object.values(ConversationChannel),
      leer: async () =>
        (await prisma.conversation.findMany({ where, select: { channel: true } })).map(
          (r) => r.channel,
        ),
    },
    {
      campo: "Conversation.status",
      valores: Object.values(ConversationStatus),
      leer: async () =>
        (await prisma.conversation.findMany({ where, select: { status: true } })).map(
          (r) => r.status,
        ),
    },
    {
      campo: "Message.direction",
      valores: Object.values(MessageDirection),
      leer: async () =>
        (await prisma.message.findMany({ where, select: { direction: true } })).map(
          (r) => r.direction,
        ),
    },
    {
      campo: "Message.senderType",
      valores: Object.values(MessageSenderType),
      leer: async () =>
        (await prisma.message.findMany({ where, select: { senderType: true } })).map(
          (r) => r.senderType,
        ),
    },
    {
      campo: "QrSubscriptionStatusChange.previousStatus",
      valores: Object.values(QrSubscriptionStatus),
      leer: async () =>
        (
          await prisma.qrSubscriptionStatusChange.findMany({
            where,
            select: { previousStatus: true },
          })
        ).map((r) => r.previousStatus),
    },
    {
      campo: "QrSubscriptionStatusChange.newStatus",
      valores: Object.values(QrSubscriptionStatus),
      leer: async () =>
        (
          await prisma.qrSubscriptionStatusChange.findMany({ where, select: { newStatus: true } })
        ).map((r) => r.newStatus),
    },
    {
      campo: "QrSubscriptionStatusChange.source",
      valores: Object.values(QrSubscriptionChangeSource),
      leer: async () =>
        (await prisma.qrSubscriptionStatusChange.findMany({ where, select: { source: true } })).map(
          (r) => r.source,
        ),
    },
    ...enumsDeVehiculo.map(([campo, valores]) => ({
      campo: `Vehicle.${campo}`,
      valores: Object.values(valores) as string[],
      leer: () => Promise.resolve(vehiculos.map((r) => r[campo])),
    })),
  ];

  console.log("Cobertura de enums (leída de la base):");
  let faltantes = 0;
  for (const { campo, valores, leer } of cobertura) {
    const presentes = new Set((await leer()).filter((v): v is string => v !== null));
    const faltan = valores.filter((v) => !presentes.has(v));
    const estado = faltan.length === 0 ? "OK " : "FALTA";
    console.log(
      `  ${estado} ${campo.padEnd(44)} ${String(valores.length - faltan.length)}/${String(valores.length)}${
        faltan.length > 0 ? `  faltan: ${faltan.join(", ")}` : ""
      }`,
    );
    faltantes += faltan.length;
  }
  if (faltantes > 0) {
    throw new Error(`Cobertura incompleta: faltan ${String(faltantes)} valor(es) de enum.`);
  }
  console.log("");
  console.log("Cobertura completa.");
}

main()
  .catch((err: unknown) => {
    console.error(`\nseed-dev-data: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
