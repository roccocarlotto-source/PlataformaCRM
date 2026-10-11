import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { useCreateClinicaDemo, useCreateOrganization } from "./mutations";
import { NOMBRE_DE_EDICION } from "./ediciones";
import { useEdicionesDisponibles, useRubrosDisponibles } from "./queries";
import type {
  CreateOrganizationInput,
  CreateOrganizationResponse,
  OrganizationEdition,
  OrganizationIndustry,
} from "./types";

interface NewOrganizationFormValues {
  organizationName: string;
  adminFullName: string;
  adminEmail: string;
  edition: OrganizationEdition | "";
  industry: OrganizationIndustry | "";
}

const EMPTY_FORM: NewOrganizationFormValues = {
  organizationName: "",
  adminFullName: "",
  adminEmail: "",
  edition: "",
  industry: "",
};

const NOMBRE_DE_RUBRO: Record<OrganizationIndustry, string> = {
  AUTOMOTORA: "Automotora",
  CLINICA: "Clínica",
};

// Alta de una organización nueva (cliente/automotora) con su primer ADMIN —
// Fase 4a del módulo SaaS. Herramienta interna del platform admin: se usa
// logueado, dentro de AppLayout, con el esqueleto de los formularios del
// resto de la app (.ds-form + Card + .ds-field-grid, como CompanyFormPage) y
// NO con AuthShell, que es para páginas pre-login.
//
// Solo alta, a propósito: sin listado, sin edición, sin redirect al terminar.
// Al confirmar se reemplaza el formulario por el resultado —nombre y slug de
// la organización, y a qué email se mandó la invitación— porque lo que el
// operador necesita en ese momento es saber que salió y a quién avisarle. La
// contraseña la elige el admin nuevo desde el link del mail (ResetPasswordPage,
// sin tocar).
export function NewOrganizationPage() {
  const createOrganizationMutation = useCreateOrganization();
  // La edición (docs/ediciones.md §1.1): el selector aparece solo si el
  // backend ofrece más de una. Desde H1 ofrece COMPLETA y ESENCIAL
  // (ESENCIAL_HABILITADA en true), así que el selector aparece y es
  // obligatorio. Con una sola, no aparece y el alta no manda edition.
  const ediciones = useEdicionesDisponibles().data?.editions ?? [];
  const eligeEdicion = ediciones.length > 1;
  // El rubro (docs/rubros.md §1.1), con el mismo criterio: hoy el backend
  // ofrece solo AUTOMOTORA (CLINICA_HABILITADA en false), así que no hay
  // selector y el alta no manda industry.
  const rubros = useRubrosDisponibles().data?.industries ?? [];
  const eligeRubro = rubros.length > 1;

  // R19 (docs/rubros.md §12.1): la Clínica Demo con datos de ejemplo, por su
  // propio endpoint. Funciona aunque el backend no ofrezca el rubro clínica
  // (el selector de rubro sigue con su criterio). La página ya es solo de
  // platform admin (PlatformAdminRoute). Marcada, el formulario pide solo el
  // primer administrador y un sufijo opcional del nombre.
  const createClinicaDemoMutation = useCreateClinicaDemo();
  const [esDemo, setEsDemo] = useState(false);
  const [sufijo, setSufijo] = useState("");
  const creando = createOrganizationMutation.isPending || createClinicaDemoMutation.isPending;

  const [values, setValues] = useState<NewOrganizationFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateOrganizationResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (esDemo) {
        const result = await createClinicaDemoMutation.mutateAsync({
          adminFullName: values.adminFullName,
          adminEmail: values.adminEmail,
          ...(sufijo.trim() !== "" ? { sufijo: sufijo.trim() } : {}),
        });
        setCreated(result);
        return;
      }
      const { edition, industry, ...resto } = values;
      const input: CreateOrganizationInput = {
        ...resto,
        ...(eligeEdicion && edition !== "" ? { edition } : {}),
        ...(eligeRubro && industry !== "" ? { industry } : {}),
      };
      const result = await createOrganizationMutation.mutateAsync(input);
      setCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la organización");
    }
  }

  function handleReset() {
    setCreated(null);
    setError(null);
    setValues(EMPTY_FORM);
    setEsDemo(false);
    setSufijo("");
  }

  if (created) {
    return (
      <div className="ds-form">
        <PageHeader help={AYUDA.nuevaOrganizacion} title="Organización creada" />
        <div className="ds-stack">
          <Card heading={created.organization.name}>
            <p>
              Identificador: <code>{created.organization.slug}</code>
            </p>
            <p>
              Se envió una invitación a <strong>{created.admin.email}</strong> para que configure su
              contraseña. Cuando la complete, entra como administrador de la organización.
            </p>
          </Card>
          <div>
            <Button type="button" onClick={handleReset}>
              Dar de alta otra organización
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <PageHeader help={AYUDA.nuevaOrganizacion} title="Nueva organización" />
      <div className="ds-stack">
        <Card heading="Organización">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label="Clínica Demo con datos de ejemplo">
                <input
                  type="checkbox"
                  checked={esDemo}
                  onChange={(event) => setEsDemo(event.target.checked)}
                />
              </FormField>
            </div>
            {esDemo ? (
              <>
                <p className="ds-hint ds-field-grid--full">
                  Crea «Clínica Demo», del rubro clínica y en edición Esencial, con una sede,
                  profesionales, prestaciones, pacientes y turnos inventados. El agente y las
                  automatizaciones quedan desactivados.
                </p>
                <div className="ds-field-grid--full">
                  <FormField label="Sufijo del nombre (opcional)">
                    <input
                      type="text"
                      value={sufijo}
                      onChange={(event) => setSufijo(event.target.value)}
                      maxLength={60}
                      placeholder="Norte"
                    />
                  </FormField>
                </div>
              </>
            ) : (
              <>
                <div className="ds-field-grid--full">
                  <FormField label={<span className="ds-required">Nombre de la organización</span>}>
                    <input
                      type="text"
                      value={values.organizationName}
                      onChange={(event) =>
                        setValues({ ...values, organizationName: event.target.value })
                      }
                      required
                      maxLength={255}
                    />
                  </FormField>
                </div>
                {eligeEdicion ? (
                  <div className="ds-field-grid--full">
                    <FormField label={<span className="ds-required">Edición</span>}>
                      <select
                        value={values.edition}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            edition: event.target.value as OrganizationEdition | "",
                          })
                        }
                        required
                      >
                        <option value="">Elegí una edición</option>
                        {ediciones.map((edicion) => (
                          <option key={edicion} value={edicion}>
                            {NOMBRE_DE_EDICION[edicion]}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                ) : null}
                {eligeRubro ? (
                  <div className="ds-field-grid--full">
                    <FormField label={<span className="ds-required">Rubro</span>}>
                      <select
                        value={values.industry}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            industry: event.target.value as OrganizationIndustry | "",
                          })
                        }
                        required
                      >
                        <option value="">Elegí un rubro</option>
                        {rubros.map((rubro) => (
                          <option key={rubro} value={rubro}>
                            {NOMBRE_DE_RUBRO[rubro]}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Card>
        <Card heading="Primer administrador">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre completo</span>}>
              <input
                type="text"
                value={values.adminFullName}
                onChange={(event) => setValues({ ...values, adminFullName: event.target.value })}
                required
                maxLength={255}
              />
            </FormField>
            <FormField label={<span className="ds-required">Email</span>}>
              <input
                type="email"
                value={values.adminEmail}
                onChange={(event) => setValues({ ...values, adminEmail: event.target.value })}
                required
              />
            </FormField>
          </div>
        </Card>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button type="submit" variant="primary" disabled={creando} loading={creando}>
            {creando ? "Creando…" : esDemo ? "Crear Clínica Demo" : "Crear organización"}
          </Button>
        </div>
      </div>
    </form>
  );
}
