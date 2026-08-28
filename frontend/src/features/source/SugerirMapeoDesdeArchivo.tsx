import { useState } from "react";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { previewImport } from "../import/api";
import { validarArchivo } from "../import/fileValidation";

// ---------------------------------------------------------------------------
// Sube un archivo de MUESTRA y devuelve sus encabezados, para precargar filas
// del mapeo en vez de tipearlas.
//
// NO GUARDA NADA, ni acá ni en el backend: POST /api/imports/preview es de solo
// lectura (no crea IngestionEvent, no toca la Source). El archivo de muestra no
// se importa — para eso está la pantalla de importación, que es otra cosa. Lo
// único que se lleva de acá son los nombres de las columnas.
//
// Y NO APLICA EL MAPEO: entrega los encabezados al formulario, que agrega las
// filas al editor. Quedan visibles y editables, y se persisten recién con el
// botón Guardar del formulario, como cualquier otro campo.
//
// Importa de features/import/ (la llamada al endpoint y la validación del
// archivo) en vez de duplicarlas: es el mismo endpoint y los mismos límites. Hay
// precedente de import cross-feature en el proyecto (companyResolution,
// relationResolution).
// ---------------------------------------------------------------------------

export interface SugerirMapeoDesdeArchivoProps {
  onSugerir: (encabezados: string[]) => void;
  disabled?: boolean;
}

export function SugerirMapeoDesdeArchivo({ onSugerir, disabled }: SugerirMapeoDesdeArchivoProps) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSugerir() {
    setError(null);

    if (!archivo) {
      setError("Elegí un archivo de muestra.");
      return;
    }

    const invalido = validarArchivo(archivo);
    if (invalido) {
      setError(invalido);
      return;
    }

    setCargando(true);
    try {
      const { encabezados } = await previewImport(archivo);
      onSugerir(encabezados);
    } catch (err) {
      // El error se muestra ACÁ y no rompe el resto del formulario: sugerir el
      // mapeo es una ayuda opcional, así que un fallo de red no puede impedir
      // guardar la fuente con el mapeo tipeado a mano.
      setError(
        err instanceof Error
          ? `No pudimos leer el archivo: ${err.message}`
          : "No pudimos leer el archivo.",
      );
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <FormField label="Sugerir mapeo desde un archivo de muestra (.csv o .xlsx)">
        <input
          type="file"
          accept=".csv,.xlsx"
          disabled={disabled}
          onChange={(event) => {
            setArchivo(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </FormField>
      <p className="ds-hint">
        Se leen solo los nombres de las columnas. El archivo no se importa y no se guarda: las filas
        sugeridas quedan editables y se persisten recién al guardar la fuente.
      </p>

      <Button disabled={disabled || cargando} onClick={() => void handleSugerir()}>
        {cargando ? "Leyendo…" : "Sugerir mapeo desde un archivo"}
      </Button>

      {error ? <ErrorState>{error}</ErrorState> : null}
    </div>
  );
}
