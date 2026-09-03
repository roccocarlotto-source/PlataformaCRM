import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { looksLikeUrl } from "../../lib/validation";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { useCreateDigitalQrCode, useUpdateQrCode } from "./mutations";
import type { CreateDigitalQrInput, QrCode, QrType, UpdateQrInput } from "./types";

// ---------------------------------------------------------------------------
// Crear y editar un QR en un solo componente, en un Modal y no en una ruta
// propia como CompanyFormPage. La razón es el contrato real: NO existe
// GET /api/qr/:id (qr.routes.ts), así que una ruta /qr/:id/edit no tendría de
// dónde hidratar el formulario tras un reload — el registro solo está
// disponible como fila del listado ya cargado. El diálogo lo recibe por prop
// y no fetchea nada. Documentado como desvío de la guía de Fase 3.
//
// Crear: sucursal + nombre + destino + mensaje opcional + tipo (REUSABLE por
// defecto, mismo default que el backend). Editar: solo nombre/destino/mensaje
// — branchId y qrType son inmutables tras la creación (updateQrSchema no los
// acepta), así que ni se muestran ni viajan en el PATCH.
//
// Validación en el cliente para feedback inmediato (mismos mensajes que el
// Dashboard original); la fuente de verdad sigue siendo el Zod del backend
// y su 400 se muestra tal cual si igual llega.
//
// BranchSelect va suelto, sin FormField: trae su propio <label htmlFor>, y
// FormField ES un <label> — mismo trato que UserSelect en CompanyFormPage.
// ---------------------------------------------------------------------------

interface QrFormValues {
  branchId: string | undefined;
  name: string;
  destinationUrl: string;
  message: string;
  qrType: QrType;
}

const EMPTY_FORM: QrFormValues = {
  branchId: undefined,
  name: "",
  destinationUrl: "",
  message: "",
  qrType: "REUSABLE",
};

function toFormValues(qr: QrCode): QrFormValues {
  return {
    branchId: qr.branchId ?? undefined,
    name: qr.name ?? "",
    destinationUrl: qr.destinationUrl ?? "",
    message: qr.message ?? "",
    qrType: qr.qrType,
  };
}

// message vacío se manda como null (el backend hace nullif(btrim()) igual,
// pero en el PATCH `null` es la única forma de VACIARLO explícitamente —
// mandar "" también da null server-side; se manda null para que el intent
// quede a la vista en el body).
function toCreateInput(values: QrFormValues): CreateDigitalQrInput {
  return {
    branchId: values.branchId ?? "",
    name: values.name.trim(),
    destinationUrl: values.destinationUrl.trim(),
    message: values.message.trim() || null,
    qrType: values.qrType,
  };
}

function toUpdateInput(values: QrFormValues): UpdateQrInput {
  return {
    name: values.name.trim(),
    destinationUrl: values.destinationUrl.trim(),
    message: values.message.trim() || null,
  };
}

function validar(values: QrFormValues, isEditMode: boolean): string | null {
  if (!isEditMode && !values.branchId) {
    return "Elegí la sucursal a la que pertenece este QR.";
  }
  if (!values.name.trim()) {
    return "El nombre del QR es obligatorio.";
  }
  if (!looksLikeUrl(values.destinationUrl.trim())) {
    return "Pegá una URL de destino válida (tiene que empezar con http:// o https://).";
  }
  return null;
}

export interface QrFormDialogProps {
  // undefined = crear un QR digital nuevo; con valor = editar ese QR.
  qr?: QrCode;
  onClose: () => void;
  // Se llama con el QR tal como lo devolvió el backend (creado o editado).
  // QrListPage lo usa, tras crear, para abrir directo el diálogo de imagen —
  // el equivalente del panel "QR nuevo" del Dashboard original.
  onSaved: (qr: QrCode) => void;
}

export function QrFormDialog({ qr, onClose, onSaved }: QrFormDialogProps) {
  const isEditMode = qr !== undefined;
  const createMutation = useCreateDigitalQrCode();
  const updateMutation = useUpdateQrCode(qr?.id ?? "");

  const [values, setValues] = useFormDraft<QrFormValues>(
    qr?.id,
    qr ? toFormValues(qr) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validar(values, isEditMode);
    setError(validationError);
    if (validationError) return;
    try {
      const saved = isEditMode
        ? await updateMutation.mutateAsync(toUpdateInput(values))
        : await createMutation.mutateAsync(toCreateInput(values));
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el QR");
    }
  }

  return (
    <Modal
      title={isEditMode ? "Editar QR" : "Generar QR digital"}
      onClose={onClose}
      closeLabel="Cancelar"
    >
      <form onSubmit={handleSubmit} noValidate>
        {isEditMode ? null : (
          <BranchSelect
            id="qr-form-branch"
            label="Sucursal"
            value={values.branchId}
            onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
          />
        )}
        <FormField label="Nombre">
          <input
            type="text"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            placeholder="Reseñas Google"
            maxLength={80}
          />
        </FormField>
        <FormField label="Enlace de destino">
          <input
            type="url"
            value={values.destinationUrl}
            onChange={(event) => setValues({ ...values, destinationUrl: event.target.value })}
            placeholder="https://search.google.com/local/writereview?placeid=..."
            maxLength={2048}
          />
        </FormField>
        <FormField label="Mensaje (opcional)">
          <textarea
            value={values.message}
            onChange={(event) => setValues({ ...values, message: event.target.value })}
            placeholder="¡Gracias por elegirnos! Nos ayudaría mucho conocer tu opinión."
            maxLength={500}
          />
        </FormField>
        {isEditMode ? null : (
          // Un solo uso solo al crear un QR digital, exactamente en este
          // formulario (Cycle 28 del original): reusable es el default, el
          // mismo que el backend.
          <div className="ds-field" role="radiogroup" aria-label="Tipo de QR">
            <span className="ds-field-label">Tipo de QR</span>
            <label>
              <input
                type="radio"
                name="qr-form-type"
                checked={values.qrType === "REUSABLE"}
                onChange={() => setValues({ ...values, qrType: "REUSABLE" })}
              />{" "}
              Reusable (usos ilimitados)
            </label>
            <label>
              <input
                type="radio"
                name="qr-form-type"
                checked={values.qrType === "SINGLE_USE"}
                onChange={() => setValues({ ...values, qrType: "SINGLE_USE" })}
              />{" "}
              Un solo uso
            </label>
          </div>
        )}
        {error ? <ErrorState>{error}</ErrorState> : null}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : isEditMode ? "Guardar" : "Crear QR"}
        </Button>
      </form>
    </Modal>
  );
}
