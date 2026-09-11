import { useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import {
  EQUIPMENT_CODE_MAX,
  EQUIPMENT_MAX_ITEMS,
  finalizeEquipmentCode,
  normalizeEquipmentCode,
} from "./equipment";

export interface EquipmentFieldProps {
  label: string;
  value: string[];
  onChange: (codes: string[]) => void;
}

// ---------------------------------------------------------------------------
// Campo "Equipamiento" de la ficha de vehículo como lista de chips
// (docs/frontend-cambios-pendientes.md §21): un input con "+ Agregar
// equipamiento" suma un ítem nombrado individualmente; cada ítem es un chip
// con su ✕. Reemplaza al texto "separado por comas" donde sacar uno obligaba
// a editar el blob entero.
//
// EL TEXTO QUE SE ESTÁ TIPEANDO VIVE ACÁ, NO EN EL FORMULARIO: todavía no es
// equipamiento. `value` es la lista confirmada, ya en la forma que el backend
// exige, y es lo único que el formulario conoce y manda. Lo tipeado y no
// agregado se pierde al guardar, como cualquier dato que no se confirmó; no
// se agrega solo al enviar para no guardar a escondidas algo que la persona
// no confirmó.
//
// LOS LÍMITES DEL BACKEND SE APLICAN ANTES DE QUE EXISTA UN CHIP INVÁLIDO:
// el input normaliza en vivo (normalizeEquipmentCode) y corta a 50; un
// duplicado —comparando ya normalizado— no se agrega y avisa; con 100 ítems
// no se puede agregar más. Todo lo que entra a `value` ya es válido, así que
// el formulario no necesita chequear nada al enviar.
//
// SIN FormField: es un <label> que envuelve a su hijo, y el control rotulado
// de un label es su primer descendiente rotulable; con los botones ✕ adentro,
// un click en el rótulo activaría la primera ✕. Se arma el .ds-field a mano
// con label[for] al input, mismo patrón que BranchSelect/UserSelect.
//
// Vive en features/vehicle/ y no en design-system/ por el mismo criterio que
// FieldMappingEditor: hoy tiene un único consumidor.
// ---------------------------------------------------------------------------
export function EquipmentField({ label, value, onChange }: EquipmentFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const isFull = value.length >= EQUIPMENT_MAX_ITEMS;

  function handleDraftChange(raw: string) {
    setDraft(normalizeEquipmentCode(raw));
    if (addError !== null) setAddError(null);
  }

  function add() {
    const code = finalizeEquipmentCode(draft);
    if (code === "" || isFull) return;
    if (value.includes(code)) {
      setAddError(`${code} ya está en la lista.`);
      return;
    }
    onChange([...value, code]);
    // Queda vacío y con el foco para cargar el siguiente sin volver a hacer
    // click: con Enter el foco ya estaba ahí, con el botón hay que devolverlo.
    setDraft("");
    setAddError(null);
    inputRef.current?.focus();
  }

  function remove(code: string) {
    onChange(value.filter((item) => item !== code));
    if (addError !== null) setAddError(null);
  }

  // Enter agrega el chip, no envía el formulario (sería el submit implícito
  // de un input de texto dentro de un <form>).
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  }

  return (
    <div className="ds-field">
      <label htmlFor={inputId} className="ds-field-label">
        {label}
      </label>
      {value.length > 0 ? (
        <ul className="ds-chip-list" aria-label={`${label} cargado`}>
          {value.map((code) => (
            <li key={code}>
              <Badge variant="neutral">
                {code}
                <button
                  type="button"
                  className="ds-chip-remove"
                  aria-label={`Quitar ${code}`}
                  onClick={() => remove(code)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ds-chip-add">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={EQUIPMENT_CODE_MAX}
          placeholder="Ej. Aire acondicionado"
          disabled={isFull}
          onChange={(event) => handleDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button type="button" onClick={add} disabled={isFull || draft === ""}>
          + Agregar equipamiento
        </Button>
      </div>
      {addError !== null ? (
        <p className="ds-error" role="alert">
          {addError}
        </p>
      ) : null}
      {isFull ? (
        <p className="ds-hint">Llegaste al máximo de {EQUIPMENT_MAX_ITEMS} ítems.</p>
      ) : null}
    </div>
  );
}
