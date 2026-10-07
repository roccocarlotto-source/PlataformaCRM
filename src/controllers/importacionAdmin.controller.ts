import type { Response } from "express";
import { z } from "zod";
import { logAccesoADatosPersonales } from "../lib/accessLog";
import {
  decidirFilasSchema,
  listarFilasSchema,
  listarLotesSchema,
  subirImportacionSchema,
} from "../schemas/importacion.schema";
import {
  cancelarImportacion,
  configurarImportacion,
  confirmarImportacion,
  csvDeCambios,
  csvDeFallidas,
  decidirFilasDeImportacion,
  listarFilas,
  listarImportaciones,
  obtenerImportacion,
  opcionesDeImportacion,
  subirImportacion,
} from "../services/importacion.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Plataforma → Importar datos (docs/importacion-de-datos.md §8 y §9.1). Solo
// platform admin (la cadena de rutas lo exige), con la organización del PATH,
// validada: nunca req.auth.organizationId, que es la organización del admin.
// Todo lote se busca CON esa organización: uno de otra da 404.
// ---------------------------------------------------------------------------

const uuid = z.string().uuid("id inválido");

function organizacionDelPath(req: AuthenticatedRequest): string {
  return parseOrThrow(uuid, req.params.organizationId);
}

function loteDelPath(req: AuthenticatedRequest): string {
  return parseOrThrow(uuid, req.params.batchId);
}

// La vista previa y el informe muestran datos personales de los contactos del
// cliente (§9.4, registro de quién mira qué).
function registrarAcceso(req: AuthenticatedRequest, organizationId: string, recurso: string) {
  logAccesoADatosPersonales({
    auth: req.auth,
    recurso,
    clase: "Sensitive",
    detalle: { organizacionImportada: organizationId, batchId: req.params.batchId },
  });
}

export const opcionesHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res.status(200).json(await opcionesDeImportacion(organizacionDelPath(req)));
});

export const subirHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const organizationId = organizacionDelPath(req);
  const pedido = parseOrThrow(subirImportacionSchema, req.body);
  // importUpload ya garantizó que hay archivo.
  const archivo = req.file as Express.Multer.File;
  const resultado = await subirImportacion(organizationId, req.auth.userId, pedido, {
    nombre: archivo.originalname,
    contenido: archivo.buffer,
  });
  res.status(201).json(resultado);
});

export const listarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const paginado = parseOrThrow(listarLotesSchema, req.query);
  const { data, total } = await listarImportaciones(organizacionDelPath(req), paginado);
  res.status(200).json({ data, total, page: paginado.page, pageSize: paginado.pageSize });
});

export const obtenerHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res.status(200).json(await obtenerImportacion(organizacionDelPath(req), loteDelPath(req)));
});

export const configurarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res
    .status(200)
    .json(await configurarImportacion(organizacionDelPath(req), loteDelPath(req), req.body));
});

export const filasHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const organizationId = organizacionDelPath(req);
  const filtro = parseOrThrow(listarFilasSchema, req.query);
  const { data, total } = await listarFilas(organizationId, loteDelPath(req), filtro);
  registrarAcceso(req, organizationId, "importacion.filas");
  res.status(200).json({ data, total, page: filtro.page, pageSize: filtro.pageSize });
});

export const decidirHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const { rowIds, decision } = parseOrThrow(decidirFilasSchema, req.body);
  res
    .status(200)
    .json(
      await decidirFilasDeImportacion(organizacionDelPath(req), loteDelPath(req), rowIds, decision),
    );
});

export const confirmarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res.status(200).json(await confirmarImportacion(organizacionDelPath(req), loteDelPath(req)));
});

export const cancelarHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  res.status(200).json(await cancelarImportacion(organizacionDelPath(req), loteDelPath(req)));
});

function enviarCsv(res: Response, nombre: string, contenido: Buffer) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
  res.status(200).send(contenido);
}

export const csvFallidasHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const organizationId = organizacionDelPath(req);
  const batchId = loteDelPath(req);
  const csv = await csvDeFallidas(organizationId, batchId);
  registrarAcceso(req, organizationId, "importacion.fallidas.csv");
  enviarCsv(res, `filas-fallidas-${batchId}.csv`, csv);
});

export const csvCambiosHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const organizationId = organizacionDelPath(req);
  const batchId = loteDelPath(req);
  const csv = await csvDeCambios(organizationId, batchId);
  registrarAcceso(req, organizationId, "importacion.cambios.csv");
  enviarCsv(res, `cambios-${batchId}.csv`, csv);
});
