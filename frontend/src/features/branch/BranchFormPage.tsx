import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { UserSelect } from "../user/UserSelect";
import { GoogleCalendarSection } from "./GoogleCalendarSection";
import { useCreateBranch, useUpdateBranch } from "./mutations";
import { useBranch } from "./queries";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, isKnownTimezone } from "./timezones";
import type { Branch, CreateBranchInput } from "./types";

interface BranchFormValues {
  name: string;
  timezone: string;
  defaultOwnerId: string | null;
  // Datos de cobro (ítem 74). Strings y no `string | null`: son inputs de
  // texto, y "" es "no configurado". La conversión a null va en el submit.
  paymentLinkUrl: string;
  bankTransferDetails: string;
}

// Tope de branch.controller.ts (BRANCH_BANK_TRANSFER_DETAILS_MAX_LENGTH). El
// backend sigue siendo quien valida; esto solo evita tipear de más.
const BANK_TRANSFER_DETAILS_MAX_LENGTH = 2000;

const EMPTY_FORM: BranchFormValues = {
  name: "",
  timezone: DEFAULT_TIMEZONE,
  // Sin preselección de "quien crea", a diferencia del ownerId de
  // Company/Contact/Opportunity: esto no es el dueño de un registro, es una
  // configuración de la sucursal, y la sucursal no es "de" quien la carga.
  defaultOwnerId: null,
  paymentLinkUrl: "",
  bankTransferDetails: "",
};

// "" o solo espacios -> null: el backend no acepta el string vacío como
// "vacío", y null es lo que efectivamente vacía la columna en el PATCH.
function textoONull(valor: string): string | null {
  const recortado = valor.trim();
  return recortado === "" ? null : recortado;
}

function toFormValues(branch: Branch): BranchFormValues {
  return {
    name: branch.name,
    timezone: branch.timezone,
    defaultOwnerId: branch.defaultOwnerId,
    paymentLinkUrl: branch.paymentLinkUrl ?? "",
    bankTransferDetails: branch.bankTransferDetails ?? "",
  };
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), mismo patrón que SourceFormPage y CompanyFormPage.
//
// Los dos campos son requeridos en el POST y opcionales-al-menos-uno en el
// PATCH; en edición se mandan los dos siempre, sin diferenciar cuál cambió
// (mismo criterio que Source y que el PATCH de organización, §19): "la
// sucursal queda así" es más simple que un diff, y el backend lo acepta.
export function BranchFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();
  // Ítem 75 — la vuelta del callback de Google Calendar, que el backend
  // redirige acá con uno de estos dos parámetros (ver
  // googleCalendarConnection.controller.ts). Solo se leen: quedan en la URL,
  // que es lo que permite recargar y seguir viendo el resultado.
  const [searchParams] = useSearchParams();
  const resultadoDelCallback = {
    conectado: searchParams.get("calendarConnected") === "true",
    error: searchParams.get("calendarError"),
  };

  const branchQuery = useBranch(isEditMode ? id : undefined);
  const createBranchMutation = useCreateBranch();
  const updateBranchMutation = useUpdateBranch(id ?? "");

  const [values, setValues] = useFormDraft<BranchFormValues>(
    branchQuery.data?.id,
    branchQuery.data ? toFormValues(branchQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createBranchMutation.isPending || updateBranchMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const input: CreateBranchInput = {
      name: values.name,
      timezone: values.timezone,
      // Siempre la clave, con `null` cuando no hay nadie elegido: es lo que
      // hace que sacar el vendedor por defecto de una sucursal que lo tenía
      // llegue como un PATCH de verdad y no como "no lo toqués". Mismo criterio
      // que los otros dos campos, que también viajan siempre.
      defaultOwnerId: values.defaultOwnerId,
      // Datos de cobro (ítem 74): siempre la clave, con null cuando quedaron
      // vacíos — mismo motivo que defaultOwnerId: borrar el link de una
      // sucursal que lo tenía tiene que llegar como un PATCH de verdad.
      paymentLinkUrl: textoONull(values.paymentLinkUrl),
      bankTransferDetails: textoONull(values.bankTransferDetails),
    };

    try {
      if (isEditMode) {
        await updateBranchMutation.mutateAsync(input);
      } else {
        await createBranchMutation.mutateAsync(input);
      }
      navigate("/branches");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la sucursal");
    }
  }

  if (isEditMode && branchQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (isEditMode && branchQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la sucursal
        {branchQuery.error instanceof Error ? `: ${branchQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar sucursal" : "Nueva sucursal"}</h1>
      <div className="ds-stack">
        <Card heading="Datos de la sucursal">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.name}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>

            {/* Suelto, sin FormField: Select trae su propio <label htmlFor> y
                FormField ES un <label>.

                Valor persistido FUERA de la lista (una sucursal creada por API
                con "UTC", por ejemplo): se muestra como opción extra mientras
                sea el vigente, para que el selector nunca muestre Montevideo
                mientras el PATCH manda otra cosa. Mismo criterio que Moneda
                (§18.B/§19). Ver timezones.ts. */}
            <Select
              label="Zona horaria"
              required
              value={values.timezone}
              options={[
                ...(isKnownTimezone(values.timezone)
                  ? []
                  : [{ value: values.timezone, label: values.timezone }]),
                ...TIMEZONE_OPTIONS,
              ]}
              onChange={(timezone) => {
                if (timezone) setValues({ ...values, timezone });
              }}
            />

            {/* Ítem 69. Sin asterisco y sin `required`: una sucursal sin
                vendedor por defecto es un estado válido, no una configuración a
                medio hacer, y la pantalla no lo señala de ninguna forma.

                UserSelect con su `clearable` por defecto (true), como Activity
                y Vehículo: el PATCH acepta `null` en este campo, así que la fila
                vacía se ofrece siempre — elegirla es la única forma de volver a
                dejar la sucursal sin ninguno. */}
            <UserSelect
              id="branch-form-default-owner"
              label="Vendedor por defecto"
              value={values.defaultOwnerId ?? undefined}
              onChange={(defaultOwnerId) =>
                setValues({ ...values, defaultOwnerId: defaultOwnerId || null })
              }
              emptyOptionLabel="Sin vendedor por defecto"
            />
            <p className="ds-hint ds-field-grid--full">
              Se usa cuando el agente de IA necesita asignar un vendedor a un contacto que todavía
              no tiene uno. El contacto queda asignado a esta persona, que se puede cambiar después
              como cualquier otro.
            </p>
          </div>
        </Card>

        {/* Ítem 74. Los dos opcionales e independientes, sin asterisco: una
            sucursal sin datos de cobro es un estado válido, y el agente le
            dice al cliente que no hay un medio de pago cargado. */}
        <Card heading="Cobro">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label="Link de pago">
                <input
                  type="url"
                  value={values.paymentLinkUrl}
                  placeholder="https://"
                  onChange={(event) => setValues({ ...values, paymentLinkUrl: event.target.value })}
                />
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              <FormField label="Datos para transferencia">
                <textarea
                  value={values.bankTransferDetails}
                  rows={4}
                  maxLength={BANK_TRANSFER_DETAILS_MAX_LENGTH}
                  onChange={(event) =>
                    setValues({ ...values, bankTransferDetails: event.target.value })
                  }
                />
              </FormField>
            </div>
            <p className="ds-hint ds-field-grid--full">
              El agente de IA comparte el link o los datos de la cuenta cuando el cliente quiere
              pagar. Si solo pregunta qué medios de pago aceptan, nombra los que estén cargados.
            </p>
          </div>
        </Card>

        {/* Ítem 75. Solo en edición: la conexión cuelga del id de la
            sucursal, que en el alta todavía no existe. Adentro del <form>
            pero independiente de él —sus botones son type="button" y actúan
            al momento—, al lado del resto de la configuración de la
            sucursal. */}
        {isEditMode ? (
          <GoogleCalendarSection branchId={id} resultadoDelCallback={resultadoDelCallback} />
        ) : null}

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting} loading={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
