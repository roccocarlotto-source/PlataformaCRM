import { useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";

export const MAX_TERMINOS = 100;
const MIN_LARGO = 4;
const MAX_LARGO = 60;

export interface TerminosFieldProps {
  label: string;
  value: string[];
  onChange: (terminos: string[]) => void;
}

// ---------------------------------------------------------------------------
// Los términos que una clínica SUMA al detector de salud (docs/rubros.md §5.3,
// D11 revisada), como lista de chips. Mismo patrón que EquipmentField: lo que
// se está tipeando vive acá y solo entra a `value` al agregarlo; cada chip
// tiene su ✕. Los términos del código no están en esta lista (no se pueden
// sacar): la sección los muestra aparte.
//
// El backend normaliza (minúsculas, sin tildes ni signos) y descarta los que
// ya detecta; acá solo se frena lo que daría un 400 (largo, máximo) y un
// repetido obvio.
// ---------------------------------------------------------------------------
export function TerminosField({ label, value, onChange }: TerminosFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const isFull = value.length >= MAX_TERMINOS;

  function add() {
    const termino = draft.trim();
    if (termino === "" || isFull) return;
    if (termino.length < MIN_LARGO) {
      setAddError(`Cada término tiene que tener al menos ${MIN_LARGO} letras.`);
      return;
    }
    if (value.some((t) => t.toLowerCase() === termino.toLowerCase())) {
      setAddError(`"${termino}" ya está en la lista.`);
      return;
    }
    onChange([...value, termino]);
    setDraft("");
    setAddError(null);
    inputRef.current?.focus();
  }

  function remove(termino: string) {
    onChange(value.filter((t) => t !== termino));
    if (addError !== null) setAddError(null);
  }

  // Enter agrega el chip, no envía el formulario de la página.
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
        <ul className="ds-chip-list" aria-label={`${label} agregados`}>
          {value.map((termino) => (
            <li key={termino}>
              <Badge variant="neutral">
                {termino}
                <button
                  type="button"
                  className="ds-chip-remove"
                  aria-label={`Quitar ${termino}`}
                  onClick={() => remove(termino)}
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
          maxLength={MAX_LARGO}
          disabled={isFull}
          onChange={(event) => {
            setDraft(event.target.value);
            if (addError !== null) setAddError(null);
          }}
          onKeyDown={handleKeyDown}
        />
        <Button type="button" onClick={add} disabled={isFull || draft.trim() === ""}>
          + Agregar
        </Button>
      </div>
      {addError !== null ? <ErrorState>{addError}</ErrorState> : null}
      {isFull ? <p className="ds-hint">Llegaste al máximo de {MAX_TERMINOS} términos.</p> : null}
    </div>
  );
}
