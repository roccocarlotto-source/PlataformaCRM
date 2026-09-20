import { useId, useRef, type ChangeEvent } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// Selector de archivo del design system (ítem 61).
//
// POR QUÉ EXISTE: hasta acá los cuatro lugares que suben un archivo
// (KnowledgeBaseFormPage, ImportPage, VehiclePhotoGallery y
// SugerirMapeoDesdeArchivo) usaban el <input type="file"> pelado del
// navegador. Ese control no se puede estilar —el botón "Examinar…" lo dibuja
// el sistema operativo, con su propia tipografía y sin padding— así que era la
// única pieza de la plataforma que no se parecía al resto. Mismo motivo por el
// que Select.tsx reemplazó al <select> nativo.
//
// CÓMO FUNCIONA: el <input type="file"> real sigue existiendo y sigue siendo
// quien abre el explorador; lo único que se hace es sacarlo de la vista con
// .ds-sr-only y disparar su click desde un <Button> nuestro. No se usa
// display:none justamente porque .ds-sr-only mantiene al input en el árbol de
// accesibilidad y focuseable por teclado: escondido para el ojo, presente para
// todo lo demás (y también para los tests, que lo siguen encontrando por su
// nombre accesible).
//
// EL RÓTULO ES UN <span>, NO UN <label htmlFor> — y es la única decisión de
// accesibilidad no obvia de este archivo. Un <label> asociado a un input de
// archivo REENVÍA sus clicks al input, así que clickear el texto del rótulo (o
// cualquier parte del <label className="ds-field"> que envolvía a estos
// controles) volvía a abrir el explorador. Eso es exactamente lo que este ítem
// viene a arreglar: el botón tiene que ser lo único clickeable. Se conserva el
// nombre accesible con aria-labelledby apuntando al rótulo visible, que da el
// mismo resultado para un lector de pantalla sin arrastrar el comportamiento
// de click. Sin rótulo visible, el nombre sale de aria-label = buttonLabel.
// ---------------------------------------------------------------------------

export interface FileInputButtonProps {
  // Se llama con el File elegido, o con null si la persona abrió el explorador
  // y canceló. Es el reemplazo del onChange del input nativo.
  onFileSelected: (file: File | null) => void;
  // Rótulo visible arriba del control, con el mismo trato que el de un
  // FormField. Es además el nombre accesible del input real.
  label?: string;
  // Mismo `accept` que llevaba el input nativo de cada pantalla.
  accept?: string;
  disabled?: boolean;
  buttonLabel?: string;
  // El nombre a mostrar al lado del botón. Lo controla el padre a propósito:
  // el input es no controlado y la pantalla puede querer volver a "Ningún
  // archivo elegido" después de un error, aunque el archivo siga elegido.
  selectedFileName?: string | null;
  // La ✕ para volver a "Ningún archivo elegido" (ítem 67). OPCIONAL, y sin él
  // el componente se comporta exactamente como antes de este ítem: no hay
  // botón de quitar y no cambia nada de lo que ya se veía. Es opcional porque
  // "quitar" no significa lo mismo en los cuatro consumidores —en ImportPage
  // sería cancelar la elección antes del submit, en VehiclePhotoGallery la
  // foto ya se subió sola y no hay nada que deshacer— así que el componente no
  // puede decidirlo por ellos: qué se deshace lo sabe la pantalla. Hoy lo usa
  // solo KnowledgeBaseFormPage, donde elegir un archivo PISA el campo
  // Contenido y por eso hay algo concreto que revertir.
  onClear?: () => void;
}

const SIN_ARCHIVO = "Ningún archivo elegido";

export function FileInputButton({
  onFileSelected,
  label,
  accept,
  disabled,
  buttonLabel = "Elegir archivo",
  selectedFileName,
  onClear,
}: FileInputButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    onFileSelected(file);
    // EL INPUT SE LIMPIA SIEMPRE, después de leer files. Un input de archivo es
    // no controlado: si no se resetea el value, elegir el MISMO archivo dos
    // veces seguidas no dispara un segundo change —el valor no cambió— y
    // reintentar después de corregirlo obligaría a elegir otro archivo en el
    // medio. Está acá, en el componente, para que ninguna pantalla tenga que
    // acordarse (KnowledgeBaseFormPage y VehiclePhotoGallery ya lo hacían cada
    // una por su cuenta; ImportPage y SugerirMapeoDesdeArchivo no).
    event.target.value = "";
  }

  return (
    <div className="ds-field">
      {label ? (
        <span className="ds-field-label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div className="ds-file-input">
        {/* tabIndex -1: el input está escondido, así que un foco ahí sería un
            foco invisible. El único lugar donde para el Tab es el botón, que
            se ve y que abre lo mismo con Enter. Sigue nombrado (aria-labelledby)
            para que el control se anuncie con el rótulo del campo. */}
        <input
          ref={inputRef}
          type="file"
          className="ds-sr-only"
          tabIndex={-1}
          accept={accept}
          disabled={disabled}
          onChange={handleChange}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : buttonLabel}
        />
        {/* El botón se llama "Elegir archivo" en los cuatro lugares; lo que
            cambia entre ellos es QUÉ archivo, y eso lo dice el rótulo — de ahí
            el aria-describedby, para que un lector de pantalla lea las dos
            cosas al llegar al botón. */}
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-describedby={label ? labelId : undefined}
        >
          {buttonLabel}
        </Button>
        <span className="ds-file-input__name">{selectedFileName ?? SIN_ARCHIVO}</span>
        {/* Solo con las DOS condiciones: que la pantalla sepa qué deshacer
            (onClear) y que haya algo elegido. Sin archivo no hay nada que
            quitar, así que un ✕ al lado de "Ningún archivo elegido" sería un
            control que no hace nada.

            Mismo marcado que la ✕ de los chips de equipamiento
            (features/vehicle/EquipmentField.tsx): <button type="button"> con
            .ds-chip-remove, el ícono X de lucide en 12px y aria-hidden, y el
            nombre accesible en el aria-label. Lo que NO se copia es el pill:
            el nombre del archivo ya se muestra como texto auxiliar y meterlo
            en un Badge cambiaría el aspecto de los cuatro consumidores por un
            botón que solo tiene uno. De ahí la clase extra.

            El aria-label es fijo y no incluye el nombre del archivo a
            propósito: está escrito justo al lado, y repetirlo solo alargaría
            lo que anuncia un lector de pantalla. */}
        {onClear && selectedFileName ? (
          <button
            type="button"
            className="ds-chip-remove ds-file-input__clear"
            aria-label="Quitar archivo elegido"
            disabled={disabled}
            onClick={onClear}
          >
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
