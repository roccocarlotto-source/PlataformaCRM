import { useState, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { useCreateOrganization } from "./mutations";
import type { CreateOrganizationResponse } from "./types";

interface NewOrganizationFormValues {
  organizationName: string;
  adminFullName: string;
  adminEmail: string;
}

const EMPTY_FORM: NewOrganizationFormValues = {
  organizationName: "",
  adminFullName: "",
  adminEmail: "",
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

  const [values, setValues] = useState<NewOrganizationFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateOrganizationResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createOrganizationMutation.mutateAsync(values);
      setCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la organización");
    }
  }

  function handleReset() {
    setCreated(null);
    setError(null);
    setValues(EMPTY_FORM);
  }

  if (created) {
    return (
      <div className="ds-form">
        <h1>Organización creada</h1>
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
      <h1>Nueva organización</h1>
      <div className="ds-stack">
        <Card heading="Organización">
          <div className="ds-field-grid">
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
          <Button type="submit" variant="primary" disabled={createOrganizationMutation.isPending}>
            {createOrganizationMutation.isPending ? "Creando…" : "Crear organización"}
          </Button>
        </div>
      </div>
    </form>
  );
}
