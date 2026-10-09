import type { Response } from "express";
import { OrganizationEdition } from "@prisma/client";
import { z } from "zod";
import { edicionesDisponibles } from "../config/ediciones";
import { listActiveOrganizations } from "../repositories/organization.repository";
import { DIAS_DE_LA_VISTA_DE_USO, gastoPorOrganizacion } from "../services/llmUsage.service";
import {
  cambiarEdicionDeOrganizacion,
  createOrganizationWithFoundingAdmin,
} from "../services/organizationAdmin.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Endpoint de platform admin para dar de alta una organización nueva con su
// primer ADMIN (Fase 4a del módulo SaaS). Corre detrás de authenticate +
// requirePlatformAdmin — NO authorize("ADMIN"), deliberado: ver
// middlewares/requirePlatformAdmin.ts.
// ---------------------------------------------------------------------------

// Mismas reglas que onboarding.schema.ts para los campos equivalentes
// (organizationName / fullName / email). No se comparte el objeto porque el de
// onboarding arrastra password y otp, que acá no existen.
export const createOrganizationSchema = z.object({
  organizationName: z
    .string({ required_error: "organizationName es requerido" })
    .trim()
    .min(1, "organizationName es requerido")
    .max(255, "organizationName no puede superar los 255 caracteres"),
  adminFullName: z
    .string({ required_error: "adminFullName es requerido" })
    .trim()
    .min(1, "adminFullName es requerido")
    .max(255, "adminFullName no puede superar los 255 caracteres"),
  adminEmail: z
    .string({ required_error: "adminEmail es requerido" })
    .trim()
    .email("adminEmail inválido"),
  // docs/ediciones.md §1.1. Opcional: sin ella, COMPLETA. Si es una edición
  // que todavía no se ofrece (ESENCIAL_HABILITADA), el service responde 400.
  edition: z.nativeEnum(OrganizationEdition, { invalid_type_error: "edition inválida" }).optional(),
});

const organizationIdSchema = z.string().uuid("organizationId inválido");

const cambiarEdicionSchema = z
  .object({
    edition: z.nativeEnum(OrganizationEdition, {
      required_error: "edition es requerida",
      invalid_type_error: "edition inválida",
    }),
  })
  .strict();

export const createOrganizationHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createOrganizationSchema, req.body);
    const result = await createOrganizationWithFoundingAdmin(input);
    res.status(201).json(result);
  },
);

// Las ediciones que se pueden elegir hoy en el alta, en el orden en que se
// muestran. La pantalla de Plataforma no tiene una constante propia: si hay
// una sola, no muestra el selector (docs/ediciones.md §10, PR 4).
export const listEditionsHandler = asyncHandler<AuthenticatedRequest>(
  async (_req, res: Response) => {
    res.status(200).json({ editions: edicionesDisponibles() });
  },
);

// Subir de edición: solo ESENCIAL → COMPLETA (ver cambiarEdicionDeOrganizacion).
export const changeOrganizationEditionHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const organizationId = parseOrThrow(organizationIdSchema, req.params.organizationId);
    const { edition } = parseOrThrow(cambiarEdicionSchema, req.body);
    res.status(200).json(await cambiarEdicionDeOrganizacion(organizationId, edition));
  },
);

// El listado de organizaciones vigentes, para el selector de las pantallas de
// plataforma (la conexión con Facebook, 02/10/2026). Sin paginación: es una
// herramienta interna y la plataforma tiene decenas de clientes, no miles.
export const listOrganizationsHandler = asyncHandler<AuthenticatedRequest>(
  async (_req, res: Response) => {
    res.status(200).json(await listActiveOrganizations());
  },
);

// B4: el gasto en el modelo por organización de los últimos 30 días, para la
// vista de plataforma (Configuración → Uso de IA). Solo platform admin: es
// información de la plataforma sobre sus clientes, no de ningún tenant.
export const listLlmUsageHandler = asyncHandler<AuthenticatedRequest>(
  async (_req, res: Response) => {
    res.status(200).json({
      dias: DIAS_DE_LA_VISTA_DE_USO,
      organizaciones: await gastoPorOrganizacion(DIAS_DE_LA_VISTA_DE_USO),
    });
  },
);
