import { useState } from "react";
import { FormField } from "../../design-system/FormField";

export interface ProbabilityFieldProps {
  // El valor del formulario tal cual (string, como el resto de los inputs
  // numéricos de estas pantallas): "" si nunca se tocó.
  value: string;
  onChange: (value: string) => void;
}

// Campo "Probabilidad (%)" de una etapa, oculto por defecto detrás de
// "+ Agregar probabilidad" (docs/frontend-cambios-pendientes.md §13, Parte B).
// Compartido por las dos pantallas que lo tienen —StageRowForm (editor
// integrado, StageEditor.tsx) y StageFormPage— para que el comportamiento sea
// uno solo y no dos copias que diverjan.
//
// PURAMENTE DE PRESENTACIÓN: no cambia el contrato con el backend. Si nunca
// se abre, `value` sigue siendo "" y toCreateInput/toUpdateInput no mandan
// probability, así que la etapa queda con el default del backend (0).
//
// VISIBLE DESDE EL ARRANQUE si el valor inicial es distinto de 0 (edición de
// una etapa que ya tiene probabilidad): no tiene sentido esconder un dato que
// ya existe y que la persona probablemente quiera ver o tocar. El valor se
// mira UNA vez, al montar (inicializador de useState): revelar es una decisión
// de la persona y el campo no se vuelve a esconder solo aunque el valor vuelva
// a "" — por ejemplo cuando "Nueva etapa" se vacía tras guardar y la persona
// sigue cargando etapas con probabilidad.
//
// step="any": probability es Decimal(5,2) en el backend y el listado ya
// muestra valores como 37.5%. Sin esto, el step por defecto (1) hace que la
// validación nativa frene el submit de una etapa con decimales al querer
// editarla — no es una restricción del dominio, es un default del navegador.
// (Antes de §13 StageFormPage no lo tenía: era el pendiente menor anotado en
// §11, cerrado de paso al compartir este campo.)
export function ProbabilityField({ value, onChange }: ProbabilityFieldProps) {
  const [isVisible, setIsVisible] = useState(() => Number(value) !== 0);
  // Solo cuando lo abrió un click: el foco pasa al input recién revelado, que
  // es donde la persona quiere escribir. Si arrancó visible, el foco lo decide
  // el formulario (en el editor va al nombre).
  const [revealedByClick, setRevealedByClick] = useState(false);

  if (!isVisible) {
    return (
      <button
        type="button"
        className="ds-text-button"
        onClick={() => {
          setIsVisible(true);
          setRevealedByClick(true);
        }}
      >
        + Agregar probabilidad
      </button>
    );
  }

  return (
    <FormField label="Probabilidad (%)">
      <input
        type="number"
        min={0}
        max={100}
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={revealedByClick}
      />
    </FormField>
  );
}
