import { Button } from "./Button";

export interface BulkSelectionBarProps {
  // El conteo ya armado por la pantalla ("3 fotos seleccionadas"): el género y
  // el sustantivo son texto, no una regla que valga la pena parametrizar.
  label: string;
  onDelete: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

// Barra que aparece arriba de una lista cuando hay algo tildado (ítem 64).
// Vive en el design system y no en cada pantalla porque las dos que la usan
// —la galería de fotos de un vehículo y el listado de la base de
// conocimiento— muestran exactamente lo mismo: cuántos hay marcados, la
// acción destructiva y la salida sin consecuencias.
//
// "Cancelar selección" NO borra nada: destilda y se va. Es la vía de escape
// para quien tildó de más, y por eso está al lado del botón rojo y no
// escondida.
export function BulkSelectionBar({
  label,
  onDelete,
  onCancel,
  disabled = false,
}: BulkSelectionBarProps) {
  return (
    <div className="ds-bulk-bar">
      <span className="ds-bulk-bar-count">{label}</span>
      <Button variant="danger" onClick={onDelete} disabled={disabled}>
        Eliminar seleccionadas
      </Button>
      <Button variant="secondary" onClick={onCancel} disabled={disabled}>
        Cancelar selección
      </Button>
    </div>
  );
}
