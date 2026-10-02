import { prisma } from "../lib/prisma";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import {
  findBusinessHoursByBranch,
  replaceBusinessHours,
} from "../repositories/branchBusinessHours.repository";
import { AppError } from "../utils/AppError";
import { atencionFueraDeHorario, type AtencionFueraDeHorario } from "../utils/fueraDeHorario";
import { HORARIO_POR_DEFECTO, proximoMomentoParaEnviar } from "../utils/horarioDeAtencion";
import { encontrarFranjasSuperpuestas } from "../utils/workingHours";
import { serializarFranja, type FranjaEntrante, type FranjaPublica } from "./workingHours.service";

// ---------------------------------------------------------------------------
// Horario de atención de la sucursal — G-07 de
// docs-privados/auditoria-2026-09-30-corta.md (local, no está en GitHub).
//
// Mismo formato, mismas validaciones y misma serialización que el horario de
// los recursos (workingHours.service.ts): una sola forma de expresar un
// horario en el sistema. Lo leen:
//   - la ventana de envío de los mensajes que inicia el negocio
//     (proximaAperturaDeLaSucursal, desde los workers de seguimiento con QR y
//     de cupón), con el default si no hay horario cargado;
//   - lo que se le dice al cliente cuando pide una persona fuera de horario
//     (atencionFueraDeHorarioDeLaSucursal y utils/fueraDeHorario.ts): la
//     derivación del agente y el aviso de "no hay nadie disponible". Solo con
//     horario cargado. Las respuestas del agente siguen 24/7.
// ---------------------------------------------------------------------------

export interface HorarioDeAtencionPublico {
  // false = la sucursal no cargó el suyo y rige el default.
  configured: boolean;
  businessHours: FranjaPublica[];
  // Siempre presente, para que la pantalla muestre qué rige sin cargar nada.
  defaultBusinessHours: FranjaPublica[];
}

const DEFAULT_PUBLICO = HORARIO_POR_DEFECTO.map(serializarFranja);

function aPublico(franjas: Parameters<typeof serializarFranja>[0][]): HorarioDeAtencionPublico {
  return {
    configured: franjas.length > 0,
    businessHours: franjas.map(serializarFranja),
    defaultBusinessHours: DEFAULT_PUBLICO,
  };
}

async function validarSucursal(organizationId: string, branchId: string) {
  const sucursal = await findBranchById(branchId, organizationId);
  if (!sucursal) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 404);
  }
  return sucursal;
}

export async function getBusinessHours(
  organizationId: string,
  branchId: string,
): Promise<HorarioDeAtencionPublico> {
  await validarSucursal(organizationId, branchId);
  return aPublico(await findBusinessHoursByBranch(branchId, organizationId));
}

// Reemplaza la semana entera. `[]` borra el horario propio: vuelve al default.
export async function replaceBusinessHoursForBranch(
  organizationId: string,
  branchId: string,
  franjas: FranjaEntrante[],
): Promise<HorarioDeAtencionPublico> {
  await validarSucursal(organizationId, branchId);

  const superpuesta = encontrarFranjasSuperpuestas(franjas);
  if (superpuesta) {
    throw new AppError(
      `Hay franjas superpuestas el día ${superpuesta.weekday}: revisá que no se pisen entre sí`,
      400,
    );
  }

  const guardadas = await prisma.$transaction(async (tx) => {
    // Mismo lock que el resto de las escrituras que cuelgan de una sucursal:
    // serializa contra deleteBranch y contra otro reemplazo concurrente.
    await lockBranchForUpdate(branchId, organizationId, tx);
    if (!(await findBranchById(branchId, organizationId, tx))) {
      throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 404);
    }
    return replaceBusinessHours(branchId, organizationId, franjas, tx);
  });

  return aPublico(guardadas);
}

// Cuándo se puede mandar un mensaje que inicia el negocio desde esta
// sucursal: `ahora` si está abierta, o su próxima apertura. Si la sucursal no
// existe (borrada entre el agendado y el envío), `ahora`: decidir si el envío
// todavía corresponde es trabajo de quien llama, no de la ventana.
export async function proximaAperturaDeLaSucursal(
  organizationId: string,
  branchId: string,
  ahora: Date,
): Promise<Date> {
  const [sucursal, franjas] = await Promise.all([
    findBranchById(branchId, organizationId),
    findBusinessHoursByBranch(branchId, organizationId),
  ]);
  if (!sucursal) {
    return ahora;
  }
  return proximoMomentoParaEnviar(franjas, sucursal.timezone, ahora);
}

// Para un mensaje al cliente que promete que alguien le va a escribir: null si
// la sucursal está abierta, no tiene horario cargado o no existe (el mensaje
// queda como siempre); si no, cuándo atiende y cuándo abre
// (utils/fueraDeHorario.ts).
export async function atencionFueraDeHorarioDeLaSucursal(
  organizationId: string,
  branchId: string,
  ahora: Date,
): Promise<AtencionFueraDeHorario | null> {
  const [sucursal, franjas] = await Promise.all([
    findBranchById(branchId, organizationId),
    findBusinessHoursByBranch(branchId, organizationId),
  ]);
  if (!sucursal) {
    return null;
  }
  return atencionFueraDeHorario(franjas, sucursal.timezone, ahora);
}
