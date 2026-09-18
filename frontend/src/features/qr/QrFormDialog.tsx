import { useState, type FormEvent } from "react";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { looksLikeUrl } from "../../lib/validation";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { useCreateDigitalQrCode, useUpdateQrCode } from "./mutations";
import { useSuggestedQrDisplayNumber } from "./queries";
import type { CreateDigitalQrInput, QrCode, UpdateQrInput } from "./types";

// ---------------------------------------------------------------------------
// Crear y editar un QR en un solo componente, en un Modal y no en una ruta
// propia como CompanyFormPage. La razón es el contrato real: NO existe
// GET /api/qr/:id (qr.routes.ts), así que una ruta /qr/:id/edit no tendría de
// dónde hidratar el formulario tras un reload — el registro solo está
// disponible como fila del listado ya cargado. El diálogo lo recibe por prop
// y no fetchea nada. Documentado como desvío de la guía de Fase 3.
//
// Crear: sucursal + N° + nombre + destino + mensaje opcional. Editar: N° +
// nombre/destino/mensaje — branchId es inmutable tras la creación
// (updateQrSchema no lo acepta), así que ni se muestra ni viaja en el PATCH.
//
// EL CAMPO "N°" ES DEL §54 de docs/frontend-cambios-pendientes.md. Hasta ese
// ítem el número lo asignaba el backend solo, con un contador por organización
// que nunca liberaba el número de un QR borrado, y acá no había campo ninguno.
// Hoy la serie es por SUCURSAL y reusa los números liberados: al elegir la
// sucursal se pide el sugerido (useSuggestedQrDisplayNumber) y se prellena el
// campo, que sigue siendo un input común — se puede escribir otro número, y si
// ese número ya lo usa otro QR ACTIVO de la sucursal el backend contesta 409
// y el mensaje se muestra tal cual por el catch de handleSubmit, sin ningún
// manejo especial (hay un test que lo fija).
//
// Hasta el ítem 53 de docs/frontend-cambios-pendientes.md había un cuarto
// campo al crear: los radios "Reusable / Un solo uso", que mandaban `qrType`
// en el POST. Ese campo no existe desde
// 20260904120000_remove_qr_claim_and_single_use — todo QR es digital y
// reusable, y createDigitalQrSchema ya no lo declara. Como ese Zod no es
// `.strict()`, el backend lo venía DESCARTANDO en silencio en vez de
// rechazarlo: elegir "Un solo uso" creaba un QR reusable igual, sin ningún
// error a la vista. Se sacaron los radios.
//
// Validación en el cliente para feedback inmediato (mismos mensajes que el
// Dashboard original); la fuente de verdad sigue siendo el Zod del backend
// y su 400 se muestra tal cual si igual llega. Es validar(), al principio de
// handleSubmit, lo que bloquea el guardado: el <form> es noValidate a
// propósito (los mensajes propios en vez de los globos del navegador), así
// que los `required` de Sucursal/Nombre/Enlace son semántica (asterisco de
// .ds-required y aria) que refleja ese bloqueo, no lo que lo produce.
//
// BranchSelect va suelto, sin FormField: trae su propio <label htmlFor>, y
// FormField ES un <label> — mismo trato que UserSelect en CompanyFormPage.
// ---------------------------------------------------------------------------

interface QrFormValues {
  branchId: string | undefined;
  // String y no number, como el resto de los campos numéricos de los
  // formularios del proyecto: el estado guarda lo que hay en el input,
  // incluido el vacío mientras se borra para escribir otro número. La
  // conversión a number pasa una sola vez, al armar el payload.
  displayNumber: string;
  name: string;
  destinationUrl: string;
  message: string;
}

const EMPTY_FORM: QrFormValues = {
  branchId: undefined,
  displayNumber: "",
  name: "",
  destinationUrl: "",
  message: "",
};

function toFormValues(qr: QrCode): QrFormValues {
  return {
    branchId: qr.branchId ?? undefined,
    displayNumber: qr.displayNumber === null ? "" : String(qr.displayNumber),
    name: qr.name ?? "",
    destinationUrl: qr.destinationUrl ?? "",
    message: qr.message ?? "",
  };
}

// §54 — el N° tal como lo va a recibir el backend, o null si lo que hay en el
// campo no es un entero positivo (incluido el vacío). Solo dígitos: "1e3",
// "1.5" y " 2 " con basura alrededor no son un rótulo de mostrador, y un
// Number() a secas los aceptaría o los convertiría en NaN sin avisar.
function parseDisplayNumber(raw: string): number | null {
  const limpio = raw.trim();
  if (!/^\d+$/.test(limpio)) {
    return null;
  }
  const numero = Number(limpio);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

// message vacío se manda como null (el backend hace nullif(btrim()) igual,
// pero en el PATCH `null` es la única forma de VACIARLO explícitamente —
// mandar "" también da null server-side; se manda null para que el intent
// quede a la vista en el body).
function toCreateInput(values: QrFormValues): CreateDigitalQrInput {
  const displayNumber = parseDisplayNumber(values.displayNumber);
  return {
    branchId: values.branchId ?? "",
    name: values.name.trim(),
    destinationUrl: values.destinationUrl.trim(),
    message: values.message.trim() || null,
    // Ausente = el backend asigna el sugerido de la sucursal. Es el camino que
    // se toma si alguien guarda antes de que la sugerencia llegue.
    ...(displayNumber === null ? {} : { displayNumber }),
  };
}

function toUpdateInput(values: QrFormValues): UpdateQrInput {
  return {
    name: values.name.trim(),
    destinationUrl: values.destinationUrl.trim(),
    message: values.message.trim() || null,
    // En edición validar() garantiza que haya un número válido, así que el
    // `?? undefined` es inalcanzable — está para no mandar NaN si alguna vez
    // dejara de estarlo.
    displayNumber: parseDisplayNumber(values.displayNumber) ?? undefined,
  };
}

function validar(values: QrFormValues, isEditMode: boolean): string | null {
  if (!isEditMode && !values.branchId) {
    return "Elegí la sucursal a la que pertenece este QR.";
  }
  // §54. Vacío al CREAR es válido: el backend asigna el sugerido, que es lo
  // que corresponde si alguien guarda antes de que la sugerencia llegue —
  // hacerlo fallar por una carrera que no provocó sería peor. Vacío al EDITAR
  // no: el QR ya tiene un número, el PATCH simplemente no lo tocaría, y la
  // pantalla habría dicho "guardado" sobre un campo que se dejó en blanco a
  // propósito. Por eso el asterisco del campo también depende del modo.
  const numero = parseDisplayNumber(values.displayNumber);
  if (values.displayNumber.trim() === "") {
    if (isEditMode) {
      return "El N° del QR no puede quedar vacío.";
    }
  } else if (numero === null) {
    return "El N° del QR tiene que ser un número entero mayor que 0.";
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

  const [draft, setValues] = useFormDraft<QrFormValues>(qr?.id, qr ? toFormValues(qr) : EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  // §54 — el N° sugerido para la sucursal elegida. Solo al crear: al editar, el
  // número que corresponde es el que el QR ya tiene, no el próximo libre.
  const suggestedQuery = useSuggestedQrDisplayNumber(isEditMode ? undefined : draft.branchId);
  const suggested = suggestedQuery.data?.suggestedDisplayNumber;

  // Si la persona ya escribió en el campo, la sugerencia no se lo pisa —mismo
  // criterio que derivedPriceField en VehicleFormPage—, y por eso hace falta
  // un flag y no alcanza con "el campo está vacío": borrar el número para
  // escribir otro deja el campo vacío por un instante, y ahí la sugerencia
  // volvería a meterse encima de lo que se está tipeando.
  const [numeroTocado, setNumeroTocado] = useState(false);

  // El valor vigente del campo se DERIVA en el render, sin efecto que lo
  // escriba (misma razón que useFormDraft: un setState en efecto vuelve a
  // pisar lo tipeado, y en render el lint lo prohíbe). Mientras nadie lo tocó,
  // manda la sugerencia; apenas la tocan, manda el borrador. Cambiar de
  // sucursal sin haber tocado el campo trae la sugerencia de la nueva.
  const displayNumber =
    !isEditMode && !numeroTocado && suggested !== undefined
      ? String(suggested)
      : draft.displayNumber;
  const values: QrFormValues = { ...draft, displayNumber };

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
    // El submit vive en el pie del panel, fuera del <form> en el DOM: el botón
    // primario del Modal lleva form="qr-form" (atributo HTML nativo) y con eso
    // dispara el onSubmit de este form igual que si estuviera adentro, pasando
    // por el mismo handleSubmit y respetando el noValidate. El id es fijo
    // porque QrListPage abre un solo diálogo a la vez.
    <Modal
      title={isEditMode ? "Editar QR" : "Generar QR digital"}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{
        label: isSubmitting ? "Guardando…" : isEditMode ? "Guardar" : "Crear QR",
        formId: "qr-form",
        disabled: isSubmitting,
      }}
    >
      <form id="qr-form" onSubmit={handleSubmit} noValidate>
        {isEditMode ? null : (
          <BranchSelect
            id="qr-form-branch"
            label="Sucursal"
            value={values.branchId}
            onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
            required
          />
        )}
        {/* §54. El asterisco depende del modo porque la obligatoriedad también:
            al crear, vacío significa "poné vos el sugerido"; al editar, el QR
            ya tiene número y dejarlo en blanco no lo cambia. Ver validar(). */}
        <FormField label={isEditMode ? <span className="ds-required">N°</span> : <span>N°</span>}>
          <input
            type="number"
            min={1}
            step={1}
            value={values.displayNumber}
            onChange={(event) => {
              setNumeroTocado(true);
              setValues({ ...values, displayNumber: event.target.value });
            }}
            required={isEditMode}
          />
        </FormField>
        <p className="ds-hint">
          {isEditMode
            ? "Tiene que ser único entre los QR activos de la sucursal."
            : "Sugerido: el siguiente libre en esta sucursal. Podés cambiarlo."}
        </p>
        <FormField label={<span className="ds-required">Nombre</span>}>
          <input
            type="text"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            placeholder="Reseñas Google"
            maxLength={80}
            required
          />
        </FormField>
        <FormField label={<span className="ds-required">Enlace de destino</span>}>
          <input
            type="url"
            value={values.destinationUrl}
            onChange={(event) => setValues({ ...values, destinationUrl: event.target.value })}
            placeholder="https://search.google.com/local/writereview?placeid=..."
            maxLength={2048}
            required
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
        {error ? <ErrorState>{error}</ErrorState> : null}
        {/* Al final del cuerpo: el botón de guardar vive en el pie del Modal,
            fuera del <form>, y esto es lo más cerca que se le puede poner. */}
        <RequiredFieldsHint />
      </form>
    </Modal>
  );
}
