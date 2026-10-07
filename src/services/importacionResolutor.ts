import type { ImportEntityType, LifecycleStage } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { soloDigitos } from "../lib/telefono";
import { buscarVinculos } from "../repositories/importacion.repository";
import {
  claveDeActividad,
  claveDeId,
  claveDeNombreDeEmpresa,
  clavesDeContacto,
  clavesDeEmpresa,
  type CandidatoDeActividad,
  type CandidatoDeContacto,
  type CandidatoDeEmpresa,
  type ContactoExistente,
  type EmpresaExistente,
} from "../utils/importacionMapeo";

// ---------------------------------------------------------------------------
// Cómo el asistente encuentra lo que ya existe (docs/importacion-de-datos.md
// §2.3 y §3.2), en UN solo lugar para el análisis y la promoción: el análisis
// precarga una tanda de 500 filas con pocas consultas; la promoción precarga
// UNA fila, bajo el lock de la organización. Las dos hacen después las mismas
// preguntas a los mismos mapas, así que la vista previa pronostica con las
// mismas reglas con las que la promoción escribe.
//
// El orden de búsqueda de un contacto: el vínculo del sistema de origen (por
// cualquiera de sus claves), después el email (lower, el mismo criterio que
// el índice único), después el teléfono por dígitos. Una empresa: vínculo,
// después el nombre normalizado.
// ---------------------------------------------------------------------------

export type IdentificadoPor = "vinculo" | "email" | "telefono" | "nombre";

export interface Encontrado<T> {
  existente: T;
  identificadoPor: IdentificadoPor;
}

// Las tres cadenas de unir contactos (#411) que se siguen: un contacto unido a
// otro queda borrado con mergedIntoId; el vínculo apunta al que quedó.
const MAX_SALTOS_DE_UNION = 3;

interface FilaDeContacto {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  source: string | null;
  lifecycle_stage: LifecycleStage;
  customer_since: Date | null;
  lead_notes: string | null;
  custom_fields: unknown;
  owner_id: string | null;
  company_id: string | null;
  vehicle_of_interest_id: string | null;
}

function aContactoExistente(f: FilaDeContacto): ContactoExistente {
  return {
    id: f.id,
    firstName: f.first_name,
    lastName: f.last_name,
    email: f.email,
    phone: f.phone,
    jobTitle: f.job_title,
    source: f.source,
    lifecycleStage: f.lifecycle_stage,
    customerSince: f.customer_since ? f.customer_since.toISOString().slice(0, 10) : null,
    leadNotes: f.lead_notes,
    customFields:
      f.custom_fields !== null &&
      typeof f.custom_fields === "object" &&
      !Array.isArray(f.custom_fields)
        ? (f.custom_fields as Record<string, unknown>)
        : {},
    ownerId: f.owner_id,
    companyId: f.company_id,
    vehicleOfInterestId: f.vehicle_of_interest_id,
  };
}

// La patente como se compara: mayúsculas, sin espacios ni guiones.
export function normalizarPatente(patente: string): string {
  return patente.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export class ResolutorDeImportacion {
  private readonly vinculos = new Map<string, string>();
  private readonly contactoPorEmail = new Map<string, string>();
  private readonly contactoPorTelefono = new Map<string, string>();
  private readonly contactos = new Map<string, ContactoExistente>();
  private readonly empresaPorNombre = new Map<string, string>();
  private readonly empresas = new Map<string, EmpresaExistente>();
  private readonly usuarioPorEmail = new Map<string, string>();
  private readonly vehiculoPorRef = new Map<string, string>();
  private empresasDeLaOrganizacionCargadas = false;
  private readonly actividadesVivas = new Set<string>();

  constructor(
    private readonly organizationId: string,
    private readonly sourceId: string,
    private readonly db: Db,
  ) {}

  private claveDeMapa(tipo: ImportEntityType, clave: string): string {
    return `${tipo}|${clave}`;
  }

  private async precargarVinculos(tipo: ImportEntityType, claves: string[]): Promise<void> {
    const encontrados = await buscarVinculos(
      this.organizationId,
      this.sourceId,
      tipo,
      claves,
      this.db,
    );
    for (const [clave, id] of encontrados) this.vinculos.set(this.claveDeMapa(tipo, clave), id);
  }

  vinculo(tipo: ImportEntityType, clave: string): string | undefined {
    return this.vinculos.get(this.claveDeMapa(tipo, clave));
  }

  // Lo que el lote acaba de crear o vincular, para que una fila posterior del
  // mismo archivo con la misma clave lo encuentre (en el análisis, donde nada
  // se escribe todavía, lo marca con un id provisorio).
  recordarVinculo(tipo: ImportEntityType, clave: string, id: string): void {
    this.vinculos.set(this.claveDeMapa(tipo, clave), id);
  }

  // -------------------------------------------------------------------------
  // Contactos
  // -------------------------------------------------------------------------

  async precargarContactos(candidatos: readonly CandidatoDeContacto[]): Promise<void> {
    const claves = [...new Set(candidatos.flatMap(clavesDeContacto))];
    await this.precargarVinculos("CONTACT", claves);

    await this.precargarEmails(candidatos.flatMap((c) => (c.email ? [c.email] : [])));
    await this.precargarTelefonos(candidatos.flatMap((c) => (c.phone ? [c.phone] : [])));

    const ids = new Set<string>([
      ...[...this.vinculos.entries()].filter(([k]) => k.startsWith("CONTACT|")).map(([, v]) => v),
      ...this.contactoPorEmail.values(),
      ...this.contactoPorTelefono.values(),
    ]);
    await this.precargarContactosPorId([...ids]);

    const owners = candidatos.flatMap((c) => (c.ownerEmail ? [c.ownerEmail] : []));
    await this.precargarUsuarios(owners);
    await this.precargarEmpresasPorNombre(
      candidatos.flatMap((c) => (c.companyName ? [c.companyName] : [])),
    );
    await this.precargarVehiculos(candidatos.flatMap((c) => (c.vehicleRef ? [c.vehicleRef] : [])));
  }

  private async precargarEmails(lista: string[]): Promise<void> {
    const emails = [...new Set(lista.map((e) => e.toLowerCase()))].filter(
      (e) => !this.contactoPorEmail.has(e),
    );
    if (emails.length > 0) {
      const filas = await this.db.$queryRaw<{ id: string; email: string }[]>`
        SELECT id, lower(email) AS email FROM contacts
        WHERE organization_id = ${this.organizationId}::uuid AND deleted_at IS NULL
          AND lower(email) = ANY(${emails}::text[])
      `;
      for (const f of filas) this.contactoPorEmail.set(f.email, f.id);
    }
  }

  private async precargarTelefonos(lista: string[]): Promise<void> {
    const digitos = [...new Set(lista.map(soloDigitos))].filter(
      (d) => !this.contactoPorTelefono.has(d),
    );
    if (digitos.length > 0) {
      // Si quedan teléfonos repetidos de antes de F5, el creado primero.
      const filas = await this.db.$queryRaw<{ id: string; digitos: string }[]>`
        SELECT DISTINCT ON (digitos) id, digitos FROM (
          SELECT id, created_at, regexp_replace(phone, '[^0-9]', '', 'g') AS digitos FROM contacts
          WHERE organization_id = ${this.organizationId}::uuid AND deleted_at IS NULL
            AND phone IS NOT NULL
        ) t
        WHERE digitos = ANY(${digitos}::text[])
        ORDER BY digitos, created_at, id
      `;
      for (const f of filas) this.contactoPorTelefono.set(f.digitos, f.id);
    }
  }

  // -------------------------------------------------------------------------
  // Historial (§5.3)
  // -------------------------------------------------------------------------

  // Las actividades del lote y los contactos a los que van. El contacto se
  // busca por su id del sistema de origen en CUALQUIER fuente de la
  // organización (los contactos suelen venir de otra planilla que el
  // historial), prefiriendo la del lote; después por email y por teléfono.
  async precargarActividades(candidatos: readonly CandidatoDeActividad[]): Promise<void> {
    await this.precargarVinculos("ACTIVITY", candidatos.map(claveDeActividad));
    const idsDeActividad = [...this.vinculos.entries()]
      .filter(([k]) => k.startsWith("ACTIVITY|"))
      .map(([, v]) => v)
      .filter((id) => !this.actividadesVivas.has(id));
    if (idsDeActividad.length > 0) {
      const vivas = await this.db.activity.findMany({
        where: { organizationId: this.organizationId, id: { in: idsDeActividad }, deletedAt: null },
        select: { id: true },
      });
      for (const a of vivas) this.actividadesVivas.add(a.id);
    }

    const externos = [
      ...new Set(candidatos.flatMap((c) => (c.contactExternalId ? [c.contactExternalId] : []))),
    ];
    if (externos.length > 0) {
      const vinculos = await this.db.externalRecordLink.findMany({
        where: {
          organizationId: this.organizationId,
          entityType: "CONTACT",
          externalKey: { in: externos.map(claveDeId) },
        },
        select: { externalKey: true, entityId: true, sourceId: true },
      });
      for (const externo of externos) {
        const de = vinculos.filter((v) => v.externalKey === claveDeId(externo));
        const elegido = de.find((v) => v.sourceId === this.sourceId) ?? de[0];
        // En el mapa de vínculos, así el seguimiento de uniones lo repunta.
        if (elegido)
          this.vinculos.set(this.claveDeMapa("CONTACT", `ext:${externo}`), elegido.entityId);
      }
    }
    await this.precargarEmails(candidatos.flatMap((c) => (c.contactEmail ? [c.contactEmail] : [])));
    await this.precargarTelefonos(
      candidatos.flatMap((c) => (c.contactPhone ? [c.contactPhone] : [])),
    );
    await this.precargarContactosPorId([
      ...new Set([
        ...[...this.vinculos.entries()].filter(([k]) => k.startsWith("CONTACT|")).map(([, v]) => v),
        ...this.contactoPorEmail.values(),
        ...this.contactoPorTelefono.values(),
      ]),
    ]);
    await this.precargarUsuarios(
      candidatos.flatMap((c) => (c.assigneeEmail ? [c.assigneeEmail] : [])),
    );
  }

  contactoDeActividad(c: CandidatoDeActividad): string | null {
    const candidatos = [
      c.contactExternalId ? this.vinculo("CONTACT", `ext:${c.contactExternalId}`) : undefined,
      c.contactEmail ? this.contactoPorEmail.get(c.contactEmail.toLowerCase()) : undefined,
      c.contactPhone ? this.contactoPorTelefono.get(soloDigitos(c.contactPhone)) : undefined,
    ];
    return candidatos.find((id) => id !== undefined && this.contactos.has(id)) ?? null;
  }

  // La actividad que ya trajo una importación anterior (por su clave), viva.
  actividadDe(c: CandidatoDeActividad): string | null {
    const id = this.vinculo("ACTIVITY", claveDeActividad(c));
    return id && this.actividadesVivas.has(id) ? id : null;
  }

  // Los contactos por id, siguiendo las uniones: un vínculo a un contacto que
  // se unió a otro pasa a apuntar al que quedó.
  private async precargarContactosPorId(ids: string[]): Promise<void> {
    let pendientes = ids.filter((id) => !this.contactos.has(id));
    const reemplazos = new Map<string, string>();
    for (let salto = 0; salto <= MAX_SALTOS_DE_UNION && pendientes.length > 0; salto++) {
      const filas = await this.db.$queryRaw<
        (FilaDeContacto & { deleted_at: Date | null; merged_into_id: string | null })[]
      >`
        SELECT id, first_name, last_name, email, phone, job_title, source, lifecycle_stage,
               customer_since, lead_notes, custom_fields, owner_id, company_id,
               vehicle_of_interest_id, deleted_at, merged_into_id
        FROM contacts
        WHERE organization_id = ${this.organizationId}::uuid AND id = ANY(${pendientes}::uuid[])
      `;
      const siguientes: string[] = [];
      for (const f of filas) {
        if (f.deleted_at === null) {
          this.contactos.set(f.id, aContactoExistente(f));
        } else if (f.merged_into_id !== null) {
          reemplazos.set(f.id, f.merged_into_id);
          siguientes.push(f.merged_into_id);
        }
      }
      pendientes = siguientes.filter((id) => !this.contactos.has(id));
    }
    // Un vínculo a un contacto unido se resuelve al que quedó.
    for (const [clave, id] of this.vinculos) {
      let destino = id;
      for (let i = 0; i <= MAX_SALTOS_DE_UNION && reemplazos.has(destino); i++) {
        destino = reemplazos.get(destino) as string;
      }
      if (destino !== id) this.vinculos.set(clave, destino);
    }
  }

  contactoDe(c: CandidatoDeContacto): Encontrado<ContactoExistente> | null {
    for (const clave of clavesDeContacto(c)) {
      const id = this.vinculo("CONTACT", clave);
      const existente = id ? this.contactos.get(id) : undefined;
      if (existente) return { existente, identificadoPor: "vinculo" };
    }
    if (c.email) {
      const id = this.contactoPorEmail.get(c.email.toLowerCase());
      const existente = id ? this.contactos.get(id) : undefined;
      if (existente) return { existente, identificadoPor: "email" };
    }
    if (c.phone) {
      const id = this.contactoPorTelefono.get(soloDigitos(c.phone));
      const existente = id ? this.contactos.get(id) : undefined;
      if (existente) return { existente, identificadoPor: "telefono" };
    }
    return null;
  }

  // ¿El email o el teléfono ya son de OTRO contacto? Para no completar un dato
  // que la base (email) o la regla de F5 (teléfono) no dejan repetir.
  emailDeOtro(email: string, contactoId: string | null): boolean {
    const id = this.contactoPorEmail.get(email.toLowerCase());
    return id !== undefined && id !== contactoId;
  }

  telefonoDeOtro(telefono: string, contactoId: string | null): boolean {
    const id = this.contactoPorTelefono.get(soloDigitos(telefono));
    return id !== undefined && id !== contactoId;
  }

  // Lo que el lote acaba de crear, para las filas siguientes del mismo lote.
  recordarContacto(c: CandidatoDeContacto, existente: ContactoExistente): void {
    this.contactos.set(existente.id, existente);
    if (c.email) this.contactoPorEmail.set(c.email.toLowerCase(), existente.id);
    if (c.phone) this.contactoPorTelefono.set(soloDigitos(c.phone), existente.id);
    for (const clave of clavesDeContacto(c)) this.recordarVinculo("CONTACT", clave, existente.id);
  }

  // -------------------------------------------------------------------------
  // Empresas
  // -------------------------------------------------------------------------

  private async precargarEmpresasPorNombre(nombres: string[]): Promise<void> {
    const claves = [...new Set(nombres.map(claveDeNombreDeEmpresa))];
    await this.precargarVinculos("COMPANY", claves);
    // El nombre se compara normalizado en JS (claveDeOpcion saca las tildes,
    // y Postgres no sabe hacerlo sin la extensión unaccent), así que se traen
    // los nombres de TODAS las empresas de la organización, una sola vez por
    // resolutor. Una organización en alta tiene decenas o cientos de empresas;
    // si alguna vez pesa, un índice funcional.
    if (claves.length === 0 || this.empresasDeLaOrganizacionCargadas) {
      await this.precargarEmpresasPorId();
      return;
    }
    this.empresasDeLaOrganizacionCargadas = true;
    const filas = await this.db.company.findMany({
      where: { organizationId: this.organizationId, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    });
    for (const f of filas) {
      const clave = claveDeNombreDeEmpresa(f.name);
      if (!this.empresaPorNombre.has(clave)) this.empresaPorNombre.set(clave, f.id);
    }
    await this.precargarEmpresasPorId();
  }

  private async precargarEmpresasPorId(): Promise<void> {
    const ids = new Set<string>([
      ...[...this.vinculos.entries()].filter(([k]) => k.startsWith("COMPANY|")).map(([, v]) => v),
      ...this.empresaPorNombre.values(),
    ]);
    const faltan = [...ids].filter((id) => !this.empresas.has(id));
    if (faltan.length === 0) return;
    const filas = await this.db.company.findMany({
      where: { organizationId: this.organizationId, deletedAt: null, id: { in: faltan } },
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        phone: true,
        city: true,
        country: true,
        ownerId: true,
      },
    });
    for (const f of filas) this.empresas.set(f.id, f);
  }

  async precargarEmpresas(candidatos: readonly CandidatoDeEmpresa[]): Promise<void> {
    const claves = [...new Set(candidatos.flatMap(clavesDeEmpresa))];
    await this.precargarVinculos("COMPANY", claves);
    await this.precargarEmpresasPorNombre(candidatos.map((c) => c.name));
    await this.precargarUsuarios(candidatos.flatMap((c) => (c.ownerEmail ? [c.ownerEmail] : [])));
  }

  empresaDe(c: CandidatoDeEmpresa): Encontrado<EmpresaExistente> | null {
    for (const clave of clavesDeEmpresa(c)) {
      const id = this.vinculo("COMPANY", clave);
      const existente = id ? this.empresas.get(id) : undefined;
      if (existente) return { existente, identificadoPor: "vinculo" };
    }
    const id = this.empresaPorNombre.get(claveDeNombreDeEmpresa(c.name));
    const existente = id ? this.empresas.get(id) : undefined;
    return existente ? { existente, identificadoPor: "nombre" } : null;
  }

  // La empresa de un contacto, por su nombre: vínculo o nombre normalizado.
  empresaPorNombreDeContacto(nombre: string): string | null {
    const clave = claveDeNombreDeEmpresa(nombre);
    const porVinculo = this.vinculo("COMPANY", clave);
    if (porVinculo && this.empresas.has(porVinculo)) return porVinculo;
    return this.empresaPorNombre.get(clave) ?? null;
  }

  recordarEmpresa(c: CandidatoDeEmpresa, existente: EmpresaExistente): void {
    this.empresas.set(existente.id, existente);
    this.empresaPorNombre.set(claveDeNombreDeEmpresa(c.name), existente.id);
    for (const clave of clavesDeEmpresa(c)) this.recordarVinculo("COMPANY", clave, existente.id);
  }

  // -------------------------------------------------------------------------
  // Usuarios y vehículos
  // -------------------------------------------------------------------------

  private async precargarUsuarios(emails: string[]): Promise<void> {
    const faltan = [...new Set(emails.map((e) => e.toLowerCase()))].filter(
      (e) => !this.usuarioPorEmail.has(e),
    );
    if (faltan.length === 0) return;
    const filas = await this.db.$queryRaw<{ id: string; email: string }[]>`
      SELECT id, lower(email) AS email FROM users
      WHERE organization_id = ${this.organizationId}::uuid AND deleted_at IS NULL AND is_active
        AND lower(email) = ANY(${faltan}::text[])
    `;
    for (const f of filas) this.usuarioPorEmail.set(f.email, f.id);
  }

  usuario(email: string): string | null {
    return this.usuarioPorEmail.get(email.toLowerCase()) ?? null;
  }

  // El vehículo de interés, por la referencia del archivo (§5.2): el código
  // del sistema de origen (vínculo de vehículo de CUALQUIER fuente de la
  // organización: el stock suele venir de otra planilla), nuestro código
  // interno (STK-…) o la patente.
  private async precargarVehiculos(refs: string[]): Promise<void> {
    const faltan = [...new Set(refs)].filter((r) => !this.vehiculoPorRef.has(r));
    if (faltan.length === 0) return;
    const claves = faltan.flatMap((r) => [`codigo:${r}`, `id:${r}`]);
    const vinculos = await this.db.externalRecordLink.findMany({
      where: {
        organizationId: this.organizationId,
        entityType: "VEHICLE",
        externalKey: { in: claves },
      },
      select: { externalKey: true, entityId: true },
    });
    const patentes = faltan.map(normalizarPatente).filter((p) => p.length > 0);
    const idsPorVinculo = [...new Set(vinculos.map((v) => v.entityId))];
    const vehiculos = await this.db.$queryRaw<
      { id: string; internal_code: string; patente: string | null }[]
    >`
      SELECT id, internal_code,
             upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')) AS patente
      FROM vehicles
      WHERE organization_id = ${this.organizationId}::uuid AND deleted_at IS NULL
        AND (id = ANY(${idsPorVinculo}::uuid[])
             OR internal_code = ANY(${faltan}::text[])
             OR upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')) = ANY(${patentes}::text[]))
    `;
    // Un vínculo a un vehículo dado de baja no cuenta: la consulta filtra
    // deleted_at, y lo que no volvió no está vivo.
    const vivos = new Set(vehiculos.map((v) => v.id));
    for (const ref of faltan) {
      const porVinculo = vinculos
        .filter((v) => v.externalKey === `codigo:${ref}` || v.externalKey === `id:${ref}`)
        .map((v) => v.entityId);
      const unicoPorVinculo = [...new Set(porVinculo)];
      const id =
        unicoPorVinculo.length === 1 && vivos.has(unicoPorVinculo[0])
          ? unicoPorVinculo[0]
          : (vehiculos.find((v) => v.internal_code === ref)?.id ??
            vehiculos.find((v) => v.patente !== null && v.patente === normalizarPatente(ref))?.id);
      if (id) this.vehiculoPorRef.set(ref, id);
    }
  }

  vehiculo(ref: string): string | null {
    return this.vehiculoPorRef.get(ref) ?? null;
  }
}
