import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  findConexionDeWhatsapp,
  findOrganizacionDelWaba,
  guardarConexionDeWhatsapp,
  revocarConexionDeWhatsapp,
} from "../repositories/whatsappBusinessConnection.repository";
import { AppError } from "../utils/AppError";
import {
  WhatsappGraphError,
  mensajeDeMeta,
  subscribeAppToWabaReal,
  type SubscribeAppToWaba,
} from "./whatsappGraph.service";
import {
  ACCIONES_CON_PLANTILLA,
  depsDePlantillasReales,
  sincronizarPlantillaDeLaRegla,
  type DepsDePlantillas,
} from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// Alta del WABA propio de una clínica por el platform admin (v1 manual,
// docs/whatsapp-alta-clinica.md). La clínica ya nos agregó como socio de su
// WABA y el platform admin lo asignó al System User de la plataforma; acá se
// registra el WABA, se suscribe la app (para que lleguen sus mensajes y los
// estados de sus plantillas) y se vuelven a sincronizar las plantillas de sus
// reglas, que pasan a crearse en ese WABA.
//
// Solo CLINICA: una automotora sigue con el WABA global.
// ---------------------------------------------------------------------------

export interface DepsDeAlta {
  accessToken: () => string | undefined;
  subscribeApp: SubscribeAppToWaba;
  plantillas: DepsDePlantillas;
}

export const depsDeAltaReales: DepsDeAlta = {
  accessToken: depsDePlantillasReales.accessToken,
  subscribeApp: subscribeAppToWabaReal,
  plantillas: depsDePlantillasReales,
};

export const SOLO_CLINICAS = "Solo una clínica conecta su propio número de WhatsApp.";
export const WABA_DE_OTRA_ORGANIZACION =
  "Esa cuenta de WhatsApp (WABA) ya está conectada a otra organización.";
export const DESACTIVA_LAS_REGLAS_PRIMERO =
  "Desactivá primero las reglas de la clínica que mandan WhatsApp.";

async function organizacionClinica(organizationId: string) {
  const organizacion = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, industry: true },
  });
  if (!organizacion) throw new AppError("Organización no encontrada", 404);
  if (organizacion.industry !== "CLINICA") throw new AppError(SOLO_CLINICAS, 400);
  return organizacion;
}

/** GET del platform admin: la conexión de la organización, o null. */
export async function obtenerConexionDeWhatsapp(organizationId: string) {
  await organizacionClinica(organizationId);
  return findConexionDeWhatsapp(organizationId);
}

export interface ResultadoDelAlta {
  conexion: NonNullable<Awaited<ReturnType<typeof findConexionDeWhatsapp>>>;
  // Las reglas con plantilla que se mandaron de nuevo a aprobación, y las que
  // no se pudieron mandar (con el motivo): el alta queda hecha igual.
  reglasSincronizadas: number;
  erroresDeSincronizacion: { automationId: string; error: string }[];
}

export async function conectarWabaDeLaClinica(
  input: { organizationId: string; wabaId: string; platformAdminUserId: string },
  deps: DepsDeAlta = depsDeAltaReales,
): Promise<ResultadoDelAlta> {
  await organizacionClinica(input.organizationId);
  const otra = await findOrganizacionDelWaba(input.wabaId);
  if (otra && otra.organizationId !== input.organizationId) {
    throw new AppError(WABA_DE_OTRA_ORGANIZACION, 409);
  }
  const accessToken = deps.accessToken()?.trim();
  if (!accessToken) {
    logger.error({ faltan: ["WHATSAPP_ACCESS_TOKEN"] }, "Alta de WABA: falta el token");
    throw new AppError(
      "La conexión con WhatsApp no está configurada en la plataforma. Avisale al soporte.",
      503,
    );
  }

  // Antes de guardar: si Meta no deja suscribir la app (la clínica todavía no
  // nos agregó como socio, o el WABA no está asignado al System User), el alta
  // no queda a medias.
  try {
    await deps.subscribeApp({ wabaId: input.wabaId, accessToken });
  } catch (err) {
    const detalle = err instanceof WhatsappGraphError ? mensajeDeMeta(err) : null;
    throw new AppError(
      `Meta no dejó conectar esa cuenta de WhatsApp${detalle ? `: ${detalle}` : ""}. Revisá que la clínica nos haya agregado como socio y que la cuenta esté asignada a la plataforma.`,
      502,
    );
  }

  const conexion = await guardarConexionDeWhatsapp(input.organizationId, input.wabaId);
  logger.info(
    {
      platformAdminUserId: input.platformAdminUserId,
      organizationId: input.organizationId,
      wabaId: input.wabaId,
    },
    "WABA propio de una clínica conectado por platform admin",
  );

  // Sus reglas que mandan WhatsApp: la plantilla pasa a crearse en el WABA
  // propio (sincronizarPlantillaDeLaRegla descarta la del global).
  const reglas = await prisma.automation.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      actionType: { in: [...ACCIONES_CON_PLANTILLA] },
    },
    select: { id: true, actionType: true, actionConfig: true },
  });
  const erroresDeSincronizacion: ResultadoDelAlta["erroresDeSincronizacion"] = [];
  for (const regla of reglas) {
    const { error } = await sincronizarPlantillaDeLaRegla(
      input.organizationId,
      regla,
      deps.plantillas,
    );
    if (error) erroresDeSincronizacion.push({ automationId: regla.id, error });
  }

  return { conexion, reglasSincronizadas: reglas.length, erroresDeSincronizacion };
}

export async function desconectarWabaDeLaClinica(input: {
  organizationId: string;
  platformAdminUserId: string;
}) {
  await organizacionClinica(input.organizationId);
  // Sin WABA propio, una clínica no tiene reglas con plantilla activas
  // (automationWhatsapp.service.ts): se desactivan antes.
  const activas = await prisma.automation.count({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      isActive: true,
      actionType: { in: [...ACCIONES_CON_PLANTILLA] },
    },
  });
  if (activas > 0) throw new AppError(DESACTIVA_LAS_REGLAS_PRIMERO, 409);
  await revocarConexionDeWhatsapp(input.organizationId);
  logger.info(
    { platformAdminUserId: input.platformAdminUserId, organizationId: input.organizationId },
    "WABA propio de una clínica desconectado por platform admin",
  );
  return findConexionDeWhatsapp(input.organizationId);
}
