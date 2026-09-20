import { Router } from "express";
import {
  createKnowledgeBaseEntryHandler,
  deleteKnowledgeBaseEntryHandler,
  extraerTextoDeArchivoHandler,
  getKnowledgeBaseEntryHandler,
  listKnowledgeBaseEntriesHandler,
  syncVehiclesHandler,
  updateKnowledgeBaseEntryHandler,
} from "../controllers/knowledgeBaseEntry.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { knowledgeBaseUpload } from "../middlewares/knowledgeBaseUpload";
import {
  businessWriteRateLimiter,
  knowledgeBaseExtractRateLimiter,
} from "../middlewares/rateLimit";

export const knowledgeBaseEntryRouter = Router();

// Mismo esquema de permisos que agent.routes.ts y branch.routes.ts: lectura
// para cualquier usuario autenticado de la organización, escritura solo ADMIN.
// No se inventó nada nuevo — Role sigue teniendo ADMIN/USER y nada más.
knowledgeBaseEntryRouter.get("/knowledge-base", authenticate, listKnowledgeBaseEntriesHandler);
knowledgeBaseEntryRouter.get("/knowledge-base/:id", authenticate, getKnowledgeBaseEntryHandler);

// businessWriteRateLimiter (R1.9) va después de authenticate —necesita
// req.auth.userId— y antes de authorize. Mismo orden que agent.routes.ts.
knowledgeBaseEntryRouter.post(
  "/knowledge-base",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  createKnowledgeBaseEntryHandler,
);
knowledgeBaseEntryRouter.patch(
  "/knowledge-base/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  updateKnowledgeBaseEntryHandler,
);
knowledgeBaseEntryRouter.delete(
  "/knowledge-base/:id",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  deleteKnowledgeBaseEntryHandler,
);

// ---------------------------------------------------------------------------
// Extracción de texto de un archivo (ítem 60). No guarda nada: sube, extrae y
// devuelve. Es a POST /knowledge-base lo que POST /imports/preview es a POST
// /imports, y por eso comparte casi todo su armado con import.routes.ts.
//
// SE DECLARA ÚLTIMO y no choca con nada: los únicos handlers que matchean un
// path de dos segmentos bajo /knowledge-base son PATCH y DELETE sobre /:id, y
// este es un POST. El POST que existe es sobre /knowledge-base a secas.
//
// LLEVA authorize("ADMIN") AUNQUE NO ESCRIBA NADA, igual que el resto de este
// router: quien carga la base de conocimiento es un ADMIN, y un USER no tiene
// ninguna pantalla desde la que subir un archivo acá.
//
// EL ORDEN DE LOS CUATRO MIDDLEWARES ES EL MISMO QUE EL DE import.routes.ts y
// por la misma razón: knowledgeBaseUpload va DESPUÉS de authorize porque
// parsear un multipart —y después abrir un PDF o descomprimir un .docx— es el
// trabajo más caro de la cadena, y no hay ninguna razón para hacerlo por
// alguien que todavía no probó ser ADMIN de la organización. El limiter va
// entre authenticate y authorize porque necesita req.auth.userId.
//
// SU PROPIO LIMITER y no businessWriteRateLimiter: acá no hay ninguna escritura
// que frene naturalmente el costo. El razonamiento completo está en
// middlewares/rateLimit.ts.
// ---------------------------------------------------------------------------
knowledgeBaseEntryRouter.post(
  "/knowledge-base/extract-text",
  authenticate,
  knowledgeBaseExtractRateLimiter,
  authorize("ADMIN"),
  knowledgeBaseUpload,
  extraerTextoDeArchivoHandler,
);

// ---------------------------------------------------------------------------
// Sincronizar el stock con la base de conocimiento (ítem 70). Escribe entradas
// —las crea, las actualiza y las da de baja—, así que lleva exactamente la
// misma cadena que el POST de una entrada: authenticate, el limiter de
// escrituras de negocio y authorize("ADMIN").
//
// NO CHOCA CON NINGUNA RUTA de arriba por la misma razón que extract-text: los
// únicos handlers sobre un path de dos segmentos bajo /knowledge-base son
// PATCH y DELETE de /:id, y este es un POST.
// ---------------------------------------------------------------------------
knowledgeBaseEntryRouter.post(
  "/knowledge-base/sync-vehicles",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  syncVehiclesHandler,
);
