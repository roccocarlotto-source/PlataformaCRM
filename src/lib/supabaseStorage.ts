import { getSupabaseAdmin } from "./supabaseAdmin";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Supabase Storage con el cliente service_role — primera vez que el proyecto
// habla con Storage (fotos de vehículos, Fase 2b). Acá vive lo que NO es del
// módulo de vehículos: crear un bucket sin pasos manuales, subir/borrar un
// objeto y firmar URLs de lectura. Un módulo futuro (documentos de una
// oportunidad, logos de la organización) reutiliza esto con su propio bucket.
//
// TODA FALLA DE STORAGE ES UN AppError 502 NO OPERACIONAL: el cliente recibe
// el "Error interno del servidor" genérico de errorHandler y el log se queda
// con el mensaje real (nombre del bucket, ruta, texto de Storage). Es una
// dependencia externa que falló, no un error del cliente —mismo criterio que
// getSupabaseAdmin cuando faltan las variables— y 502 y no 500 para que en el
// log se distinga "Storage no respondió" de "explotó el código".
// ---------------------------------------------------------------------------

export interface BucketSpec {
  name: string;
  // Tamaño máximo por objeto y tipos admitidos, sostenidos por el propio
  // Storage además del middleware: la defensa que sobrevive a un camino de
  // subida que no pase por multer.
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

function storageError(accion: string, detalle: string): AppError {
  return new AppError(`Storage: ${accion}: ${detalle}`, 502, false);
}

// Una promesa por bucket, no un booleano: dos requests que llegan a la vez al
// primer uso comparten la MISMA comprobación en vez de intentar crear el
// bucket dos veces. Si falla, se olvida para que el próximo request vuelva a
// intentar (una caída transitoria de Storage no puede dejar el proceso
// creyendo que el bucket no existe hasta que se reinicie).
const bucketsAsegurados = new Map<string, Promise<void>>();

// Idempotente: getBucket y, solo si no existe, createBucket. NO se deja como
// paso manual del dashboard — docs/supabase-setup.md documenta cómo terminan
// los pasos manuales sin registrar en este proyecto. Una carrera entre dos
// procesos (dos instancias del backend arrancando a la vez) la resuelve el
// propio Storage: el segundo createBucket falla con "already exists" y eso se
// trata como éxito.
export function ensureBucket(spec: BucketSpec): Promise<void> {
  const enCurso = bucketsAsegurados.get(spec.name);
  if (enCurso) {
    return enCurso;
  }
  const promesa = ensureBucketOnce(spec).catch((err: unknown) => {
    bucketsAsegurados.delete(spec.name);
    throw err;
  });
  bucketsAsegurados.set(spec.name, promesa);
  return promesa;
}

async function ensureBucketOnce(spec: BucketSpec): Promise<void> {
  const storage = getSupabaseAdmin().storage;

  const existente = await storage.getBucket(spec.name);
  if (existente.data) {
    return;
  }
  // getBucket responde error también cuando el bucket no existe (404): la
  // única forma de distinguirlo de una caída es intentar crearlo.
  const creado = await storage.createBucket(spec.name, {
    public: false,
    fileSizeLimit: spec.fileSizeLimit,
    allowedMimeTypes: spec.allowedMimeTypes,
  });
  if (creado.error && !/already exists/i.test(creado.error.message)) {
    throw storageError(
      `no se pudo crear el bucket "${spec.name}"`,
      `${creado.error.message} (getBucket: ${existente.error?.message ?? "sin detalle"})`,
    );
  }
}

// upsert: false — la ruta lleva un uuid generado por el service, así que una
// colisión sería un bug, no un reemplazo deseado; que falle antes que pisar.
export async function uploadObject(
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .upload(path, body, { contentType, upsert: false });
  if (error) {
    throw storageError(`no se pudo subir "${path}" al bucket "${bucket}"`, error.message);
  }
}

export async function removeObject(bucket: string, path: string): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from(bucket).remove([path]);
  if (error) {
    throw storageError(`no se pudo borrar "${path}" del bucket "${bucket}"`, error.message);
  }
}

// URLs firmadas de lectura para un lote de rutas, en UN solo request a
// Storage. Devuelve un mapa ruta -> URL; una ruta que Storage no pudo firmar
// (objeto que ya no existe) queda sin entrada, y es el caller el que decide
// qué mostrar en su lugar.
export async function createSignedReadUrls(
  bucket: string,
  paths: string[],
  expiresInSeconds: number,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) {
    return urls;
  }
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrls(paths, expiresInSeconds);
  if (error) {
    throw storageError(`no se pudieron firmar URLs del bucket "${bucket}"`, error.message);
  }
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) {
      urls.set(item.path, item.signedUrl);
    }
  }
  return urls;
}
