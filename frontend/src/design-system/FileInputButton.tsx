import { useId, useRef, type ChangeEvent } from "react";
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
}

const SIN_ARCHIVO = "Ningún archivo elegido";

export function FileInputButton({
  onFileSelected,
  label,
  accept,
  disabled,
  buttonLabel = "Elegir archivo",
  selectedFileName,
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
      </div>
    </div>
  );
}
