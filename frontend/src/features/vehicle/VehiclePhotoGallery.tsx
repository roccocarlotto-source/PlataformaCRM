import { useState } from "react";
import { Badge } from "../../design-system/Badge";
import { BulkSelectionBar } from "../../design-system/BulkSelectionBar";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FileInputButton } from "../../design-system/FileInputButton";
import { deleteInBulk } from "../../lib/bulkDelete";
import { useBulkSelection } from "../../lib/useBulkSelection";
import {
  useDeleteVehiclePhoto,
  useReorderVehiclePhotos,
  useUpdateVehiclePhoto,
  useUploadVehiclePhoto,
} from "./mutations";
import type { VehiclePhoto } from "./types";

export interface VehiclePhotoGalleryProps {
  vehicleId: string;
  photos: VehiclePhoto[];
}

// Galería de la ficha (sección Multimedia). Grilla de miniaturas con subir,
// marcar portada, reordenar y eliminar. El reorden es con botones
// "Subir"/"Bajar" y no drag-and-drop: alcanza para que funcione y no mete
// una decisión de librería en esta fase (el @dnd-kit del tablero de
// oportunidades es otro caso de uso; reusarlo acá sería una pieza aparte).
// El slot (ángulo de la foto) queda sin exponer: es texto libre en el backend
// y sin un catálogo cerrado decidido, un input suelto no aporta.
//
// Las fotos se muestran en el orden que trae el backend (position asc). Cada
// escritura devuelve la galería que quedó y las mutations la escriben en el
// cache del detalle, así que esta prop se actualiza sola.
//
// Ítem 64 — selección múltiple: cada miniatura tiene su casilla arriba a la
// derecha, "como la galería de un celu", y con al menos una tildada aparece
// la barra para borrarlas todas juntas. El botón "Eliminar" de cada foto
// sigue intacto: el lote es una capacidad de más, no un reemplazo del borrado
// de a una.
export function VehiclePhotoGallery({ vehicleId, photos }: VehiclePhotoGalleryProps) {
  const uploadMutation = useUploadVehiclePhoto(vehicleId);
  const updateMutation = useUpdateVehiclePhoto(vehicleId);
  const deleteMutation = useDeleteVehiclePhoto(vehicleId);
  const reorderMutation = useReorderVehiclePhotos(vehicleId);

  const seleccion = useBulkSelection(photos.map((photo) => photo.id));
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isBusy =
    uploadMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    reorderMutation.isPending ||
    // Estado propio además del isPending del delete: entre una foto y la
    // siguiente del mismo lote la mutation puede quedar un instante en
    // reposo, y en ese hueco un segundo click dispararía un lote en paralelo.
    isBulkDeleting;

  // Acá el archivo se sube apenas se elige: no hay un botón "Subir" aparte, y
  // por eso tampoco hay estado propio con el archivo elegido. Limpiar el input
  // para poder reelegir la misma foto lo hace FileInputButton.
  function handleFileSelected(file: File | null) {
    if (!file) return;
    uploadMutation.mutate({ file });
  }

  function handleDelete(photoId: string) {
    if (!window.confirm("¿Eliminar esta foto?")) return;
    deleteMutation.mutate(photoId);
  }

  // Intercambia la foto con su vecina y manda la lista COMPLETA de ids en el
  // orden nuevo: el backend exige todos (computeReorderedPositions).
  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    const orderedIds = photos.map((photo) => photo.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    reorderMutation.mutate(orderedIds);
  }

  async function handleBulkDelete() {
    const ids = seleccion.selectedIds;
    if (ids.length === 0) return;
    const pregunta =
      ids.length === 1
        ? "¿Eliminar la foto seleccionada?"
        : `¿Eliminar las ${ids.length} fotos seleccionadas?`;
    if (!window.confirm(pregunta)) return;

    setBulkError(null);
    setIsBulkDeleting(true);
    const { failed } = await deleteInBulk(ids, (photoId) => deleteMutation.mutateAsync(photoId));
    setIsBulkDeleting(false);

    // Las que se borraron salen de la selección porque salen de la galería;
    // las que fallaron quedan tildadas para poder reintentar sin volver a
    // buscarlas entre las demás.
    seleccion.select(failed);
    setBulkError(
      failed.length > 0
        ? `No se pudieron eliminar ${failed.length} de ${ids.length} ${
            ids.length === 1 ? "foto" : "fotos"
          }. Siguen seleccionadas para reintentar.`
        : null,
    );
  }

  // El primer error de las cuatro mutations, si hay alguno: no hace falta
  // mostrar cuatro alertas a la vez.
  const error = [uploadMutation, updateMutation, deleteMutation, reorderMutation].find(
    (mutation) => mutation.isError,
  )?.error;

  const seleccionadas = seleccion.selectedIds.length;

  return (
    <div className="ds-stack">
      <p className="ds-hint">
        {photos.length === 1 ? "1 foto" : `${photos.length} fotos`}. Se admiten JPEG y PNG; la
        primera foto que se sube queda como portada.
      </p>
      <div className="ds-card-actions">
        {/* El nombre al lado del botón dura lo que dura la subida: cuando
            termina, la foto ya se ve en la grilla de abajo y no hay ningún
            archivo "elegido" esperando nada. Sale de la mutation en vuelo, sin
            estado propio. */}
        <FileInputButton
          label="Subir foto"
          accept="image/jpeg,image/png"
          disabled={isBusy}
          loading={uploadMutation.isPending}
          selectedFileName={
            uploadMutation.isPending ? (uploadMutation.variables?.file.name ?? null) : null
          }
          onFileSelected={handleFileSelected}
        />
      </div>
      {error ? (
        <ErrorState>
          No pudimos actualizar la galería
          {error instanceof Error ? `: ${error.message}` : "."}
        </ErrorState>
      ) : null}
      {/* Aparte del ErrorState de arriba, que muestra el mensaje crudo de la
          última mutation que falló: este dice cuántas del lote no se pudieron
          borrar, que es lo que el otro no puede decir. */}
      {bulkError ? <ErrorState>{bulkError}</ErrorState> : null}
      {seleccionadas > 0 ? (
        <BulkSelectionBar
          label={
            seleccionadas === 1 ? "1 foto seleccionada" : `${seleccionadas} fotos seleccionadas`
          }
          onDelete={handleBulkDelete}
          onCancel={seleccion.clear}
          disabled={isBusy}
          deleting={isBulkDeleting}
        />
      ) : null}
      {photos.length > 0 ? (
        <ul className="ds-card-grid" aria-label="Fotos de la unidad">
          {photos.map((photo, index) => (
            <li key={photo.id} className="ds-card ds-stack">
              <div className="ds-photo-pick">
                {photo.url ? (
                  <img
                    src={photo.url}
                    alt={`Foto ${index + 1}${photo.isCover ? " (portada)" : ""}`}
                    style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover" }}
                  />
                ) : (
                  // url null: el objeto en Storage no pudo firmarse. Se muestra
                  // igual para que se pueda borrar.
                  <p className="ds-empty">Sin vista previa</p>
                )}
                {/* La casilla va del lado de la foto y no en la botonera de
                    abajo: pertenece a la miniatura, no a las acciones de esa
                    miniatura. */}
                <input
                  type="checkbox"
                  checked={seleccion.isSelected(photo.id)}
                  disabled={isBusy}
                  onChange={() => seleccion.toggle(photo.id)}
                  aria-label={`Seleccionar foto ${index + 1}`}
                />
              </div>
              <div className="ds-card-actions">
                {photo.isCover ? (
                  <Badge variant="info">Portada</Badge>
                ) : (
                  <Button
                    onClick={() =>
                      updateMutation.mutate({ photoId: photo.id, input: { isCover: true } })
                    }
                    disabled={isBusy}
                    loading={
                      updateMutation.isPending && updateMutation.variables?.photoId === photo.id
                    }
                    aria-label={`Marcar foto ${index + 1} como portada`}
                  >
                    Marcar portada
                  </Button>
                )}
                <Button
                  onClick={() => move(index, -1)}
                  disabled={isBusy || index === 0}
                  aria-label={`Subir foto ${index + 1}`}
                >
                  Subir
                </Button>
                <Button
                  onClick={() => move(index, 1)}
                  disabled={isBusy || index === photos.length - 1}
                  aria-label={`Bajar foto ${index + 1}`}
                >
                  Bajar
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleDelete(photo.id)}
                  disabled={isBusy}
                  loading={deleteMutation.isPending && deleteMutation.variables === photo.id}
                  aria-label={`Eliminar foto ${index + 1}`}
                >
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
