import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Desplegable de selección múltiple con checkboxes: un botón cerrado que se ve
// como los <select> simples de la barra de filtros y, al abrirse, muestra una
// lista de checkboxes para tildar una o varias opciones. Es un primitivo de UI
// y por eso vive acá y no en el feature que lo estrenó (Stock de vehículos,
// filtro Estado), igual que Modal.
//
// POR QUÉ EXISTE: el <select multiple> nativo se renderiza como una lista
// siempre abierta y scrolleable, no como un desplegable, y al lado de los
// otros filtros de la misma fila se ve roto (docs/frontend-cambios-pendientes.md
// §1). La alternativa de pasar a un <select> de un solo valor se descartó
// porque el backend acepta varios valores a la vez y no se resigna esa
// funcionalidad: el cambio es de presentación, no de qué se puede filtrar.
//
// MARKUP: raíz div > label[for] + button, el mismo patrón que BranchSelect y
// CompanySelect, así la píldora de .ds-filters (div:has(> label[for]) en
// design-system.css) lo detecta sin una regla propia. La lista abierta es un
// hermano posicionado sobre la barra, no un <p>/<ul> de la píldora, para que
// no le cambie el alto a la fila de filtros al abrirse.
//
// SE CIERRA con Escape y con un click afuera, al revés que Modal. Ahí un
// cierre accidental podía ser irreversible (el secreto de una API key); acá
// no se pierde nada al cerrar —la selección queda— y es lo que hace un
// <select> nativo. Con la lista cerrada sus checkboxes no están en el DOM:
// no hay nada que ocultar con CSS ni que sacar del orden de tabulación.
//
// ACCESIBILIDAD: el rótulo se asocia por label[for] (es lo que detecta la
// píldora y lo que usa getByLabelText en los tests). Pero un label[for] solo
// pisa el contenido del botón —el nombre accesible sería "Estado" y el valor
// elegido no se anunciaría—, así que el botón lleva además
// aria-labelledby="rótulo valor", donde "valor" es el <span> con el texto de
// adentro del botón: el nombre queda "Estado Todos" / "Estado Reservado",
// como en el patrón de botón de menú de WAI-ARIA. No se referencia al botón
// mismo porque ahí volvería a mandar el label[for]. aria-expanded +
// aria-controls dicen si está abierto y qué abre. La lista es role="group"
// con el mismo rótulo: son checkboxes, no un menú.
// ---------------------------------------------------------------------------

export interface MultiSelectOption<T extends string> {
  value: T;
  label: string;
}

export interface MultiSelectProps<T extends string> {
  id?: string;
  label: string;
  options: MultiSelectOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  // Texto del botón sin selección. "Todos" por defecto; el consumidor lo
  // cambia según el género de lo que lista ("Todas").
  emptyLabel?: string;
}

// Lo que muestra el botón cerrado, para entender de un vistazo qué está
// filtrado sin abrirlo: el nombre del único elegido, o cuántos hay.
function triggerText<T extends string>(
  value: T[],
  options: MultiSelectOption<T>[],
  emptyLabel: string,
): string {
  if (value.length === 0) return emptyLabel;
  if (value.length === 1) {
    return options.find((option) => option.value === value[0])?.label ?? "1 seleccionado";
  }
  return `${value.length} seleccionados`;
}

export function MultiSelect<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  emptyLabel = "Todos",
}: MultiSelectProps<T>) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const labelId = `${triggerId}-label`;
  const valueId = `${triggerId}-value`;
  const menuId = `${triggerId}-menu`;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Click afuera: se escucha en document solo mientras está abierto, y
  // pointerdown (no click) para cerrar antes de que el click aterrice en lo
  // que sea que haya afuera. Un click adentro de la raíz no cierra.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    // Devolver el foco al botón: si estaba en un checkbox de la lista, esa
    // lista deja de existir y el foco caería al body.
    triggerRef.current?.focus();
  }

  // El resultado sigue el orden de las opciones, no el de los clicks: el
  // mismo conjunto elegido produce siempre la misma query (y la misma
  // queryKey), se haya tildado en el orden que sea.
  function toggle(toggled: T) {
    const selected = new Set(value);
    if (selected.has(toggled)) {
      selected.delete(toggled);
    } else {
      selected.add(toggled);
    }
    onChange(options.map((option) => option.value).filter((option) => selected.has(option)));
  }

  return (
    <div ref={rootRef} className="ds-multiselect" onKeyDown={handleKeyDown}>
      <label id={labelId} htmlFor={triggerId}>
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        className="ds-multiselect-trigger"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span id={valueId}>{triggerText(value, options, emptyLabel)}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} role="group" aria-labelledby={labelId} className="ds-multiselect-menu">
          {options.map((option) => (
            <label key={option.value} className="ds-multiselect-option">
              <input
                type="checkbox"
                checked={value.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
