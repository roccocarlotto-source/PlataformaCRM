import { Button } from "../../design-system/Button";
import { FILA_VACIA, type FieldMappingRow } from "./fieldMapping";
import { CAMPOS_DE_CONTACTO, ETIQUETA_DE_CAMPO, MAX_COLUMNAS_MAPEADAS } from "./types";

// ---------------------------------------------------------------------------
// Editor de filas dinámicas para `Source.fieldMapping`.
//
// ES UN COMPONENTE NUEVO Y NO UNA COMPOSICIÓN DE LOS EXISTENTES, a propósito:
// no hay en todo el proyecto ningún precedente de "lista de filas editable"
// —los doce formularios existentes son campos fijos— y ni FormField (que ES un
// <label>, así que no puede envolver varios controles) ni Table (pensado para
// datos de solo lectura) fueron hechos para esto.
//
// Vive en features/source/ y no en design-system/ porque hoy tiene exactamente
// un consumidor. Si mañana aparece un segundo caso de mapeo de columnas —la
// pantalla de importación de la próxima tarea es candidata— ahí sí valdrá la
// pena promoverlo; hacerlo ahora sería generalizar sobre un solo ejemplo.
//
// NO VALIDA NADA. Las reglas (duplicados, topes, filas incompletas) viven en
// fieldMapping.ts y las corre el formulario al enviar, en un solo lugar. Acá lo
// único que se impide es AGREGAR más allá del tope, que no es validación sino
// no ofrecer una acción que no puede terminar bien.
// ---------------------------------------------------------------------------

export interface FieldMappingEditorProps {
  rows: FieldMappingRow[];
  onChange: (rows: FieldMappingRow[]) => void;
  disabled?: boolean;
}

export function FieldMappingEditor({ rows, onChange, disabled }: FieldMappingEditorProps) {
  const alcanzoElTope = rows.length >= MAX_COLUMNAS_MAPEADAS;

  function actualizar(index: number, cambio: Partial<FieldMappingRow>) {
    onChange(rows.map((fila, i) => (i === index ? { ...fila, ...cambio } : fila)));
  }

  function quitar(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="ds-field">
      <legend className="ds-field-label">Mapeo de columnas</legend>
      <p className="ds-hint">
        Solo para fuentes de tipo Importación de archivo. Cada fila dice qué columna del archivo
        corresponde a qué campo del contacto. Sin filas, el archivo se lee con los nombres de campo
        tal cual (firstName, lastName, email…).
      </p>

      {rows.length === 0 ? (
        <p className="ds-empty">No hay columnas mapeadas.</p>
      ) : (
        <ol className="ds-mapping-rows">
          {rows.map((fila, index) => (
            // La key es el índice y no el contenido: el contenido es
            // exactamente lo que está cambiando mientras se tipea, así que
            // usarlo como key haría que React desmontara el input en cada
            // tecla y se perdiera el foco. Las filas no se reordenan, que es la
            // única situación donde el índice como key sería incorrecto.
            <li key={index} className="ds-mapping-row">
              <label>
                <span className="ds-field-label">Columna del archivo</span>
                <input
                  type="text"
                  value={fila.encabezado}
                  placeholder="Nombre"
                  disabled={disabled}
                  onChange={(event) => actualizar(index, { encabezado: event.target.value })}
                />
              </label>
              <label>
                <span className="ds-field-label">Campo del contacto</span>
                <select
                  value={fila.destino}
                  disabled={disabled}
                  onChange={(event) =>
                    actualizar(index, { destino: event.target.value as FieldMappingRow["destino"] })
                  }
                >
                  <option value="">Elegir campo…</option>
                  {CAMPOS_DE_CONTACTO.map((campo) => (
                    <option key={campo} value={campo}>
                      {ETIQUETA_DE_CAMPO[campo]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={() => quitar(index)}
                aria-label={`Quitar la fila ${index + 1} del mapeo`}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ol>
      )}

      <Button
        disabled={disabled || alcanzoElTope}
        onClick={() => onChange([...rows, { ...FILA_VACIA }])}
      >
        Agregar columna
      </Button>

      {alcanzoElTope ? (
        <p role="alert" className="ds-error">
          Llegaste al máximo de {MAX_COLUMNAS_MAPEADAS} columnas mapeadas.
        </p>
      ) : null}
    </fieldset>
  );
}
