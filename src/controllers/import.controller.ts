import type { Response } from "express";
import { z } from "zod";
import { importarArchivo, obtenerResumenDeLote } from "../services/import.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const batchIdParamSchema = z.string().uuid("batchId inválido");

// sourceId viaja como campo de texto del multipart, no en el path. La ruta es
// plana (/api/imports) por la convención que apiKey.routes.ts documenta, y en un
// multipart un campo más no cuesta nada: multer deja los campos de texto en
// req.body una vez que terminó de procesar el cuerpo entero, así que acá ya
// está completo sin importar en qué orden viajaron.
const importBodySchema = z.object({
  sourceId: z.string().uuid("sourceId inválido"),
});

// 202 ACCEPTED, igual que el webhook y por la misma razón: no se creó ningún
// contacto todavía. Se aceptaron N filas para procesarlas después, y la
// promoción puede terminar en FAILED (§5). Devolver 201 haría creer que los
// contactos ya existen.
//
// La respuesta trae el batchId, que es lo único con lo que después se puede
// consultar el resultado, y los encabezados detectados: sin ellos, un ADMIN
// cuyas filas fallaron todas por una tilde en un encabezado no tiene forma de
// verlo sin volver a abrir el archivo.
export const importarArchivoHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const { sourceId } = parseOrThrow(importBodySchema, req.body);

    // importUpload ya garantizó que existe y cortó con 400 si no — el non-null
    // está respaldado por el middleware, igual que req.auth lo está por
    // authenticate.
    const archivo = req.file!;

    const resultado = await importarArchivo(req.auth.organizationId, {
      sourceId,
      nombreArchivo: archivo.originalname,
      contenido: archivo.buffer,
    });

    res.status(202).json(resultado);
  },
);

// §5, literal: "El resultado del lote tiene que ser consultable: cuántos
// entraron, cuántos se promovieron, cuántos fallaron y por qué. Sin esto la
// importación es una caja negra y el usuario no puede corregir nada."
//
// Se puede consultar en cualquier momento, incluido mientras el worker todavía
// está drenando: `pendientes` es lo que falta. No hay estado de "lote terminado"
// porque no hace falta inventarlo — pendientes === 0 lo dice.
export const resumenDeLoteHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const batchId = parseOrThrow(batchIdParamSchema, req.params.batchId);
    const resumen = await obtenerResumenDeLote(req.auth.organizationId, batchId);
    res.status(200).json(resumen);
  },
);
