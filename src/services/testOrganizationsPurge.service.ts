import type { Prisma, PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Purga de las organizaciones que dejó la suite de integración en una base
// real — el residuo del incidente del 27/09/2026, cuando la suite corrió
// contra producción (ver utils/baseLocal.ts, el freno que se agregó después).
//
// QUÉ ES "UNA ORGANIZACIÓN DE PRUEBA": SOLO EL SLUG. Cada test arma el suyo
// con una plantilla fija (`auto-${etiqueta}-${Date.now()}-${uuid8}`, ...) y
// esa plantilla es lo único que separa una organización de test de una real:
// los nombres de los tests son legibles ("Automation won ...") y un cliente
// podría llamarse parecido, pero ningún slugify de un nombre humano termina en
// un timestamp de 13 dígitos más 8 hex o en un UUID. Por eso el catálogo de
// abajo copia cada plantilla con su sufijo aleatorio completo, anclada de
// punta a punta, y dice de qué archivo sale. Si un test nuevo crea
// organizaciones con otra plantilla, testOrganizationsPurge.service.test.ts
// falla hasta que se la agregue acá.
//
// LAS PROTEGIDAS GANAN SIEMPRE. Aunque un slug coincida, no se toca:
//   - ninguna organización con un usuario platform admin (se lee de
//     platform_admins, no se escribe a mano);
//   - ninguna de las que reciba `protegidas` (en el script, la variable
//     PURGE_PROTECTED_ORG_IDS). Los ids reales no se escriben en el código: el
//     repo es público (ver CLAUDE.md, "Documentación sensible").
//
// EL ORDEN DE BORRADO SE LEE DE LA BASE, no se escribe a mano. Toda tabla de
// negocio tiene organization_id; se borra cada una por esa columna, hijas
// antes que madres según las FKs reales de pg_catalog. Una lista escrita a
// mano quedaría vieja con la próxima tabla y el borrado fallaría (o peor,
// dejaría filas). Los ciclos (messages <-> agent_inbound_jobs, vehicles <->
// opportunities) se cortan poniendo en NULL la FK anulable del ciclo antes de
// borrar. Si la estructura no se deja purgar así —una tabla que referencia a
// una de negocio sin tener organization_id, un ciclo sin FK anulable— se
// aborta antes de borrar nada.
//
// IDENTIDADES DE AUTH. Se borra la fila de auth.users de cada usuario de la
// organización (y de cada invitado que nunca aceptó), en la MISMA transacción,
// con SQL directo: si algo falla no queda una organización borrada con sus
// identidades vivas, ni al revés. Solo si:
//   - el email termina en ".test" (TLD reservado, RFC 2606: todos los tests
//     usan @example.test, @ejemplo.test u @org-b.test; un email real nunca);
//   - no es platform admin;
//   - no pertenece ni está invitado a otra organización.
// Aparte, las identidades de test que ya no cuelgan de ninguna organización
// (ver leerIdentidadesHuerfanas), con el mismo criterio.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Catálogo de patrones
// ---------------------------------------------------------------------------

export interface PatronDeSlug {
  // La plantilla tal como se lee: {ts} = Date.now(), {hex8} =
  // randomUUID().slice(0, 8), {uuid} = randomUUID(), {etiqueta} = la parte
  // variable que elige cada test.
  plantilla: string;
  origen: string;
  regex: RegExp;
}

const TOKENS: Record<string, string> = {
  "{ts}": "\\d{13}",
  "{hex8}": "[0-9a-f]{8}",
  "{uuid}": "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  "{etiqueta}": ".*",
};

function patron(plantilla: string, origen: string): PatronDeSlug {
  const cuerpo = plantilla
    .split(/(\{[a-z0-9]+\})/)
    .map((parte) => {
      if (parte.startsWith("{")) {
        const token = TOKENS[parte];
        if (!token) throw new Error(`Token desconocido en la plantilla ${plantilla}: ${parte}`);
        return token;
      }
      return parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return { plantilla, origen, regex: new RegExp(`^${cuerpo}$`) };
}

const C = "src/controllers/";
const M = "src/middlewares/";
const R = "src/repositories/";
const S = "src/services/";
const W = "src/workers/";

export const PATRONES_DE_SLUG_DE_PRUEBA: readonly PatronDeSlug[] = [
  patron("activity-read-{ts}-{hex8}", `${C}activity.controller.integration-test.ts`),
  patron("agents-{etiqueta}-{ts}-{hex8}", `${C}agent.controller.integration-test.ts`),
  patron("embed-test-{etiqueta}-{ts}-{hex8}", `${C}agentEmbedToken.controller.integration-test.ts`),
  patron("apikey-test-{etiqueta}-{ts}-{hex8}", `${C}apiKey.controller.integration-test.ts`),
  patron("automations-{etiqueta}-{ts}-{hex8}", `${C}automation.controller.integration-test.ts`),
  patron("auto-wa-{etiqueta}-{ts}-{hex8}", `${C}automationWhatsapp.integration-test.ts`),
  patron("erase-test-{etiqueta}-{ts}-{hex8}", `${C}contact-erase.controller.integration-test.ts`),
  patron("conv-{etiqueta}-{ts}-{hex8}", `${C}conversation.controller.integration-test.ts`),
  patron("reply-{ts}-{hex8}", `${C}conversationReply.integration-test.ts`),
  patron("reply-b-{ts}-{hex8}", `${C}conversationReply.integration-test.ts`),
  patron("delivery-http-{ts}-{hex8}", `${C}delivery.controller.integration-test.ts`),
  patron("gcal-webhook-{ts}-{hex8}", `${C}googleCalendarWebhook.controller.integration-test.ts`),
  patron("import-test-{ts}-{hex8}", `${C}import.controller.integration-test.ts`),
  patron("import-otra-fuente-{ts}-{hex8}", `${C}import.controller.integration-test.ts`),
  patron("import-otra-{ts}-{hex8}", `${C}import.controller.integration-test.ts`),
  patron("ingest-test-{etiqueta}-{ts}-{hex8}", `${C}ingest.controller.integration-test.ts`),
  patron(
    "ingevents-test-{etiqueta}-{ts}-{hex8}",
    `${C}ingestionEvent.controller.integration-test.ts`,
  ),
  patron("kb-{etiqueta}-{ts}-{hex8}", `${C}knowledgeBaseEntry.controller.integration-test.ts`),
  patron("kb-extract-{ts}-{hex8}", `${C}knowledgeBaseExtraction.controller.integration-test.ts`),
  patron("me-test-org-{etiqueta}-{ts}", `${C}me.controller.integration-test.ts`),
  patron(
    "meta-oauth-{etiqueta}-{ts}-{hex8}",
    `${C}metaPageConnection.controller.integration-test.ts`,
  ),
  patron("meta-webhook-{etiqueta}-{ts}-{hex8}", `${C}metaWebhook.controller.integration-test.ts`),
  patron("org-settings-{ts}-{hex8}", `${C}organization.controller.integration-test.ts`),
  // Alta por platform admin: el slug es slugify(organizationName).
  patron("automotora-feliz-{ts}", `${C}organizationAdmin.controller.integration-test.ts`),
  patron("automotora-conflicto-{ts}", `${C}organizationAdmin.controller.integration-test.ts`),
  patron("listado-vigente-{hex8}", `${C}organizationAdmin.controller.integration-test.ts`),
  patron("listado-de-baja-{hex8}", `${C}organizationAdmin.controller.integration-test.ts`),
  patron("payment-http-{ts}-{hex8}", `${C}payment.controller.integration-test.ts`),
  patron("widget-test-{ts}-{hex8}", `${C}publicWidget.controller.integration-test.ts`),
  patron("merge-{ts}-{hex8}", `${C}contactMerge.integration-test.ts`),
  patron("permisos-{etiqueta}-{ts}-{hex8}", `${C}permisosDelVendedor.integration-test.ts`),
  patron("merge-b-{ts}-{hex8}", `${C}contactMerge.integration-test.ts`),
  patron("widget-thread-{ts}-{hex8}", `${C}publicWidgetThread.integration-test.ts`),
  patron("cupon-manual-{ts}-{hex8}", `${C}voucherManual.integration-test.ts`),
  patron("cupon-manual-b-{ts}-{hex8}", `${C}voucherManual.integration-test.ts`),
  patron("qr-pub-{etiqueta}-{ts}-{hex8}", `${C}qrPublic.controller.integration-test.ts`),
  patron("quote-http-{ts}-{hex8}", `${C}quote.controller.integration-test.ts`),
  patron("whatsapp-test-{ts}-{hex8}", `${C}whatsappWebhook.controller.integration-test.ts`),
  patron("m1-happy-accept-{ts}", `${M}rateLimit.integration-test.ts`),
  // Onboarding: el slug es slugify(organizationName).
  patron("m1-onboarding-{uuid}", `${M}rateLimit.integration-test.ts`),
  patron("m1-onboarding-probe-{uuid}", `${M}rateLimit.integration-test.ts`),
  patron("m1-onboarding-happy-{uuid}", `${M}rateLimit.integration-test.ts`),
  patron("canales-meta-{etiqueta}-{ts}-{hex8}", `${R}canalesMeta.integration-test.ts`),
  patron("m13-org-a-{ts}-{hex8}", `${R}contact-email-uniqueness.integration-test.ts`),
  patron("m13-org-b-{ts}-{hex8}", `${R}contact-email-uniqueness.integration-test.ts`),
  patron("batch-test-{ts}-{hex8}", `${R}ingestionEvent-batch.integration-test.ts`),
  patron("purga-test-{ts}-{hex8}", `${R}ingestionEvent-purge.integration-test.ts`),
  patron("llm-uso-{etiqueta}-{ts}-{hex8}", `${R}llmTurnUsage.integration-test.ts`),
  patron("b17-{ts}-{hex8}", `${R}lockForUpdate.integration-test.ts`),
  patron("m4-org-a-{ts}", `${R}tenant-isolation.integration-test.ts`),
  patron("m4-org-b-{ts}", `${R}tenant-isolation.integration-test.ts`),
  patron("h01-org-x-{ts}", `${R}tenant-isolation.integration-test.ts`),
  patron("h01-org-y-{ts}", `${R}tenant-isolation.integration-test.ts`),
  patron("t1-org-{ts}", `${S}activity.service.integration-test.ts`),
  patron("campos-{etiqueta}-{ts}-{hex8}", `${S}contactCustomField.integration-test.ts`),
  patron("agentloop-{etiqueta}-{ts}-{hex8}", `${S}agentOrchestration.integration-test.ts`),
  patron("concurrencia-{ts}-{hex8}", `${S}agentTurnConcurrencia.integration-test.ts`),
  patron("auth-rogue-{ts}-{hex8}", `${S}auth.service.integration-test.ts`),
  patron("auto-{etiqueta}-{ts}-{hex8}", `${S}automation.test-helper.ts`),
  patron("booking-{etiqueta}-{ts}-{hex8}", `${S}booking-config.integration-test.ts`),
  patron("booking3-{etiqueta}-{ts}-{hex8}", `${S}booking.integration-test.ts`),
  patron("tz-org-{ts}-{hex8}", `${S}branchOrganizationTimezone.integration-test.ts`),
  patron("m10-company-{uuid}", `${S}company.service.integration-test.ts`),
  patron("m10-contact-{uuid}", `${S}contact.service.integration-test.ts`),
  patron("m10-otra-org-{uuid}", `${S}contact.service.integration-test.ts`),
  patron("brief-{etiqueta}-{ts}-{hex8}", `${S}conversationBrief.integration-test.ts`),
  patron("cupones-{etiqueta}-{ts}-{hex8}", `${S}discountVoucher.integration-test.ts`),
  patron("fx-a-{ts}-{hex8}", `${S}exchangeRate.integration-test.ts`),
  patron("fx-b-{ts}-{hex8}", `${S}exchangeRate.integration-test.ts`),
  patron("gcal-{etiqueta}-{ts}-{hex8}", `${S}google-calendar-connection.integration-test.ts`),
  patron("sync-{etiqueta}-{ts}-{hex8}", `${S}googleCalendarSync.integration-test.ts`),
  patron("agente-interno-{etiqueta}-{ts}-{hex8}", `${S}internalAgent.integration-test.ts`),
  patron("low1-org-{ts}", `${S}invitation.service.integration-test.ts`),
  patron("low1-org2-{ts}", `${S}invitation.service.integration-test.ts`),
  // Onboarding: el slug es slugify(organizationName).
  patron("alto-2-codigo-malo-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("alto-2-feliz-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("alto-2-dup-uno-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("alto-2-dup-dos-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("m-13-oraculo-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("m-13-nombre-repetido-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("m-11-sin-rol-admin-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("v-5-{etiqueta}-{uuid}", `${S}onboarding.service.integration-test.ts`),
  patron("org-currency-{ts}-{hex8}", `${S}organization.service.integration-test.ts`),
  patron("h2-integration-test-{uuid}", `${S}pipeline.service.integration-test.ts`),
  patron("promo-test-{ts}-{hex8}", `${S}promotion.service.integration-test.ts`),
  patron("f5b-ingesta-{uuid}", `${S}promotion.service.integration-test.ts`),
  patron("promo-otra-{ts}-{hex8}", `${S}promotion.service.integration-test.ts`),
  patron("qr-{etiqueta}-{ts}-{hex8}", `${S}qr.integration-test.ts`),
  patron("alto8-{etiqueta}-{ts}", `${S}soft-delete-restrict.integration-test.ts`),
  patron("t2-org-{ts}", `${S}stage.service.integration-test.ts`),
  patron("purga-orgs-{etiqueta}-{ts}-{hex8}", `${S}testOrganizationsPurge.integration-test.ts`),
  patron("m3-{etiqueta}-{ts}", `${S}user.service.integration-test.ts`),
  patron("veh-{etiqueta}-{ts}-{hex8}", `${S}vehicle.test-helper.ts`),
  patron("purga-visitantes-{ts}-{hex8}", `${S}widgetVisitorsPurge.integration-test.ts`),
  patron("worker-{etiqueta}-{ts}-{hex8}", `${W}agentInboundWorker.integration-test.ts`),
  patron("aviso-{ts}-{hex8}", `${W}avisoSinRespuestaWorker.integration-test.ts`),
  patron("ingworker-{etiqueta}-{ts}-{hex8}", `${W}ingestionWorker.integration-test.ts`),
  patron("outbox-{etiqueta}-{ts}-{hex8}", `${W}outboxWorker.integration-test.ts`),
];

// Todos los patrones que coinciden, no solo el primero: `auto-wa-x-...`
// coincide con el de automationWhatsapp y con el de automation.test-helper, y
// el informe muestra los dos.
export function patronesQueCoinciden(slug: string): PatronDeSlug[] {
  return PATRONES_DE_SLUG_DE_PRUEBA.filter((p) => p.regex.test(slug));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "id1, id2" -> ids validados. Vacío o con un id mal formado es un error: un
// typo en la lista de protegidas no puede convertirse en "nada protegido".
export function parsearIdsProtegidos(valor: string | undefined): string[] {
  const ids = (valor ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new Error(
      "PURGE_PROTECTED_ORG_IDS está vacía: tiene que listar, separados por coma, los ids de las " +
        "organizaciones que nunca se tocan (como mínimo AutoMax).",
    );
  }
  const invalidos = ids.filter((id) => !UUID.test(id));
  if (invalidos.length > 0) {
    throw new Error(`PURGE_PROTECTED_ORG_IDS tiene ids que no son UUID: ${invalidos.join(", ")}`);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Orden de borrado (puro: recibe las FKs, no consulta nada)
// ---------------------------------------------------------------------------

export interface ForeignKey {
  nombre: string;
  hija: string;
  madre: string;
  // Las columnas de la FK que se pueden poner en NULL. organization_id nunca
  // está acá aunque fuera anulable: en las FKs compuestas (organization_id,
  // x_id) alcanza con anular x_id (MATCH SIMPLE).
  columnasAnulables: string[];
}

export interface OrdenDeBorrado {
  // Hijas antes que madres. No incluye "organizations": esa va al final.
  tablas: string[];
  // FKs que se ponen en NULL antes de borrar, para cortar ciclos.
  anular: ForeignKey[];
}

// FKs anulables que NO se cortan aunque estén en un ciclo, porque un CHECK
// exige que al menos una de ellas tenga valor: anularlas juntas falla con
// 23514 antes del borrado. opportunities_company_or_contact_check: una
// oportunidad es de una empresa o de un contacto. Desde el vehículo de interés
// del contacto (20261020120000) contacts y opportunities quedan en el mismo
// ciclo que vehicles, y sin esto se anulaban las dos.
export const FKS_QUE_NO_SE_CORTAN = new Set([
  "opportunities_organization_id_company_id_fkey",
  "opportunities_organization_id_contact_id_fkey",
]);

export function calcularOrdenDeBorrado(
  tablasDeNegocio: string[],
  fks: ForeignKey[],
): OrdenDeBorrado {
  const deNegocio = new Set(tablasDeNegocio);

  // Una tabla que referencia a una de negocio (o a organizations) sin tener
  // organization_id es una tabla que este script no sabe acotar: se aborta en
  // vez de adivinar.
  for (const fk of fks) {
    if ((deNegocio.has(fk.madre) || fk.madre === "organizations") && !deNegocio.has(fk.hija)) {
      throw new Error(
        `La tabla ${fk.hija} referencia a ${fk.madre} (${fk.nombre}) y no tiene organization_id: ` +
          "este script no sabe purgarla. Revisar antes de borrar nada.",
      );
    }
  }

  const internas = fks.filter((fk) => deNegocio.has(fk.hija) && deNegocio.has(fk.madre));
  const anular: ForeignKey[] = [];
  let aristas = internas.filter((fk) => fk.hija !== fk.madre);

  // Las autorreferencias anulables se anulan; las otras las resuelve el propio
  // DELETE (Postgres chequea NO ACTION al final de la sentencia).
  for (const fk of internas) {
    if (fk.hija === fk.madre && fk.columnasAnulables.length > 0) anular.push(fk);
  }

  for (;;) {
    const componente = componenteDe(tablasDeNegocio, aristas);
    const enCiclo = aristas.filter((fk) => componente.get(fk.hija) === componente.get(fk.madre));
    if (enCiclo.length === 0) break;
    const cortables = enCiclo.filter(
      (fk) => fk.columnasAnulables.length > 0 && !FKS_QUE_NO_SE_CORTAN.has(fk.nombre),
    );
    if (cortables.length === 0) {
      throw new Error(
        `Ciclo de FKs sin columnas anulables entre ${[...new Set(enCiclo.map((fk) => fk.hija))].join(", ")}: ` +
          "no hay orden de borrado posible.",
      );
    }
    anular.push(...cortables);
    const cortadas = new Set(cortables);
    aristas = aristas.filter((fk) => !cortadas.has(fk));
  }

  // Kahn: una tabla sale cuando ya salieron todas las que la referencian.
  const pendientesDe = new Map<string, number>(tablasDeNegocio.map((t) => [t, 0]));
  for (const fk of aristas) pendientesDe.set(fk.madre, (pendientesDe.get(fk.madre) ?? 0) + 1);
  const listas = tablasDeNegocio.filter((t) => pendientesDe.get(t) === 0).sort();
  const tablas: string[] = [];
  while (listas.length > 0) {
    const tabla = listas.shift() as string;
    tablas.push(tabla);
    for (const fk of aristas.filter((a) => a.hija === tabla)) {
      const resto = (pendientesDe.get(fk.madre) ?? 0) - 1;
      pendientesDe.set(fk.madre, resto);
      if (resto === 0) {
        listas.push(fk.madre);
        listas.sort();
      }
    }
  }
  if (tablas.length !== tablasDeNegocio.length) {
    throw new Error("No se pudo ordenar el borrado: quedó un ciclo de FKs sin cortar.");
  }
  return { tablas, anular };
}

// Componentes fuertemente conexas (Tarjan): dos tablas en la misma componente
// están en un ciclo.
function componenteDe(nodos: string[], aristas: ForeignKey[]): Map<string, number> {
  const vecinos = new Map<string, string[]>(nodos.map((n) => [n, []]));
  for (const fk of aristas) vecinos.get(fk.hija)?.push(fk.madre);

  const indice = new Map<string, number>();
  const bajo = new Map<string, number>();
  const pila: string[] = [];
  const enPila = new Set<string>();
  const componente = new Map<string, number>();
  let contador = 0;
  let componentes = 0;

  const visitar = (n: string): void => {
    indice.set(n, contador);
    bajo.set(n, contador);
    contador++;
    pila.push(n);
    enPila.add(n);
    for (const v of vecinos.get(n) ?? []) {
      if (!indice.has(v)) {
        visitar(v);
        bajo.set(n, Math.min(bajo.get(n) as number, bajo.get(v) as number));
      } else if (enPila.has(v)) {
        bajo.set(n, Math.min(bajo.get(n) as number, indice.get(v) as number));
      }
    }
    if (bajo.get(n) === indice.get(n)) {
      for (;;) {
        const m = pila.pop() as string;
        enPila.delete(m);
        componente.set(m, componentes);
        if (m === n) break;
      }
      componentes++;
    }
  };
  for (const n of nodos) if (!indice.has(n)) visitar(n);
  return componente;
}

// ---------------------------------------------------------------------------
// Lectura de la estructura y del plan
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

const ident = (nombre: string): string => `"${nombre.replace(/"/g, '""')}"`;

async function leerEstructura(tx: Tx): Promise<{ tablas: string[]; fks: ForeignKey[] }> {
  const tablas = await tx.$queryRawUnsafe<{ tabla: string }[]>(`
    select c.table_name as tabla
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'organization_id'
      and t.table_type = 'BASE TABLE'
    order by 1`);
  const fks = await tx.$queryRawUnsafe<
    { nombre: string; hija: string; madre: string; columnas_anulables: string[] }[]
  >(`
    select con.conname as nombre, hija.relname as hija, madre.relname as madre,
           coalesce(array_agg(a.attname::text order by k.ord)
             filter (where not a.attnotnull and a.attname <> 'organization_id'), '{}') as columnas_anulables
    from pg_constraint con
    join pg_class hija on hija.oid = con.conrelid
    join pg_namespace nh on nh.oid = hija.relnamespace
    join pg_class madre on madre.oid = con.confrelid
    join pg_namespace nm on nm.oid = madre.relnamespace
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    where con.contype = 'f' and nh.nspname = 'public' and nm.nspname = 'public'
    group by con.conname, hija.relname, madre.relname
    order by 1`);
  return {
    tablas: tablas.map((t) => t.tabla),
    fks: fks.map((fk) => ({
      nombre: fk.nombre,
      hija: fk.hija,
      madre: fk.madre,
      columnasAnulables: fk.columnas_anulables,
    })),
  };
}

export interface OrganizacionProtegida {
  id: string;
  name: string | null; // null: el id protegido no existe en esta base
  slug: string | null;
  motivo: string;
  coincidiaConUnPatron: boolean;
}

export interface IdentidadDeAuth {
  id: string;
  email: string | null;
  vinculo: "usuario" | "invitado";
  seBorra: boolean;
  motivoParaConservarla: string | null;
}

export interface PlanDeOrganizacion {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  deletedAt: Date | null;
  patrones: PatronDeSlug[];
  filasPorTabla: Record<string, number>;
  identidades: IdentidadDeAuth[];
}

export interface IdentidadHuerfana {
  id: string;
  email: string;
  createdAt: Date;
}

export interface PlanDePurga {
  organizaciones: PlanDeOrganizacion[];
  identidadesHuerfanas: IdentidadHuerfana[];
  protegidas: OrganizacionProtegida[];
  tablasEnOrden: string[];
  fksQueSeAnulan: string[];
  puedeBorrarAuthUsers: boolean;
}

interface FilaOrg {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  deleted_at: Date | null;
}

async function leerProtegidas(tx: Tx, idsExplicitos: string[]): Promise<OrganizacionProtegida[]> {
  const deAdmins = await tx.$queryRawUnsafe<{ id: string }[]>(`
    select distinct u.organization_id::text as id
    from platform_admins pa join users u on u.id = pa.user_id`);
  const motivos = new Map<string, string>();
  for (const id of idsExplicitos) motivos.set(id, "PURGE_PROTECTED_ORG_IDS");
  for (const { id } of deAdmins) {
    motivos.set(
      id,
      motivos.has(id) ? `${motivos.get(id) as string} + platform admin` : "platform admin",
    );
  }
  const filas = await tx.$queryRawUnsafe<FilaOrg[]>(
    `select id::text as id, name, slug, created_at, deleted_at from organizations where id = any($1::uuid[])`,
    [...motivos.keys()],
  );
  const porId = new Map(filas.map((f) => [f.id, f]));
  return [...motivos.entries()].map(([id, motivo]) => {
    const fila = porId.get(id);
    return {
      id,
      name: fila?.name ?? null,
      slug: fila?.slug ?? null,
      motivo,
      coincidiaConUnPatron: fila ? patronesQueCoinciden(fila.slug).length > 0 : false,
    };
  });
}

// Las identidades de auth que cuelgan de UNA organización y si se borran.
// Se recalcula dentro de la transacción de borrado, no se confía en el plan.
async function leerIdentidades(tx: Tx, orgId: string): Promise<IdentidadDeAuth[]> {
  const filas = await tx.$queryRawUnsafe<
    {
      id: string;
      email: string | null;
      vinculo: "usuario" | "invitado";
      es_platform_admin: boolean;
      en_otra_org: boolean;
    }[]
  >(
    `
    with vinculadas as (
      select u.id, 'usuario'::text as vinculo from users u where u.organization_id = $1::uuid
      union
      select au.id, 'invitado'::text
      from invitations i
      join auth.users au on lower(au.email) = lower(i.email)
      where i.organization_id = $1::uuid
        and not exists (select 1 from users u where u.id = au.id and u.organization_id = $1::uuid)
    )
    select au.id::text as id, au.email, v.vinculo,
      exists (select 1 from platform_admins pa where pa.user_id = au.id) as es_platform_admin,
      exists (
        select 1 from users u
        where (u.id = au.id or lower(u.email) = lower(au.email)) and u.organization_id <> $1::uuid
      ) or exists (
        select 1 from invitations i
        where lower(i.email) = lower(au.email) and i.organization_id <> $1::uuid
      ) as en_otra_org
    from vinculadas v join auth.users au on au.id = v.id
    order by au.email`,
    orgId,
  );
  return filas.map((f) => {
    let motivo: string | null = null;
    if (!f.email?.toLowerCase().endsWith(".test")) motivo = "el email no es de test (.test)";
    else if (f.es_platform_admin) motivo = "es platform admin";
    else if (f.en_otra_org) motivo = "pertenece o está invitado a otra organización";
    return {
      id: f.id,
      email: f.email,
      vinculo: f.vinculo,
      seBorra: motivo === null,
      motivoParaConservarla: motivo,
    };
  });
}

export interface OpcionesDePurga {
  protegidas: string[];
  // Solo para los tests: acota la purga a estas organizaciones e identidades
  // huérfanas (que igual tienen que cumplir todo el criterio).
  alcance?: { organizaciones: string[]; identidades: string[] };
}

// Identidades de test que ya no cuelgan de NINGUNA organización: los tests
// borraban su fila de users pero, si fallaban a mitad, no la identidad. Ninguna
// de las organizaciones las ve, así que se buscan aparte, con el mismo
// criterio que las vinculadas: email .test, ni usuario ni invitación en
// ninguna organización, y no platform admin.
async function leerIdentidadesHuerfanas(
  tx: Tx,
  alcance: string[] | undefined,
): Promise<IdentidadHuerfana[]> {
  const filas = await tx.$queryRawUnsafe<{ id: string; email: string; created_at: Date }[]>(
    `
    select au.id::text as id, au.email, au.created_at
    from auth.users au
    where lower(au.email) like '%.test'
      and not exists (select 1 from users u where u.id = au.id or lower(u.email) = lower(au.email))
      and not exists (select 1 from invitations i where lower(i.email) = lower(au.email))
      and not exists (select 1 from platform_admins pa where pa.user_id = au.id)
      and ($1::uuid[] is null or au.id = any($1::uuid[]))
    order by au.created_at, au.email`,
    alcance ?? null,
  );
  return filas.map((f) => ({ id: f.id, email: f.email, createdAt: f.created_at }));
}

async function armarPlan(tx: Tx, opciones: OpcionesDePurga): Promise<PlanDePurga> {
  const estructura = await leerEstructura(tx);
  const orden = calcularOrdenDeBorrado(estructura.tablas, estructura.fks);
  const protegidas = await leerProtegidas(tx, opciones.protegidas);
  const idsProtegidos = new Set(protegidas.map((p) => p.id));

  const todas = await tx.$queryRawUnsafe<FilaOrg[]>(
    `select id::text as id, name, slug, created_at, deleted_at from organizations order by created_at, slug`,
  );
  const candidatas = todas.filter(
    (o) =>
      !idsProtegidos.has(o.id) &&
      (!opciones.alcance || opciones.alcance.organizaciones.includes(o.id)) &&
      patronesQueCoinciden(o.slug).length > 0,
  );
  const ids = candidatas.map((o) => o.id);

  const filas = new Map<string, Record<string, number>>(ids.map((id) => [id, {}]));
  if (ids.length > 0) {
    for (const tabla of orden.tablas) {
      const conteos = await tx.$queryRawUnsafe<{ org: string; n: number }[]>(
        `select organization_id::text as org, count(*)::int as n from ${ident(tabla)}
         where organization_id = any($1::uuid[]) group by 1`,
        ids,
      );
      for (const { org, n } of conteos) (filas.get(org) as Record<string, number>)[tabla] = n;
    }
  }

  const organizaciones: PlanDeOrganizacion[] = [];
  for (const o of candidatas) {
    organizaciones.push({
      id: o.id,
      name: o.name,
      slug: o.slug,
      createdAt: o.created_at,
      deletedAt: o.deleted_at,
      patrones: patronesQueCoinciden(o.slug),
      filasPorTabla: filas.get(o.id) as Record<string, number>,
      identidades: await leerIdentidades(tx, o.id),
    });
  }

  const [{ puede }] = await tx.$queryRawUnsafe<{ puede: boolean }[]>(
    `select has_table_privilege(current_user, 'auth.users', 'DELETE') as puede`,
  );

  return {
    organizaciones,
    identidadesHuerfanas: await leerIdentidadesHuerfanas(tx, opciones.alcance?.identidades),
    protegidas,
    tablasEnOrden: orden.tablas,
    fksQueSeAnulan: orden.anular.map(
      (fk) => `${fk.hija}.${fk.columnasAnulables.join("+")} (${fk.nombre})`,
    ),
    puedeBorrarAuthUsers: puede,
  };
}

const OPCIONES_TX = { maxWait: 10_000, timeout: 120_000 };

// Modo simulación. Corre entero en una transacción READ ONLY: Postgres rechaza
// cualquier escritura, así que la simulación no puede borrar nada aunque un
// error de este código lo intentara.
export async function simularPurga(
  db: PrismaClient,
  opciones: OpcionesDePurga,
): Promise<PlanDePurga> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("set transaction read only");
    return armarPlan(tx, opciones);
  }, OPCIONES_TX);
}

export interface ResultadoDeOrganizacion {
  id: string;
  slug: string;
  ok: boolean;
  filasBorradas: number;
  identidadesBorradas: number;
  error?: string;
}

// Borrado real: una transacción por organización. Una que falla se revierte
// entera y no frena a las demás; el resultado dice cuál y por qué.
export async function ejecutarPurga(
  db: PrismaClient,
  opciones: OpcionesDePurga,
): Promise<{
  plan: PlanDePurga;
  resultados: ResultadoDeOrganizacion[];
  huerfanasBorradas: number;
}> {
  const plan = await simularPurga(db, opciones);
  const resultados: ResultadoDeOrganizacion[] = [];
  for (const org of plan.organizaciones) {
    try {
      const r = await db.$transaction(
        (tx) => purgarOrganizacion(tx, org.id, opciones.protegidas),
        OPCIONES_TX,
      );
      resultados.push({ id: org.id, slug: org.slug, ok: true, ...r });
    } catch (err) {
      resultados.push({
        id: org.id,
        slug: org.slug,
        ok: false,
        filasBorradas: 0,
        identidadesBorradas: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Las huérfanas al final y en su propia transacción: solo las que mostró la
  // simulación, y solo si siguen cumpliendo el criterio.
  const huerfanasBorradas =
    plan.identidadesHuerfanas.length === 0
      ? 0
      : await db.$transaction(async (tx) => {
          const vigentes = await leerIdentidadesHuerfanas(
            tx,
            plan.identidadesHuerfanas.map((i) => i.id),
          );
          if (vigentes.length === 0) return 0;
          return tx.$executeRawUnsafe(
            `delete from auth.users where id = any($1::uuid[])`,
            vigentes.map((i) => i.id),
          );
        }, OPCIONES_TX);
  return { plan, resultados, huerfanasBorradas };
}

async function purgarOrganizacion(
  tx: Tx,
  orgId: string,
  idsProtegidos: string[],
): Promise<{ filasBorradas: number; identidadesBorradas: number }> {
  // Todo se vuelve a verificar adentro de la transacción, con la fila
  // bloqueada: entre el plan y el borrado pudo cambiar algo.
  const [org] = await tx.$queryRawUnsafe<{ slug: string }[]>(
    `select slug from organizations where id = $1::uuid for update`,
    orgId,
  );
  if (!org) throw new Error("la organización ya no existe");
  if (patronesQueCoinciden(org.slug).length === 0) {
    throw new Error(`el slug ${org.slug} ya no coincide con ningún patrón de test`);
  }
  const protegidas = await leerProtegidas(tx, idsProtegidos);
  if (protegidas.some((p) => p.id === orgId)) throw new Error("la organización está protegida");

  const identidades = (await leerIdentidades(tx, orgId)).filter((i) => i.seBorra);
  const { tablas, fks } = await leerEstructura(tx);
  const orden = calcularOrdenDeBorrado(tablas, fks);

  for (const fk of orden.anular) {
    const set = fk.columnasAnulables.map((c) => `${ident(c)} = null`).join(", ");
    await tx.$executeRawUnsafe(
      `update ${ident(fk.hija)} set ${set} where organization_id = $1::uuid`,
      orgId,
    );
  }
  let filasBorradas = 0;
  for (const tabla of orden.tablas) {
    filasBorradas += await tx.$executeRawUnsafe(
      `delete from ${ident(tabla)} where organization_id = $1::uuid`,
      orgId,
    );
  }
  filasBorradas += await tx.$executeRawUnsafe(
    `delete from organizations where id = $1::uuid`,
    orgId,
  );

  const identidadesBorradas =
    identidades.length === 0
      ? 0
      : await tx.$executeRawUnsafe(
          `delete from auth.users where id = any($1::uuid[])`,
          identidades.map((i) => i.id),
        );
  return { filasBorradas, identidadesBorradas };
}
