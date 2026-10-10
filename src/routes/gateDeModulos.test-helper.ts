import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import type { OrganizationEdition, OrganizationIndustry } from "@prisma/client";
import type { Express } from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";

// ---------------------------------------------------------------------------
// Lo compartido por las suites que prueban el gate de módulos contra la app
// real (src/routes/ediciones.integration-test.ts y
// src/clinicas/automotoraSinCambios.integration-test.ts): una organización
// con su edición y su rubro, ADMIN reales de Supabase local, y un fetch que
// rota entre ellos.
//
// El rubro se escribe directo con Prisma: hasta R3 (docs/rubros.md §15) no
// hay ruta que cree una organización CLINICA.
// ---------------------------------------------------------------------------

const PASSWORD = "Gate-de-modulos-test-password-123!";

export interface OrgDePrueba {
  id: string;
  edition: OrganizationEdition;
  industry: OrganizationIndustry;
  tokens: string[];
  authIds: string[];
}

/** Una organización con `usuarios` ADMIN reales. El slug es
 *  `${prefijo}-{etiqueta}-{ts}-{hex8}`: cada suite registra su prefijo en
 *  PATRONES_DE_SLUG_DE_PRUEBA. */
export async function crearOrgDePrueba(
  prefijo: string,
  edition: OrganizationEdition,
  industry: OrganizationIndustry,
  usuarios: number,
): Promise<OrgDePrueba> {
  const etiqueta = `${edition}-${industry}`.toLowerCase();
  const org = await prisma.organization.create({
    data: {
      name: `${prefijo} ${etiqueta} ${randomUUID()}`,
      slug: `${prefijo}-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      edition,
      industry,
    },
  });
  const rol = await findRoleByName("ADMIN");
  if (!rol) throw new Error("No está sembrado el rol ADMIN");
  const tokens: string[] = [];
  const authIds: string[] = [];
  for (let i = 0; i < usuarios; i++) {
    const email = `${prefijo}-${etiqueta}-${i}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    authIds.push(data.user.id);
    await prisma.user.create({
      data: {
        id: data.user.id,
        organizationId: org.id,
        roleId: rol.id,
        email,
        fullName: `${prefijo} ${etiqueta} ${i}`,
      },
    });
    const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
    const sesion = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sesion.error || !sesion.data.session) throw new Error(`signIn: ${sesion.error?.message}`);
    tokens.push(sesion.data.session.access_token);
  }
  return { id: org.id, edition, industry, tokens, authIds };
}

/** Borra lo que las suites crean (sus fixtures y lo que un pedido que pasó el
 *  gate pudo haber escrito) y los usuarios de Supabase. */
export async function borrarOrgDePrueba(org: OrgDePrueba | undefined): Promise<void> {
  if (!org) return;
  const where = { organizationId: org.id };
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.opportunity.deleteMany({ where });
  await prisma.stage.deleteMany({ where });
  await prisma.pipeline.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.knowledgeBaseEntry.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: org.id } });
  for (const id of org.authIds) await getSupabaseAdmin().auth.admin.deleteUser(id);
}

/** Levanta la app real en un puerto libre. */
export async function levantarApp(): Promise<{ baseUrl: string; cerrar: () => Promise<void> }> {
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
        cerrar: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

export interface Respuesta {
  status: number;
  json: { error?: Record<string, unknown> } & Record<string, unknown>;
}

/** Un pedido como un ADMIN de `org`, rotando entre sus usuarios (el barrido
 *  hace más de 100 escrituras y businessWriteRateLimiter es por usuario).
 *  token null = sin sesión. */
export function crearPedir(baseUrl: () => string) {
  let turno = 0;
  return async function pedir(
    org: OrgDePrueba,
    metodo: string,
    path: string,
    body?: unknown,
    token: string | null = org.tokens[turno++ % org.tokens.length],
  ): Promise<Respuesta> {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: metodo,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const texto = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      // CSV u otra respuesta que no es JSON: no es un 403 del gate.
    }
    return { status: res.status, json };
  };
}

/** "GET /api/quotes/:id" → método y path con UUIDs inventados en cada
 *  parámetro. */
export function concreta(ruta: string): { metodo: string; path: string } {
  const [metodo, patron] = ruta.split(" ");
  return { metodo, path: patron.replace(/:[A-Za-z]+/g, () => randomUUID()) };
}
