import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useToast } from "../../design-system/useToast";
import { CURRENCY_OPTIONS, isKnownCurrency } from "../../lib/currencies";
import { useFormDraft } from "../../lib/useFormDraft";
import { formatDate } from "../opportunity/format";
import { formatExchangeRate } from "./format";
import { useUpdateOrganizationCurrency } from "./mutations";
import { useOrganizationSettings } from "./queries";
import type { OrganizationSettings } from "./types";

// El formulario guarda "" para "sin configurar" y lo convierte a null recién
// al enviar: un <select> nativo no puede tener value null.
interface OrganizationFormValues {
  preferredCurrency: string;
  alternateCurrency: string;
}

const EMPTY_FORM: OrganizationFormValues = {
  preferredCurrency: "",
  alternateCurrency: "",
};

function toFormValues(settings: OrganizationSettings): OrganizationFormValues {
  return {
    preferredCurrency: settings.preferredCurrency ?? "",
    alternateCurrency: settings.alternateCurrency ?? "",
  };
}

// Mismo <select> cerrado que Moneda en Oportunidad (ítem 18.B), con dos
// diferencias: la opción vacía es permanente ("Sin configurar" = null para el
// backend), y va como componente local porque acá hay dos iguales.
//
// Una moneda persistida fuera de la lista (datos viejos, o cargados por API:
// el backend acepta cualquier ISO 4217) se muestra como opción extra
// mientras sea el valor vigente. Sin esto el <select> mostraría "Sin
// configurar" mientras el PATCH sigue mandando el valor real.
function CurrencySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sin configurar</option>
        {value === "" || isKnownCurrency(value) ? null : <option value={value}>{value}</option>}
        {CURRENCY_OPTIONS.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>
    </FormField>
  );
}

// Configuración de moneda de la organización (ítem 19.A de
// docs/frontend-cambios-pendientes.md). Es un singleton: no hay listado ni
// "nuevo", la página carga la configuración de la organización del token y la
// edita en el lugar. Vive bajo AdminRoute (el PATCH es ADMIN-only en el
// backend; la lectura es abierta pero la pantalla es toda escritura).
//
// Se mandan SIEMPRE los dos campos ("" → null): el backend exige al menos
// uno, y mandar los dos es la forma más simple de decir "la configuración
// queda así". La regla "no pueden ser la misma" queda del lado del backend a
// propósito —no se replica acá— porque el mensaje que devuelve (400) es
// exactamente el que hay que mostrar.
export function OrganizationSettingsPage() {
  const settingsQuery = useOrganizationSettings();
  const updateMutation = useUpdateOrganizationCurrency();
  const toast = useToast();

  const [values, setValues] = useFormDraft<OrganizationFormValues>(
    settingsQuery.data?.id,
    settingsQuery.data ? toFormValues(settingsQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateMutation.mutateAsync({
        preferredCurrency: values.preferredCurrency || null,
        alternateCurrency: values.alternateCurrency || null,
      });
      toast.show("Configuración guardada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración");
    }
  }

  if (settingsQuery.isLoading) {
    return <LoadingState />;
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar la configuración de la organización
        {settingsQuery.error instanceof Error ? `: ${settingsQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const settings = settingsQuery.data;

  // Mismo esqueleto que el resto de los formularios migrados (.ds-form + Card
  // + .ds-field-grid). La cotización va en su propia tarjeta, de solo
  // lectura: la carga el worker diario, no se edita desde acá.
  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>Organización</h1>
      <div className="ds-stack">
        <Card heading="Moneda">
          <div className="ds-stack">
            <p className="ds-hint">
              Configuración de {settings.name}. La moneda de preferencia es la principal de la
              operación; la alternativa, la segunda en la que se muestran precios.
            </p>
            <div className="ds-field-grid">
              <CurrencySelect
                label="Moneda de preferencia"
                value={values.preferredCurrency}
                onChange={(preferredCurrency) => setValues({ ...values, preferredCurrency })}
              />
              <CurrencySelect
                label="Moneda alternativa"
                value={values.alternateCurrency}
                onChange={(alternateCurrency) => setValues({ ...values, alternateCurrency })}
              />
            </div>
          </div>
        </Card>

        <Card heading="Cotización vigente">
          {settings.exchangeRates.length === 0 ? (
            <p className="ds-hint">
              Todavía no hay cotización cargada. Se actualiza automáticamente una vez por día cuando
              hay una moneda distinta de USD configurada.
            </p>
          ) : (
            <ul className="ds-stack" aria-label="Cotizaciones vigentes">
              {settings.exchangeRates.map((rate) => (
                <li key={rate.targetCurrency}>
                  {formatExchangeRate(rate)}{" "}
                  <span className="ds-hint">(cotización del {formatDate(rate.rateDate)})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
