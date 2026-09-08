import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createVehicle,
  deleteVehicle,
  deleteVehiclePhoto,
  reorderVehiclePhotos,
  updateVehicle,
  updateVehiclePhoto,
  uploadVehiclePhoto,
} from "./api";
import { vehicleKeys } from "./queries";
import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  UpdateVehiclePhotoInput,
  UploadVehiclePhotoOptions,
  VehicleDetail,
  VehiclePhoto,
} from "./types";

// Invalidación mínima y correcta, mismo criterio que features/company/mutations.ts:
// cada mutación invalida solo lo que pudo afectar. Nunca queryClient.clear().

export function useCreateVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVehicleInput) => createVehicle(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
    },
  });
}

export function useUpdateVehicle(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateVehicleInput) => updateVehicle(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
      // detail() cubre también el historial: changeLog cuelga de esa key.
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(id) });
    },
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVehicle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// Galería. Las cuatro escrituras devuelven la galería que quedó, así que se
// escribe directo en el cache del detalle (setQueryData) para que la ficha
// repinte sin esperar el refetch, y ADEMÁS se invalida: el refetch confirma
// contra el servidor (URLs firmadas nuevas, portada recalculada). Con
// useFormDraft el refetch no pisa lo que el usuario tenga tipeado en la ficha.
// ---------------------------------------------------------------------------

function usePhotoMutation<TVariables>(
  vehicleId: string,
  mutationFn: (variables: TVariables) => Promise<VehiclePhoto[]>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (photos) => {
      queryClient.setQueryData<VehicleDetail>(vehicleKeys.detail(vehicleId), (current) =>
        current ? { ...current, photos } : current,
      );
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(vehicleId) });
    },
  });
}

export function useUploadVehiclePhoto(vehicleId: string) {
  return usePhotoMutation(
    vehicleId,
    ({ file, options }: { file: File; options?: UploadVehiclePhotoOptions }) =>
      uploadVehiclePhoto(vehicleId, file, options),
  );
}

export function useUpdateVehiclePhoto(vehicleId: string) {
  return usePhotoMutation(
    vehicleId,
    ({ photoId, input }: { photoId: string; input: UpdateVehiclePhotoInput }) =>
      updateVehiclePhoto(vehicleId, photoId, input),
  );
}

export function useDeleteVehiclePhoto(vehicleId: string) {
  return usePhotoMutation(vehicleId, (photoId: string) => deleteVehiclePhoto(vehicleId, photoId));
}

export function useReorderVehiclePhotos(vehicleId: string) {
  return usePhotoMutation(vehicleId, (photoIds: string[]) =>
    reorderVehiclePhotos(vehicleId, photoIds),
  );
}
