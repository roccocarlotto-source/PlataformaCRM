import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { DetailList } from "../../design-system/DetailList";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { Select } from "../../design-system/Select";
import { useToast } from "../../design-system/useToast";
import { CURRENCY_OPTIONS, isKnownCurrency } from "../../lib/currencies";
import { useFormDraft } from "../../lib/useFormDraft";
import { ORGANIZATION_TIMEZONE_OPTIONS, isKnownOrganizationTimezone } from "../branch/timezones";
import { formatDate } from "../opportunity/format";
import { formatExchangeRate } from "./format";
import { MetaConnectionSection } from "./MetaConnectionSection";
import { useUpdateOrganizationSettings } from "./mutations";
import { useOrganizationSettings } from "./queries";
import type {
  ContactTerm,
  OrganizationEdition,
  OrganizationIndustry,
  OrganizationSettings,
} from "./types";

const NOMBRE_DE_EDICION: Record<OrganizationEdition, string> = {
  COMPLETA: "Completa",
  ESENCIAL: "Esencial",
};

const NOMBRE_DE_RUBRO: Record<OrganizationIndustry, string> = {
  AUTOMOTORA: "Automotora",
  CLINICA: "Clínica",
};

const OPCIONES_DE_TERMINO: { value: ContactTerm; label: string }[] = [
  { value: "PACIENTE", label: "Paciente" },
  { value: "CLIENTE", label: "Cliente" },
];

// El formulario guarda "" para "sin configurar" y lo convierte a null recién
// al enviar: el selector no puede tener value null.
interface OrganizationFormValues {
  preferredCurrency: string;
  alternateCurrency: string;
  defaultPhoneCountryCode: string;
  timezone: string;
  // Solo cuenta en una clínica.
  contactTerm: ContactTerm;
  // R16: el aviso de privacidad, solo en una clínica. "" = sin cargar.
  privacyNoticeText: string;
  privacyPolicyUrl: string;
}

const EMPTY_FORM: OrganizationFormValues = {
  preferredCurrency: "",
  alternateCurrency: "",
  defaultPhoneCountryCode: "",
  timezone: "UTC",
  contactTerm: "PACIENTE",
  privacyNoticeText: "",
  privacyPolicyUrl: "",
};

// R16 (docs/rubros.md §8.1): un texto de ejemplo para empezar. Es un BORRADOR:
// no es asesoramiento legal y lo tiene que revisar un profesional antes de
// usarlo. No se guarda solo: se carga con el botón y se guarda con el resto.
const AVISO_DE_PRIVACIDAD_DE_EJEMPLO =
  "Antes de seguir: usamos los datos que nos compartas por este chat solo para " +
  "gestionar tus turnos y responder tus consultas. No compartas acá información " +
  "sobre tu salud. Podés pedirnos ver, corregir o borrar tus datos cuando quieras. " +
  "Más información en nuestra política de privacidad:";

const MAX_AVISO = 1000;
const MAX_LINK = 500;

function toFormValues(settings: OrganizationSettings): OrganizationFormValues {
  return {
    preferredCurrency: settings.preferredCurrency ?? "",
    alternateCurrency: settings.alternateCurrency ?? "",
    defaultPhoneCountryCode: settings.defaultPhoneCountryCode ?? "",
    timezone: settings.timezone,
    contactTerm: settings.contactTerm ?? "PACIENTE",
    privacyNoticeText: settings.privacyNoticeText ?? "",
    privacyPolicyUrl: settings.privacyPolicyUrl ?? "",
  };
}

// R16: solo lo que cambió respecto de lo guardado. Así guardar la moneda no
// toca el aviso (borrarlo con agentes activos es un 409).
function cambiosDelAviso(
  settings: OrganizationSettings,
  values: OrganizationFormValues,
): { privacyNoticeText?: string | null; privacyPolicyUrl?: string | null } {
  const texto = values.privacyNoticeText.trim() || null;
  const link = values.privacyPolicyUrl.trim() || null;
  return {
    ...(texto !== (settings.privacyNoticeText ?? null) ? { privacyNoticeText: texto } : {}),
    ...(link !== (settings.privacyPolicyUrl ?? null) ? { privacyPolicyUrl: link } : {}),
  };
}

// Mismo desplegable cerrado que Moneda en Oportunidad (ítem 18.B), con dos
// diferencias: la opción vacía es permanente ("Sin configurar" = null para el
// backend), y va como componente local porque acá hay dos iguales.
//
// Una moneda persistida fuera de la lista (datos viejos, o cargados por API:
// el backend acepta cualquier ISO 4217) se muestra como opción extra
// mientras sea el valor vigente. Sin esto el selector mostraría "Sin
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
  // Suelto, sin FormField: Select trae su propio <label htmlFor> y FormField
  // ES un <label>.
  return (
    <Select
      label={label}
      value={value}
      options={[
        ...(value === "" || isKnownCurrency(value) ? [] : [{ value, label: value }]),
        ...CURRENCY_OPTIONS.map((currency) => ({ value: currency, label: currency })),
      ]}
      emptyOption={{ label: "Sin configurar" }}
      onChange={onChange}
    />
  );
}

// Configuración de moneda de la organización (ítem 19.A de
// docs/frontend-cambios-pendientes.md). Es un singleton: no hay listado ni
// "nuevo", la página carga la configuración de la organización del token y la
// edita en el lugar. Vive bajo AdminRoute (el PATCH es ADMIN-only en el
// backend; la lectura es abierta pero la pantalla es toda escritura).
//
// Se mandan SIEMPRE todos los campos ("" → null): el backend exige al menos
// uno, y mandar los dos es la forma más simple de decir "la configuración
// queda así". La regla "no pueden ser la misma" queda del lado del backend a
// propósito —no se replica acá— porque el mensaje que devuelve (400) es
// exactamente el que hay que mostrar.
export function OrganizationSettingsPage() {
  const settingsQuery = useOrganizationSettings();
  const updateMutation = useUpdateOrganizationSettings();
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
        defaultPhoneCountryCode: values.defaultPhoneCountryCode.trim() || null,
        timezone: values.timezone,
        // El término del contacto solo existe en una clínica: a una automotora
        // no se le manda (el backend respondería 400).
        ...(settingsQuery.data?.industry === "CLINICA"
          ? { contactTerm: values.contactTerm, ...cambiosDelAviso(settingsQuery.data, values) }
          : {}),
      });
      toast.show("Configuración guardada");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la configuración");
    }
  }

  if (settingsQuery.isLoading) {
    return <LoadingState variant="lines" />;
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
      <PageHeader help={AYUDA.organizacion} title="Organización" />
      <div className="ds-stack">
        <Card heading="Moneda">
          <div className="ds-stack">
            <p className="ds-hint">
              Configuración de {settings.name}. La alternativa es la segunda moneda en la que se
              muestran precios.
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

        {/* F5-b (docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)). Vacío por defecto: sin
          país, un teléfono local se rechaza como antes. El formato (1 a 3
          dígitos) lo valida el backend y su 400 se muestra abajo. */}
        <Card heading="Teléfonos">
          <div className="ds-field-grid">
            <FormField label="Código de país por defecto">
              <input
                type="text"
                inputMode="numeric"
                maxLength={3}
                placeholder="598"
                value={values.defaultPhoneCountryCode}
                onChange={(event) =>
                  setValues({ ...values, defaultPhoneCountryCode: event.target.value })
                }
              />
            </FormField>
          </div>
          <p className="ds-hint">
            Se usa para completar los teléfonos cargados sin código de país.
          </p>
        </Card>

        {/* Seguimiento de T-01. Valor persistido fuera de la lista ("UTC", la
          zona de una organización recién creada sin sucursales) se muestra
          como opción extra mientras sea el vigente, mismo criterio que la
          zona de la sucursal y que CurrencySelect: el selector nunca muestra
          una ciudad mientras el PATCH manda otra cosa. Sin opción vacía: la
          zona no se puede vaciar. */}
        <Card heading="Zona horaria">
          <div className="ds-field-grid">
            <Select
              label="Zona horaria"
              value={values.timezone}
              options={[
                ...(isKnownOrganizationTimezone(values.timezone)
                  ? []
                  : [{ value: values.timezone, label: values.timezone }]),
                ...ORGANIZATION_TIMEZONE_OPTIONS,
              ]}
              onChange={(timezone) => {
                if (timezone) setValues({ ...values, timezone });
              }}
            />
          </div>
          <p className="ds-hint">Define hoy, esta semana y este mes en el dashboard.</p>
        </Card>

        {/* Rubros (docs/rubros.md §1.1): el rubro y la edición se ven, pero
          los cambia el platform admin. En una clínica, además, cómo se llama
          a los contactos (§3). */}
        <Card heading="Rubro y edición">
          <div className="ds-stack">
            <DetailList
              sections={[
                {
                  items: [
                    { label: "Rubro", value: NOMBRE_DE_RUBRO[settings.industry] },
                    { label: "Edición", value: NOMBRE_DE_EDICION[settings.edition] },
                  ],
                },
              ]}
            />
            {settings.industry === "CLINICA" ? (
              <div className="ds-field-grid">
                <Select
                  label="Cómo llamar a los contactos"
                  value={values.contactTerm}
                  options={OPCIONES_DE_TERMINO}
                  onChange={(contactTerm) => {
                    if (contactTerm)
                      setValues({ ...values, contactTerm: contactTerm as ContactTerm });
                  }}
                />
              </div>
            ) : null}
            <p className="ds-hint">El rubro y la edición los cambia el equipo de la plataforma.</p>
          </div>
        </Card>

        {settings.industry === "CLINICA" ? (
          <Card heading="Aviso de privacidad">
            <div className="ds-stack">
              <p className="ds-hint">
                El agente lo manda una sola vez a cada contacto, como mensaje aparte, antes de su
                primera respuesta. Sin el aviso y el link no se puede activar un agente.
              </p>
              <Notice tone="warning" alert={false}>
                El texto de ejemplo es un borrador: no es asesoramiento legal. Revisalo con un
                profesional antes de usarlo.
              </Notice>
              <div className="ds-field-grid">
                <div className="ds-field-grid--full">
                  <FormField label="Texto del aviso">
                    <textarea
                      rows={4}
                      maxLength={MAX_AVISO}
                      value={values.privacyNoticeText}
                      onChange={(event) =>
                        setValues({ ...values, privacyNoticeText: event.target.value })
                      }
                    />
                  </FormField>
                </div>
                <div className="ds-field-grid--full">
                  <FormField label="Link a la política de privacidad">
                    <input
                      type="url"
                      maxLength={MAX_LINK}
                      placeholder="https://"
                      value={values.privacyPolicyUrl}
                      onChange={(event) =>
                        setValues({ ...values, privacyPolicyUrl: event.target.value })
                      }
                    />
                  </FormField>
                </div>
              </div>
              {values.privacyNoticeText.trim() === "" ? (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setValues({ ...values, privacyNoticeText: AVISO_DE_PRIVACIDAD_DE_EJEMPLO })
                    }
                  >
                    Usar el texto de ejemplo
                  </Button>
                </div>
              ) : null}
              <p className="ds-hint">El link va abajo del texto, en el mismo mensaje.</p>
            </div>
          </Card>
        ) : null}

        <Card heading="Cotización vigente">
          {settings.exchangeRates.length === 0 ? (
            <p className="ds-hint">Todavía no hay cotización cargada.</p>
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

        <MetaConnectionSection />

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={updateMutation.isPending}
            loading={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
