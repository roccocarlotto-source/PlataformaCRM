import { EXTENSIONES_SOPORTADAS, IMPORT_MAX_FILE_BYTES } from "./types";

// ---------------------------------------------------------------------------
// Validación del archivo ANTES de mandarlo, sin React.
//
// No reemplaza al backend: multer sigue decidiendo de verdad (413 por tamaño) y
// formatoDesdeNombre también (415 por extensión). Esto existe para no gastar un
// round-trip de hasta 10 MB en algo que ya se sabe que va a fallar, y para poder
// decirlo con un mensaje pensado para una persona en vez del texto de una API.
// Mismo criterio que MAX_COLUMNAS_MAPEADAS en source/types.ts.
//
// La extensión se mira igual que en el backend (formatoDesdeNombre en
// utils/spreadsheet.ts): por el NOMBRE, no por el type del File. En un upload el
// Content-Type lo elige el browser y para un .csv manda cualquier cosa
// (application/vnd.ms-excel es habitual). La extensión es igual de manipulable
// pero al menos es lo que la persona ve.
// ---------------------------------------------------------------------------

// Devuelve el mensaje de error, o null si el archivo pasa.
export function validarArchivo(file: File): string | null {
  const nombre = file.name.toLowerCase();
  const extensionOk = EXTENSIONES_SOPORTADAS.some((ext) => nombre.endsWith(ext));

  if (!extensionOk) {
    return `Formato no soportado: solo se aceptan archivos ${EXTENSIONES_SOPORTADAS.join(" y ")}.`;
  }

  if (file.size > IMPORT_MAX_FILE_BYTES) {
    const maxMb = Math.round(IMPORT_MAX_FILE_BYTES / (1024 * 1024));
    return `El archivo supera el máximo de ${maxMb} MB.`;
  }

  return null;
}
