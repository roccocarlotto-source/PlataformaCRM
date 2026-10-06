import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "../../design-system/Button";
import {
  MAX_LARGO_DE_OPCION,
  MAX_OPCIONES,
  nuevaFila,
  partirTextoPegado,
  tieneSeparadores,
  type FilaDeOpcion,
} from "./opciones";

// ---------------------------------------------------------------------------
// Las opciones de un campo de lista, una por FILA: cada una con su input y sus
// botones para subirla, bajarla y borrarla. Reemplaza al textarea "una por
// renglón", donde "Contado, financiado, permuta" escrito en una línea quedaba
// como UNA sola opción sin que nada lo avisara.
//
//   - "+ Agregar opción" suma una fila vacía y le pone el foco;
//   - Enter dentro de una opción pasa a la siguiente (la crea si no existe);
//   - pegar un texto con comas o saltos de línea lo reparte en varias filas;
//   - el orden se cambia con Subir/Bajar: botones y no arrastrar, porque
//     funcionan igual con teclado, con lector de pantalla y con el dedo.
//
// NO VALIDA: las reglas (repetidas, tope, al menos una) viven en opciones.ts y
// las corre el formulario al guardar, mismo criterio que FieldMappingEditor.
// Acá solo se MARCAN las filas que el formulario dice que hay que corregir.
//
// La `key` de cada fila es su id y no el índice: las filas se reordenan, y con
// el índice el foco y el texto quedarían en la fila equivocada.
// ---------------------------------------------------------------------------

export interface OptionListEditorProps {
  filas: FilaDeOpcion[];
  onChange: (filas: FilaDeOpcion[]) => void;
  // Los ids de las filas a corregir (aria-invalid). El motivo lo muestra el
  // formulario, en su mensaje de error.
  filasConError?: readonly string[];
  disabled?: boolean;
}

type Control = "input" | "subir" | "bajar";

export function OptionListEditor({
  filas,
  onChange,
  filasConError = [],
  disabled,
}: OptionListEditorProps) {
  // El <li> de cada fila; sus controles se buscan adentro por data-control.
  const filasEnElDom = useRef(new Map<string, HTMLLIElement>());
  // A qué control hay que llevar el foco después del próximo render: la fila
  // recién creada, o el botón con el que se acaba de mover una.
  const focoPendiente = useRef<{ id: string; control: Control } | null>(null);
  // Lo último que pasó con el orden, para quien no ve la lista moverse.
  const [aviso, setAviso] = useState("");

  function control(id: string, cual: Control): HTMLElement | null {
    return (
      filasEnElDom.current.get(id)?.querySelector<HTMLElement>(`[data-control="${cual}"]`) ?? null
    );
  }

  // Sin dependencias a propósito: corre después de cada render y solo hace
  // algo si un handler dejó un foco pendiente.
  useEffect(() => {
    const pendiente = focoPendiente.current;
    if (!pendiente) return;
    focoPendiente.current = null;
    const elegido = control(pendiente.id, pendiente.control);
    // La fila que llegó al borde deja su botón deshabilitado: el foco pasa al
    // otro, para no perderlo.
    const destino =
      elegido instanceof HTMLButtonElement && elegido.disabled
        ? control(pendiente.id, pendiente.control === "subir" ? "bajar" : "subir")
        : elegido;
    destino?.focus();
  });

  function enfocar(id: string, cual: Control = "input") {
    focoPendiente.current = { id, control: cual };
  }

  function escribir(id: string, texto: string) {
    onChange(filas.map((fila) => (fila.id === id ? { ...fila, texto } : fila)));
  }

  function agregarAlFinal() {
    const ultima = filas.at(-1);
    // Con una fila vacía esperando al final no se apila otra: el foco va ahí.
    if (ultima && ultima.texto.trim().length === 0) {
      control(ultima.id, "input")?.focus();
      return;
    }
    const fila = nuevaFila();
    enfocar(fila.id);
    onChange([...filas, fila]);
  }

  function borrar(index: number) {
    const vecina = filas[index + 1] ?? filas[index - 1];
    if (vecina) enfocar(vecina.id);
    onChange(filas.filter((_, i) => i !== index));
  }

  function mover(index: number, hacia: -1 | 1) {
    const destino = index + hacia;
    if (destino < 0 || destino >= filas.length) return;
    const reordenadas = [...filas];
    [reordenadas[index], reordenadas[destino]] = [reordenadas[destino], reordenadas[index]];
    enfocar(filas[index].id, hacia === -1 ? "subir" : "bajar");
    setAviso(
      `${filas[index].texto.trim() || "La opción"} pasó a la posición ${destino + 1} de ${filas.length}.`,
    );
    onChange(reordenadas);
  }

  // Enter no envía el formulario: pasa a la opción siguiente, y si no hay,
  // la crea. En una fila vacía no hace nada (no se apilan filas vacías).
  function alApretarTecla(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (filas[index].texto.trim().length === 0) return;
    const siguiente = filas[index + 1];
    if (siguiente && siguiente.texto.trim().length === 0) {
      control(siguiente.id, "input")?.focus();
      return;
    }
    const fila = nuevaFila();
    enfocar(fila.id);
    onChange([...filas.slice(0, index + 1), fila, ...filas.slice(index + 1)]);
  }

  // Pegar "Contado, financiado, permuta" (o tres renglones) son tres
  // opciones NUEVAS que reemplazan a esta fila, en su lugar. Ninguna hereda la
  // identidad de la fila: partir una opción guardada no es renombrarla, es
  // eliminarla y crear otras (el diálogo pregunta qué hacer con sus
  // contactos). Un texto sin comas ni saltos se pega como siempre, y esa sí
  // es una edición de la fila.
  function alPegar(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const pegado = event.clipboardData.getData("text");
    if (!tieneSeparadores(pegado)) return;
    event.preventDefault();

    const input = event.currentTarget;
    const desde = input.selectionStart ?? input.value.length;
    const hasta = input.selectionEnd ?? input.value.length;
    const partes = partirTextoPegado(
      input.value.slice(0, desde) + pegado + input.value.slice(hasta),
    );
    if (partes.length === 0) return;

    const nuevas = partes.map((texto) => nuevaFila(texto));
    enfocar(nuevas[nuevas.length - 1].id);
    onChange([...filas.slice(0, index), ...nuevas, ...filas.slice(index + 1)]);
  }

  const alcanzoElTope = filas.length >= MAX_OPCIONES;

  return (
    <fieldset className="ds-field">
      <legend className="ds-field-label">
        <span className="ds-required">Opciones</span>
      </legend>

      {filas.length > 0 ? (
        <ol className="ds-option-rows">
          {filas.map((fila, index) => {
            const posicion = index + 1;
            return (
              <li
                key={fila.id}
                className="ds-option-row"
                ref={(elemento) => {
                  if (elemento) filasEnElDom.current.set(fila.id, elemento);
                  else filasEnElDom.current.delete(fila.id);
                }}
              >
                <input
                  data-control="input"
                  type="text"
                  aria-label={`Opción ${posicion}`}
                  aria-invalid={filasConError.includes(fila.id) || undefined}
                  value={fila.texto}
                  maxLength={MAX_LARGO_DE_OPCION}
                  placeholder={index === 0 ? "Contado" : undefined}
                  disabled={disabled}
                  // "next"/"siguiente" en el teclado del celular, que es lo
                  // que hace Enter acá.
                  enterKeyHint="next"
                  onChange={(event) => escribir(fila.id, event.target.value)}
                  onKeyDown={(event) => alApretarTecla(event, index)}
                  onPaste={(event) => alPegar(event, index)}
                />
                <div className="ds-row-actions">
                  <Button
                    data-control="subir"
                    aria-label={`Subir la opción ${posicion}`}
                    title="Subir"
                    disabled={disabled || index === 0}
                    onClick={() => mover(index, -1)}
                  >
                    <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                  <Button
                    data-control="bajar"
                    aria-label={`Bajar la opción ${posicion}`}
                    title="Bajar"
                    disabled={disabled || index === filas.length - 1}
                    onClick={() => mover(index, 1)}
                  >
                    <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={`Borrar la opción ${posicion}`}
                    title="Borrar"
                    disabled={disabled}
                    onClick={() => borrar(index)}
                  >
                    <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <Button disabled={disabled || alcanzoElTope} onClick={agregarAlFinal}>
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
        Agregar opción
      </Button>

      <p className="ds-hint ds-option-hint">
        {alcanzoElTope
          ? `Llegaste al máximo de ${MAX_OPCIONES} opciones.`
          : "Una opción por fila. Enter pasa a la siguiente; si pegás una lista separada por comas o renglones, se reparte sola. Las filas vacías no se guardan."}
      </p>
      <p className="ds-sr-only" role="status">
        {aviso}
      </p>
    </fieldset>
  );
}
