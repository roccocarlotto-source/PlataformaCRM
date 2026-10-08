import { useRef, type KeyboardEvent } from "react";

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

export interface TabsProps<T extends string> {
  // Nombre accesible de la lista de pestañas ("Vistas de contactos").
  label: string;
  value: T;
  options: TabOption<T>[];
  onChange: (value: T) => void;
}

// ---------------------------------------------------------------------------
// Pestañas de una pantalla (nació con las dos vistas de Contactos, ítem 184
// de docs/frontend-cambios-pendientes.md). Solo la fila de pestañas: qué se
// muestra debajo lo decide el consumidor, que suele llevar la pestaña elegida
// en la URL (?vista=…) para que se pueda enlazar y volver atrás.
//
// Patrón WAI-ARIA "tabs" con activación automática: role=tablist/tab,
// aria-selected en la elegida, una sola pestaña en el orden de tabulación
// (roving tabindex) y flechas izquierda/derecha, Inicio y Fin para moverse.
// Sin tabpanels asociados por id: el contenido de abajo cambia entero con la
// pestaña y no hay dos paneles montados a la vez.
// ---------------------------------------------------------------------------
export function Tabs<T extends string>({ label, value, options, onChange }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function mover(desde: number, hacia: number) {
    const destino = options[hacia];
    if (!destino || hacia === desde) return;
    onChange(destino.value);
    refs.current[hacia]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const ultimo = options.length - 1;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        mover(index, index === ultimo ? 0 : index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        mover(index, index === 0 ? ultimo : index - 1);
        break;
      case "Home":
        event.preventDefault();
        mover(index, 0);
        break;
      case "End":
        event.preventDefault();
        mover(index, ultimo);
        break;
      default:
        break;
    }
  }

  return (
    <div className="ds-tabs" role="tablist" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            className="ds-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
