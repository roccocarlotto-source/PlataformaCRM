import { Button } from "../../design-system/Button";
import type { Weekday } from "./types";
import {
  WEEKDAYS,
  WEEKDAY_LABEL,
  franjaSugerida,
  type Franja,
  type HorarioSemanal,
} from "./workingHours";

// ---------------------------------------------------------------------------
// Editor del horario laboral de un recurso (ítem 75): los siete días, cada uno
// con cero, una o varias franjas "desde–hasta" que se agregan y se quitan.
//
// Mismo esquema que source/FieldMappingEditor.tsx —el único precedente de
// "lista de filas editable" del proyecto— y con la misma regla: NO VALIDA
// NADA. Las reglas (formato, inicio antes que fin, superposición, tope) viven
// en workingHours.ts y las corre el formulario al guardar, en un solo lugar.
//
// LAS HORAS SON TEXTO "HH:MM" Y NO <input type="time">, a propósito: el backend
// acepta "24:00" como fin del día (una franja que llega hasta la medianoche) y
// un input de tipo time no puede mostrarlo — un recurso con esa franja cargada
// por API aparecería vacío. Tampoco llevan pattern ni required: el mensaje
// nativo del navegador diría "formato incorrecto" sin decir qué día; el de
// validarHorario sí.
// ---------------------------------------------------------------------------

export interface WorkingHoursEditorProps {
  value: HorarioSemanal;
  onChange: (value: HorarioSemanal) => void;
  disabled?: boolean;
}

export function WorkingHoursEditor({ value, onChange, disabled }: WorkingHoursEditorProps) {
  function cambiarDia(dia: Weekday, franjas: Franja[]) {
    onChange({ ...value, [dia]: franjas });
  }

  return (
    <div className="ds-stack">
      {WEEKDAYS.map((dia) => {
        const franjas = value[dia];
        const nombre = WEEKDAY_LABEL[dia];
        return (
          <fieldset key={dia} className="ds-field">
            <legend className="ds-field-label">{nombre}</legend>

            {franjas.length === 0 ? (
              <p className="ds-hint">No atiende.</p>
            ) : (
              <ol className="ds-mapping-rows">
                {franjas.map((franja, index) => (
                  // Índice como key, mismo motivo que FieldMappingEditor: el
                  // contenido es lo que cambia mientras se tipea, y las
                  // franjas no se reordenan en pantalla.
                  <li key={index} className="ds-mapping-row">
                    <label>
                      <span className="ds-field-label">Desde</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="09:00"
                        value={franja.startTime}
                        disabled={disabled}
                        aria-label={`${nombre}, franja ${index + 1}: desde`}
                        onChange={(event) =>
                          cambiarDia(
                            dia,
                            franjas.map((f, i) =>
                              i === index ? { ...f, startTime: event.target.value } : f,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      <span className="ds-field-label">Hasta</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="18:00"
                        value={franja.endTime}
                        disabled={disabled}
                        aria-label={`${nombre}, franja ${index + 1}: hasta`}
                        onChange={(event) =>
                          cambiarDia(
                            dia,
                            franjas.map((f, i) =>
                              i === index ? { ...f, endTime: event.target.value } : f,
                            ),
                          )
                        }
                      />
                    </label>
                    <Button
                      variant="danger"
                      disabled={disabled}
                      onClick={() =>
                        cambiarDia(
                          dia,
                          franjas.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={`Quitar la franja ${index + 1} del ${nombre}`}
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ol>
            )}

            <div>
              <Button
                disabled={disabled}
                onClick={() => cambiarDia(dia, [...franjas, franjaSugerida(franjas)])}
                aria-label={`Agregar una franja al ${nombre}`}
              >
                Agregar franja
              </Button>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
