import { fetchPublico, DescargaRechazada } from "../lib/fetchPublico";
import { AppError } from "../utils/AppError";
import { IMPORT_MAX_FILE_BYTES } from "../utils/spreadsheet";

// ---------------------------------------------------------------------------
// GOOGLE SHEETS POR LINK (docs/importacion-de-datos.md §4.2, decisión 3):
// solo para stock, que no tiene datos personales. El admin pega el link de una
// planilla compartida como "cualquier persona con el enlace puede ver"; el
// backend:
//   1. valida que sea https://docs.google.com/spreadsheets/d/<id>/… y saca el
//      id y la pestaña (gid). Cualquier otra forma se rechaza;
//   2. ARMA ÉL la URL de exportación a CSV: el usuario nunca elige el host;
//   3. la baja con fetchPublico (SSRF, topes), siguiendo redirecciones solo a
//      docs.google.com y *.googleusercontent.com;
//   4. si la respuesta es HTML y no CSV, la planilla no está compartida.
// Lo que entra al staging es la FOTO de la planilla en ese momento: si
// alguien la edita entre la vista previa y la confirmación, se confirma lo
// que se vio. Para la sincronización (PR 10) se guardan el id y la pestaña.
// ---------------------------------------------------------------------------

export interface PlanillaDeSheets {
  sheetId: string;
  gid: string;
}

const ID = /^[A-Za-z0-9_-]{20,100}$/;

export function parsearLinkDeSheets(texto: string): PlanillaDeSheets {
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    throw new AppError("El link no es una URL válida", 400);
  }
  const m = /^\/spreadsheets\/d\/([^/]+)/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !m || !ID.test(m[1])) {
    throw new AppError(
      "El link tiene que ser de una planilla de Google Sheets (https://docs.google.com/spreadsheets/d/…)",
      400,
    );
  }
  // La pestaña: en el fragmento (#gid=123) o en la query (?gid=123); sin ella,
  // la primera (gid 0).
  const gid = /(?:^|[#&])gid=(\d+)/.exec(url.hash)?.[1] ?? url.searchParams.get("gid") ?? "0";
  if (!/^\d{1,12}$/.test(gid)) throw new AppError("La pestaña del link no es válida", 400);
  return { sheetId: m[1], gid };
}

export function urlDeExportacion(p: PlanillaDeSheets): string {
  return `https://docs.google.com/spreadsheets/d/${p.sheetId}/export?format=csv&gid=${p.gid}`;
}

export function esHostDeGoogle(host: string): boolean {
  return host === "docs.google.com" || host.endsWith(".googleusercontent.com");
}

export type DescargarPlanilla = (p: PlanillaDeSheets) => Promise<Buffer>;

const descargarDeGoogle: DescargarPlanilla = async (p) => {
  const descarga = await fetchPublico(urlDeExportacion(p), {
    maxBytes: IMPORT_MAX_FILE_BYTES,
    timeoutMs: 30_000,
    conectarTimeoutMs: 5_000,
    hostPermitido: esHostDeGoogle,
  });
  if ((descarga.contentType ?? "").includes("text/html")) {
    throw new AppError(
      "La planilla no está compartida con el enlace: en Google Sheets, Compartir → «Cualquier persona con el enlace» puede ver",
      400,
    );
  }
  return descarga.buffer;
};

let descargador: DescargarPlanilla = descargarDeGoogle;

// Solo para tests: los tests de integración no salen a internet.
export function usarDescargadorDeSheetsParaTests(otro: DescargarPlanilla | null): void {
  descargador = otro ?? descargarDeGoogle;
}

export async function leerPlanilla(p: PlanillaDeSheets): Promise<Buffer> {
  try {
    return await descargador(p);
  } catch (err) {
    if (err instanceof DescargaRechazada) {
      throw new AppError(`No se pudo leer la planilla: ${err.message}`, 400);
    }
    throw err;
  }
}
