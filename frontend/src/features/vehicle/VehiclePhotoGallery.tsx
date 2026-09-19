import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FileInputButton } from "../../design-system/FileInputButton";
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
export function VehiclePhotoGallery({ vehicleId, photos }: VehiclePhotoGalleryProps) {
  const uploadMutation = useUploadVehiclePhoto(vehicleId);
  const updateMutation = useUpdateVehiclePhoto(vehicleId);
  const deleteMutation = useDeleteVehiclePhoto(vehicleId);
  const reorderMutation = useReorderVehiclePhotos(vehicleId);

  const isBusy =
    uploadMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    reorderMutation.isPending;

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

  // El primer error de las cuatro mutations, si hay alguno: no hace falta
  // mostrar cuatro alertas a la vez.
  const error = [uploadMutation, updateMutation, deleteMutation, reorderMutation].find(
    (mutation) => mutation.isError,
  )?.error;

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
      {photos.length > 0 ? (
        <ul className="ds-card-grid" aria-label="Fotos de la unidad">
          {photos.map((photo, index) => (
            <li key={photo.id} className="ds-card ds-stack">
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
              <div className="ds-card-actions">
                {photo.isCover ? (
                  <Badge variant="info">Portada</Badge>
                ) : (
                  <Button
                    onClick={() =>
                      updateMutation.mutate({ photoId: photo.id, input: { isCover: true } })
                    }
                    disabled={isBusy}
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
