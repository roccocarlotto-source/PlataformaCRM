import { useState, type FormEvent } from "react";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { CURRENCY_OPTIONS } from "../../lib/currencies";
import { ORGANIZATION_TIMEZONE_OPTIONS } from "../branch/timezones";
import { useCreateClinicaDemo, useCreateOrganization, useCreateTallerDemo } from "./mutations";
import { NOMBRE_DE_EDICION } from "./ediciones";
import { useEdicionesDisponibles, useRubrosDisponibles } from "./queries";
import type {
  CreateOrganizationInput,
  CreateOrganizationResponse,
  CreateTallerDemoResponse,
  OrganizationEdition,
  OrganizationIndustry,
} from "./types";

interface NewOrganizationFormValues {
  organizationName: string;
  adminFullName: string;
  adminEmail: string;
  edition: OrganizationEdition | "";
  industry: OrganizationIndustry | "";
  defaultPhoneCountryCode: string;
  preferredCurrency: string;
  timezone: string;
}

const EMPTY_FORM: NewOrganizationFormValues = {
  organizationName: "",
  adminFullName: "",
  adminEmail: "",
  edition: "",
  industry: "",
  // Con qué nace (src/config/organizacionNueva.ts del backend): hasta el
  // 2026-10-14 el alta no los pedía y la organización quedaba sin país (los
  // teléfonos locales daban error), sin moneda y en UTC. Editables.
  defaultPhoneCountryCode: "598",
  preferredCurrency: "USD",
  timezone: "America/Montevideo",
};

// Los dos usuarios extra del Taller Demo (el admin es el "Primer administrador").
interface UsuariosDelTallerDemo {
  vendedorFullName: string;
  vendedorEmail: string;
  tallerFullName: string;
  tallerEmail: string;
}

const EMPTY_USUARIOS_DEL_TALLER: UsuariosDelTallerDemo = {
  vendedorFullName: "",
  vendedorEmail: "",
  tallerFullName: "",
  tallerEmail: "",
};

// Qué demo se está creando, si alguna. Las dos casillas son excluyentes.
type Demo = "" | "clinica" | "taller";

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
  //
  // El Taller Demo (docs/taller-demo.md), igual: su endpoint crea una
  // automotora en modo demo con el módulo Servicios y TRES usuarios (el
  // primer administrador más un vendedor y un encargado del taller).
  const createClinicaDemoMutation = useCreateClinicaDemo();
  const createTallerDemoMutation = useCreateTallerDemo();
  const [demo, setDemo] = useState<Demo>("");
  const [sufijo, setSufijo] = useState("");
  const [usuariosDelTaller, setUsuariosDelTaller] =
    useState<UsuariosDelTallerDemo>(EMPTY_USUARIOS_DEL_TALLER);
  const creando =
    createOrganizationMutation.isPending ||
    createClinicaDemoMutation.isPending ||
    createTallerDemoMutation.isPending;

  const [values, setValues] = useState<NewOrganizationFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateOrganizationResponse | null>(null);
  // Solo del Taller Demo: los tres usuarios y si salió el mail de cada uno.
  const [usuariosCreados, setUsuariosCreados] = useState<
    CreateTallerDemoResponse["usuarios"] | null
  >(null);

  function elegirDemo(cual: Exclude<Demo, "">, marcada: boolean) {
    setDemo(marcada ? cual : "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (demo === "clinica") {
        const result = await createClinicaDemoMutation.mutateAsync({
          adminFullName: values.adminFullName,
          adminEmail: values.adminEmail,
          ...(sufijo.trim() !== "" ? { sufijo: sufijo.trim() } : {}),
        });
        setCreated(result);
        return;
      }
      if (demo === "taller") {
        const result = await createTallerDemoMutation.mutateAsync({
          ...(sufijo.trim() !== "" ? { sufijo: sufijo.trim() } : {}),
          usuarios: {
            admin: { fullName: values.adminFullName, email: values.adminEmail },
            vendedor: {
              fullName: usuariosDelTaller.vendedorFullName,
              email: usuariosDelTaller.vendedorEmail,
            },
            taller: {
              fullName: usuariosDelTaller.tallerFullName,
              email: usuariosDelTaller.tallerEmail,
            },
          },
        });
        setCreated(result);
        setUsuariosCreados(result.usuarios);
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
    setUsuariosCreados(null);
    setError(null);
    setValues(EMPTY_FORM);
    setDemo("");
    setSufijo("");
    setUsuariosDelTaller(EMPTY_USUARIOS_DEL_TALLER);
  }

  if (created) {
    const sinMail = usuariosCreados
      ? Object.values(usuariosCreados).filter((u) => !u.invitacionEnviada)
      : [];
    return (
      <div className="ds-form">
        <PageHeader help={AYUDA.nuevaOrganizacion} title="Organización creada" />
        <div className="ds-stack">
          <Card heading={created.organization.name}>
            <p>
              Identificador: <code>{created.organization.slug}</code>
            </p>
            {usuariosCreados ? (
              <>
                <p>
                  Se crearon tres usuarios: <strong>{usuariosCreados.admin.email}</strong>{" "}
                  (administración), <strong>{usuariosCreados.vendedor.email}</strong> (ventas) y{" "}
                  <strong>{usuariosCreados.taller.email}</strong> (taller). A cada uno le llega una
                  invitación para configurar su contraseña.
                </p>
                {sinMail.length > 0 ? (
                  <p role="alert">
                    No salió el mail de {sinMail.map((u) => u.email).join(", ")}: el correo tiene un
                    cupo por hora. Pasada una hora, en Organizaciones tocá{" "}
                    <strong>Reenviar invitación</strong> en la fila de la demo.
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                Se envió una invitación a <strong>{created.admin.email}</strong> para que configure
                su contraseña.
              </p>
            )}
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

  const textoDelBoton =
    demo === "clinica"
      ? "Crear Clínica Demo"
      : demo === "taller"
        ? "Crear Taller Demo"
        : "Crear organización";

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
                  checked={demo === "clinica"}
                  onChange={(event) => elegirDemo("clinica", event.target.checked)}
                />
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              <FormField label="Taller Demo con datos de ejemplo">
                <input
                  type="checkbox"
                  checked={demo === "taller"}
                  onChange={(event) => elegirDemo("taller", event.target.checked)}
                />
              </FormField>
            </div>
            {demo !== "" ? (
              <div className="ds-field-grid--full">
                <FormField label="Sufijo del nombre (opcional)">
                  <input
                    type="text"
                    value={sufijo}
                    onChange={(event) => setSufijo(event.target.value)}
                    maxLength={60}
                    placeholder={demo === "clinica" ? "Norte" : "Este"}
                  />
                </FormField>
              </div>
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
                <FormField label={<span className="ds-required">Código de país</span>}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={values.defaultPhoneCountryCode}
                    onChange={(event) =>
                      setValues({ ...values, defaultPhoneCountryCode: event.target.value.trim() })
                    }
                    required
                    pattern="[1-9][0-9]{0,2}"
                    maxLength={3}
                    title="De 1 a 3 dígitos, sin + (Uruguay: 598)"
                  />
                </FormField>
                <FormField label={<span className="ds-required">Moneda</span>}>
                  <select
                    value={values.preferredCurrency}
                    onChange={(event) =>
                      setValues({ ...values, preferredCurrency: event.target.value })
                    }
                    required
                  >
                    {CURRENCY_OPTIONS.map((moneda) => (
                      <option key={moneda} value={moneda}>
                        {moneda}
                      </option>
                    ))}
                  </select>
                </FormField>
                <div className="ds-field-grid--full">
                  <FormField label={<span className="ds-required">Zona horaria</span>}>
                    <select
                      value={values.timezone}
                      onChange={(event) => setValues({ ...values, timezone: event.target.value })}
                      required
                    >
                      {ORGANIZATION_TIMEZONE_OPTIONS.map((zona) => (
                        <option key={zona.value} value={zona.value}>
                          {zona.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
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
        {demo === "taller" ? (
          <Card heading="Vendedor y encargado del taller">
            <div className="ds-field-grid">
              <FormField label={<span className="ds-required">Nombre completo del vendedor</span>}>
                <input
                  type="text"
                  value={usuariosDelTaller.vendedorFullName}
                  onChange={(event) =>
                    setUsuariosDelTaller({
                      ...usuariosDelTaller,
                      vendedorFullName: event.target.value,
                    })
                  }
                  required
                  maxLength={255}
                />
              </FormField>
              <FormField label={<span className="ds-required">Email del vendedor</span>}>
                <input
                  type="email"
                  value={usuariosDelTaller.vendedorEmail}
                  onChange={(event) =>
                    setUsuariosDelTaller({
                      ...usuariosDelTaller,
                      vendedorEmail: event.target.value,
                    })
                  }
                  required
                />
              </FormField>
              <FormField
                label={
                  <span className="ds-required">Nombre completo del encargado del taller</span>
                }
              >
                <input
                  type="text"
                  value={usuariosDelTaller.tallerFullName}
                  onChange={(event) =>
                    setUsuariosDelTaller({
                      ...usuariosDelTaller,
                      tallerFullName: event.target.value,
                    })
                  }
                  required
                  maxLength={255}
                />
              </FormField>
              <FormField
                label={<span className="ds-required">Email del encargado del taller</span>}
              >
                <input
                  type="email"
                  value={usuariosDelTaller.tallerEmail}
                  onChange={(event) =>
                    setUsuariosDelTaller({ ...usuariosDelTaller, tallerEmail: event.target.value })
                  }
                  required
                />
              </FormField>
            </div>
          </Card>
        ) : null}
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button type="submit" variant="primary" disabled={creando} loading={creando}>
            {creando ? "Creando…" : textoDelBoton}
          </Button>
        </div>
      </div>
    </form>
  );
}
