import { tieneModulo, useModulo } from "../../auth/useModulo";
import { esClinica, vocabularioDe } from "../../auth/vocabulario";
import { textosDeLaUnionDeClinica } from "./merge";
import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { AVISO_SOLO_LECTURA, esAdmin, puedeEditarContacto } from "../../auth/permisos";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { CompanySelect } from "../company/CompanySelect";
import { UserSelect } from "../user/UserSelect";
import { MergeContactDialog } from "./MergeContactDialog";
import { STATUS_BADGE_VARIANT, STATUS_LABELS } from "../vehicle/labels";
import { VehicleSelect } from "../vehicle/VehicleSelect";
import { Badge } from "../../design-system/Badge";
import { formatDateOnly } from "../../design-system/detailFormat";
import { useConfirm } from "../../design-system/useConfirm";
import { ContactVouchersSection } from "../voucher/ContactVouchersSection";
import { TarjetaVehiculosDelContacto } from "../servicios/TarjetaVehiculosDelContacto";
import { CreateVoucherDialog } from "../voucher/CreateVoucherDialog";
import { ContactCustomFieldsCard } from "../contactCustomField/ContactCustomFieldsCard";
import { contactCustomFieldsQuery } from "../contactCustomField/queries";
import { vehiculosDelContactoQuery } from "../servicios/queries";
import { USUARIOS_PARA_ELEGIR, usersQuery } from "../user/queries";
import { contactVouchersQuery } from "../voucher/queries";
import type { ContactCustomFieldValue } from "../contactCustomField/types";
import { etiquetasDeEtapa, LIFECYCLE_STAGES } from "./labels";
import { useCreateContact, useErasePersonalData, useUpdateContact } from "./mutations";
import { Notice } from "../../design-system/Notice";
import { useContact } from "./queries";

// "Cliente desde" es un día del calendario guardado como medianoche UTC: se
// muestra con la parte de fecha, sin pasarlo por la zona del navegador (que lo
// correría al día anterior al oeste de Greenwich).
function formatearDia(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}
import type { Contact, CreateContactInput, LifecycleStage } from "./types";
import { useFormDraft } from "../../lib/useFormDraft";

interface ContactFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  lifecycleStage: LifecycleStage;
  source: string;
  companyId: string | undefined;
  // Mismo criterio que companyId: undefined = "no elegido". En creación
  // arranca en el id de quien crea (ver initialValues). Nunca null — el
  // PATCH no puede limpiar ownerId (chequeo truthy en contact.service.ts).
  ownerId: string | undefined;
  // Vehículo de interés: solo en edición. null = sin unidad.
  vehicleOfInterestId: string | null;
  // B6: los campos personalizados, { key: valor }. Lo que no está cargado no
  // tiene key; al guardar, un valor vaciado viaja como null (borra).
  customFields: Record<string, ContactCustomFieldValue>;
}

const EMPTY_FORM: ContactFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  lifecycleStage: "LEAD",
  source: "",
  companyId: undefined,
  ownerId: undefined,
  vehicleOfInterestId: null,
  customFields: {},
};

// Los campos de texto vacíos se envían como undefined (no como ""),
// consistente con el patrón ya usado en Company. companyId se envía tal
// cual esté en el estado del form — nunca se ofrece limpiarlo a partir de
// un valor ya persistido (ver CompanySelect: sin botón de "quitar").
function toInput(values: ContactFormValues): CreateContactInput {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email || undefined,
    phone: values.phone || undefined,
    jobTitle: values.jobTitle || undefined,
    lifecycleStage: values.lifecycleStage,
    source: values.source || undefined,
    companyId: values.companyId,
    ownerId: values.ownerId || undefined,
    // B6: solo si hay algo que mandar (una organización sin campos no manda
    // la clave). Un valor vaciado va como null para borrarlo.
    ...(Object.keys(values.customFields).length > 0 ? { customFields: values.customFields } : {}),
  };
}

// Valores del formulario derivados de un registro ya persistido. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Contact): ContactFormValues {
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email ?? "",
    phone: data.phone ?? "",
    jobTitle: data.jobTitle ?? "",
    lifecycleStage: data.lifecycleStage,
    source: data.source ?? "",
    companyId: data.companyId ?? undefined,
    // ?? undefined por lo mismo que companyId justo arriba: el campo es
    // nullable en la API y UserSelect espera string | undefined.
    ownerId: data.ownerId ?? undefined,
    vehicleOfInterestId: data.vehicleOfInterestId ?? null,
    customFields: valoresGuardados(data.customFields),
  };
}

// Lo que el contacto tiene guardado, como { key: valor }; un JSON raro (o
// ausente) es "nada cargado".
function valoresGuardados(json: unknown): Record<string, ContactCustomFieldValue> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const valores: Record<string, ContactCustomFieldValue> = {};
  for (const [key, valor] of Object.entries(json as Record<string, unknown>)) {
    if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
      valores[key] = valor;
    } else if (Array.isArray(valor) && valor.every((v) => typeof v === "string")) {
      // Una selección múltiple.
      valores[key] = valor as string[];
    }
  }
  return valores;
}

// La unidad de interés cuando ya no se puede leer por id (dada de baja): la
// ficha la sigue mostrando, con su estado, desde el resumen del GET.
function vehiculoDeInteresGuardado(contact: Contact | undefined) {
  const v = contact?.vehicleOfInterest;
  if (!v) return undefined;
  return (
    <>
      {[v.make, v.model, String(v.year), v.trim].filter(Boolean).join(" ")}{" "}
      <Badge variant={STATUS_BADGE_VARIANT[v.status]}>{STATUS_LABELS[v.status]}</Badge>
      {v.deletedAt ? " · dada de baja del stock" : null}
    </>
  );
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), mismo patrón que CompanyFormPage.
//
// ownerId YA ESTÁ en el formulario, por el mismo motivo que en Company: el gap
// de M3 era que no había GET /api/users consumido y un UUID crudo no es un
// control aceptable. M5 lo consumió y dejó UserSelect listo.
//
// Asignado arranca preseleccionado en quien crea, igual que en Company
// (ítem 7 de docs/frontend-cambios-pendientes.md): createContact llama al
// MISMO resolveOwnerId que createCompany (ownership.service.ts) y
// autoasignaría igual si no se mandara nada, pero la opción "Asignado a quien
// crea (por defecto)" al lado del mismo usuario en la lista era redundante.
// Con clearable={false}, UserSelect no renderiza opción vacía mientras haya
// un valor (el PATCH no puede limpiar ownerId: chequeo truthy en
// contact.service.ts); emptyOptionLabel="Sin asignar" solo se ve al editar un
// contacto viejo con ownerId null, donde guardar sin tocar el campo NO asigna
// a nadie. Verificado en el service, no asumido por analogía.
//
// CompanySelect y UserSelect se montan sueltos, sin envolverlos en FormField:
// traen su propio <label htmlFor>, y FormField ES un <label>, así que
// anidarlos produciría HTML inválido y un getByLabelText ambiguo. Mismo trato
// que en CompanyFormPage y OpportunityFormPage. Su restyle interno es una
// tarea aparte, compartida por varios módulos.
//
// Etapa es un desplegable normal (el combobox del design system desde §46), no
// un Badge: Badge es solo para mostrar el estado, no para elegirlo. Va suelto,
// sin FormField, por el mismo motivo que los demás selectores.
export function ContactFormPage() {
  // Ediciones (docs/ediciones.md §2.2): sin el módulo empresas, sin el
  // selector (y sin pedir la lista de empresas, que daría 403).
  const tieneEmpresas = useModulo("empresas");
  // El taller (docs/servicios.md §4.6): un módulo activable.
  const tieneServicios = useModulo("servicios");
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();
  const { me } = useAuth();
  const confirm = useConfirm();
  // Rubros (docs/rubros.md §3.1): los textos del contacto, y sin vehículo de
  // interés donde no hay stock (una clínica).
  const vocabulario = vocabularioDe(me);
  const etiquetaDeEtapa = etiquetasDeEtapa(vocabulario.contacto);
  const conStock = tieneModulo(me, "stock");

  const contactQuery = useContact(isEditMode ? id : undefined);

  // Lo que piden las tarjetas de más abajo depende solo del id de la URL, no
  // del contacto. Se pide ya, en paralelo con el contacto, en vez de esperar a
  // que la ficha termine de cargar y las monte: una ronda de requests menos.
  // Mismas claves que las tarjetas (y mismas condiciones para montarlas):
  // cuando montan, lo encuentran en vuelo o en caché, sin pedirlo dos veces.
  const queryClient = useQueryClient();
  const conSelectorDeUsuario = esAdmin(me);
  useEffect(() => {
    if (!id) return;
    void queryClient.prefetchQuery(contactCustomFieldsQuery());
    void queryClient.prefetchQuery(contactVouchersQuery(id));
    if (conSelectorDeUsuario) void queryClient.prefetchQuery(usersQuery(USUARIOS_PARA_ELEGIR));
    if (tieneServicios) void queryClient.prefetchQuery(vehiculosDelContactoQuery(id));
  }, [id, conSelectorDeUsuario, tieneServicios, queryClient]);
  const createContactMutation = useCreateContact();
  const updateContactMutation = useUpdateContact(id ?? "");

  // Solo en creación: el asignado inicial es quien está creando. En
  // edición el valor viene del registro (toFormValues), y si no tiene dueño
  // queda undefined — no se inventa uno.
  const initialValues: ContactFormValues = isEditMode
    ? EMPTY_FORM
    : { ...EMPTY_FORM, ownerId: me?.id };

  // La clave del borrador incluye el borrado de datos personales: después de
  // borrar, el formulario se vuelve a derivar del contacto anonimizado. Si no,
  // seguiría mostrando (y un Guardar volvería a escribir) los datos borrados.
  const [values, setValues] = useFormDraft<ContactFormValues>(
    contactQuery.data
      ? `${contactQuery.data.id}:${contactQuery.data.personalDataErasedAt ?? ""}`
      : undefined,
    contactQuery.data ? toFormValues(contactQuery.data) : initialValues,
  );
  const [error, setError] = useState<string | null>(null);
  const [creandoCupon, setCreandoCupon] = useState(false);
  const [uniendo, setUniendo] = useState(false);
  const [unido, setUnido] = useState<string | null>(null);

  const isSubmitting = createContactMutation.isPending || updateContactMutation.isPending;

  // Una mutación aparte de la del formulario: la marca no pasa por "Guardar"
  // ni mezcla su error con el del resto de la ficha.
  const marcandoSinInteres = useUpdateContact(id ?? "");

  async function handleSinInteres(marcar: boolean) {
    if (
      marcar &&
      !(await confirm(
        "¿Marcar este contacto como «sin interés»? Ningún seguimiento automático le va a escribir hasta que se quite la marca.",
        { confirmLabel: "Marcar" },
      ))
    ) {
      return;
    }
    marcandoSinInteres.mutate({ noInterest: marcar });
  }

  // Borrado de datos personales a pedido del titular: solo ADMIN, irreversible.
  const borrandoDatos = useErasePersonalData(id ?? "");

  async function handleBorrarDatosPersonales() {
    if (
      !(await confirm("¿Borrar los datos personales de este contacto? No se puede deshacer.", {
        confirmLabel: "Borrar datos personales",
        danger: true,
      }))
    ) {
      return;
    }
    borrandoDatos.mutate();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditMode) {
        await updateContactMutation.mutateAsync({
          ...toInput(values),
          vehicleOfInterestId: values.vehicleOfInterestId,
        });
      } else {
        await createContactMutation.mutateAsync(toInput(values));
      }
      navigate("/contacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar el contacto");
    }
  }

  // Con los datos personales borrados la ficha queda en solo lectura: campos
  // deshabilitados y sin Guardar, Crear cupón, Marcar sin interés ni Unir (el
  // backend responde 409 a todo eso, utils/contactoBorrado.ts).
  const datosBorrados = Boolean(contactQuery.data?.personalDataErasedAt);
  // D2: un USER que abre el contacto de otro lo ve, pero no lo guarda (el
  // backend respondería 403).
  const soloLectura =
    isEditMode &&
    contactQuery.data !== undefined &&
    (datosBorrados || !puedeEditarContacto(me, contactQuery.data));

  if (isEditMode && contactQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (isEditMode && contactQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el contacto
        {contactQuery.error instanceof Error ? `: ${contactQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  // Restyle según "Nuevo contacto CRM" de Claude Design, con las piezas que
  // dejó el restyle de Empresas (Card, .ds-form, .ds-field-grid,
  // .ds-required): una tarjeta con los campos de a pares en el orden del
  // diseño — Nombre + Apellido, Email + Teléfono, Puesto + Empresa, Fuente +
  // Etapa, Asignado solo en la última fila (a media columna, como en el
  // export). El "*" va SOLO en los dos campos que de verdad llevan `required`
  // (Nombre, Apellido); el diseño también marca Email pero el formulario no
  // lo exige y no se inventa esa validación. Fuente sigue siendo texto libre
  // aunque el diseño lo dibuje como desplegable: no hay opciones reales que
  // ofrecer. La segunda tarjeta "Campos personalizados" del export no existe
  // en Contact. Guardar sigue al pie, como en el resto de los módulos.
  // "Crear cupón" (a mano) y la tarjeta de sus cupones, solo con el contacto
  // ya creado. Afuera del <form>, como las tarjetas de la oportunidad.
  return (
    <>
      <form onSubmit={handleSubmit} className="ds-form">
        <PageHeader
          help={AYUDA.contactoForm}
          title={isEditMode ? "Editar contacto" : "Nuevo contacto"}
          actions={
            isEditMode && id ? (
              <>
                {!datosBorrados ? (
                  <Button type="button" onClick={() => setCreandoCupon(true)}>
                    Crear cupón
                  </Button>
                ) : null}
                {/* La marca "sin interés" (ítem 185): la pone o la quita quien
                    puede editar el contacto (D2). Sin nota desde acá: la nota
                    es lo que el cliente le dijo al agente. */}
                {!soloLectura && contactQuery.data ? (
                  <Button
                    type="button"
                    onClick={() => void handleSinInteres(!contactQuery.data?.noInterestAt)}
                    disabled={marcandoSinInteres.isPending}
                    loading={marcandoSinInteres.isPending}
                  >
                    {contactQuery.data.noInterestAt ? "Quitar «sin interés»" : "Marcar sin interés"}
                  </Button>
                ) : null}
                {/* Unir sigue siendo de ADMIN (D2). */}
                {esAdmin(me) && !datosBorrados ? (
                  <Button type="button" onClick={() => setUniendo(true)}>
                    Unir con otro contacto
                  </Button>
                ) : null}
                {/* Borrar los datos personales: ADMIN, y una sola vez. */}
                {esAdmin(me) && contactQuery.data && !contactQuery.data.personalDataErasedAt ? (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => void handleBorrarDatosPersonales()}
                    disabled={borrandoDatos.isPending}
                    loading={borrandoDatos.isPending}
                  >
                    Borrar datos personales
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
        {contactQuery.data?.noInterestAt ? (
          <p className="ds-hint" role="status">
            <Badge variant="danger">Sin interés</Badge> desde el{" "}
            {formatDateOnly(contactQuery.data.noInterestAt)}
            {contactQuery.data.noInterestNote ? ` · «${contactQuery.data.noInterestNote}»` : ""}.
          </p>
        ) : null}
        {marcandoSinInteres.isError ? (
          <ErrorState>
            No pudimos cambiar la marca
            {marcandoSinInteres.error instanceof Error
              ? `: ${marcandoSinInteres.error.message}`
              : "."}
          </ErrorState>
        ) : null}
        {unido ? (
          <p className="ds-hint" role="status">
            {unido}
          </p>
        ) : null}
        {contactQuery.data?.personalDataErasedAt ? (
          <p className="ds-hint" role="status">
            {`Datos personales borrados el ${formatDateOnly(contactQuery.data.personalDataErasedAt)}${
              contactQuery.data.personalDataErasedBy
                ? ` por ${contactQuery.data.personalDataErasedBy.fullName}`
                : ""
            }.`}
          </p>
        ) : null}
        {contactQuery.data?.personalDataErasePending?.length ? (
          <Notice tone="warning" alert={false}>
            No se pudo sacar el nombre de{" "}
            {contactQuery.data.personalDataErasePending.length === 1
              ? "1 evento"
              : `${contactQuery.data.personalDataErasePending.length} eventos`}{" "}
            de Google Calendar de sus turnos:{" "}
            {[...new Set(contactQuery.data.personalDataErasePending.map((p) => p.motivo))].join(
              " · ",
            )}
            .
          </Notice>
        ) : null}
        {borrandoDatos.isError ? (
          <ErrorState>
            No pudimos borrar los datos personales
            {borrandoDatos.error instanceof Error ? `: ${borrandoDatos.error.message}` : "."}
          </ErrorState>
        ) : null}
        <fieldset className="ds-stack" disabled={datosBorrados}>
          <Card heading="Datos del contacto">
            <div className="ds-field-grid">
              <FormField label={<span className="ds-required">Nombre</span>}>
                <input
                  type="text"
                  value={values.firstName}
                  onChange={(event) => setValues({ ...values, firstName: event.target.value })}
                  required
                />
              </FormField>
              <FormField label={<span className="ds-required">Apellido</span>}>
                <input
                  type="text"
                  value={values.lastName}
                  onChange={(event) => setValues({ ...values, lastName: event.target.value })}
                  required
                />
              </FormField>
              <FormField label="Email">
                <input
                  type="email"
                  value={values.email}
                  onChange={(event) => setValues({ ...values, email: event.target.value })}
                />
              </FormField>
              <FormField label="Teléfono">
                <input
                  type="text"
                  inputMode="tel"
                  placeholder="099 123 456"
                  value={values.phone}
                  onChange={(event) => setValues({ ...values, phone: event.target.value })}
                />
              </FormField>
              {tieneEmpresas ? (
                <CompanySelect
                  id="contact-form-company"
                  label="Empresa"
                  value={values.companyId}
                  onChange={(companyId) => setValues({ ...values, companyId })}
                />
              ) : null}
              {/* Puesto es el cargo EN la empresa: solo con una elegida. Si se
                quita la empresa, el campo se oculta pero el valor queda en el
                formulario y se guarda igual (no se borra sin que nadie lo
                pida). En ESENCIAL no hay empresas, así que nunca aparece. */}
              {tieneEmpresas && values.companyId ? (
                <FormField label="Puesto">
                  <input
                    type="text"
                    value={values.jobTitle}
                    onChange={(event) => setValues({ ...values, jobTitle: event.target.value })}
                  />
                </FormField>
              ) : null}
              <FormField label="Fuente">
                <input
                  type="text"
                  value={values.source}
                  onChange={(event) => setValues({ ...values, source: event.target.value })}
                />
              </FormField>
              {contactQuery.data?.customerSince ? (
                <p className="ds-hint">
                  {vocabulario.contacto.singularTitulo} desde el{" "}
                  {formatearDia(contactQuery.data.customerSince)}.
                </p>
              ) : null}
              <Select
                label="Etapa"
                value={values.lifecycleStage}
                options={LIFECYCLE_STAGES.map((stage) => ({
                  value: stage,
                  label: etiquetaDeEtapa[stage],
                }))}
                onChange={(lifecycleStage) => {
                  if (lifecycleStage) setValues({ ...values, lifecycleStage });
                }}
              />
              {/* Reasignar es de ADMIN (D2): lo que crea o edita un USER
                  queda a su nombre, y el selector ni se le muestra. */}
              {esAdmin(me) ? (
                <UserSelect
                  id="contact-form-owner"
                  label="Asignado"
                  value={values.ownerId}
                  onChange={(ownerId) => setValues({ ...values, ownerId: ownerId || undefined })}
                  emptyOptionLabel="Sin asignar"
                  clearable={false}
                />
              ) : null}
              {isEditMode && conStock ? (
                <div className="ds-field-grid--full">
                  <VehicleSelect
                    id="contact-form-vehicle-of-interest"
                    label="Vehículo de interés"
                    value={values.vehicleOfInterestId ?? undefined}
                    onChange={(vehicleOfInterestId) =>
                      setValues({ ...values, vehicleOfInterestId })
                    }
                    selectedFallback={vehiculoDeInteresGuardado(contactQuery.data)}
                    clearLabel="Quitar"
                  />
                  {contactQuery.data?.vehicleOfInterestSetBy === "AGENT" &&
                  values.vehicleOfInterestId === contactQuery.data.vehicleOfInterestId ? (
                    <p className="ds-hint">La anotó el agente; si la cambiás, ya no la toca.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>
          {/* B6: los campos personalizados de la organización, si definió alguno. */}
          <ContactCustomFieldsCard
            values={values.customFields}
            onChange={(customFields) => setValues({ ...values, customFields })}
            disabled={soloLectura}
          />
          {error ? <ErrorState>{error}</ErrorState> : null}
          {!datosBorrados ? (
            <div>
              <RequiredFieldsHint />
              {soloLectura ? (
                <p className="ds-hint" role="status">
                  {AVISO_SOLO_LECTURA}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                disabled={isSubmitting || soloLectura}
                loading={isSubmitting}
              >
                {isSubmitting ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
      {isEditMode && id ? <ContactVouchersSection contactId={id} /> : null}
      {/* El taller (docs/servicios.md §4.6): solo con el módulo. Sin él no se
          monta ni se pide nada a /api/servicios. Agregar vehículo no depende
          de quién tiene asignado el contacto (D9), solo de que tenga datos. */}
      {tieneServicios && isEditMode && id ? (
        <TarjetaVehiculosDelContacto contactId={id} puedeAgregar={!datosBorrados} />
      ) : null}
      {creandoCupon && id ? (
        <CreateVoucherDialog
          contactId={id}
          sucursal={vocabulario.sucursal}
          onClose={() => setCreandoCupon(false)}
        />
      ) : null}
      {uniendo && id ? (
        <MergeContactDialog
          contactId={id}
          etiquetasDeEtapa={etiquetaDeEtapa}
          {...(esClinica(me) ? { textos: textosDeLaUnionDeClinica(vocabulario) } : {})}
          onClose={() => setUniendo(false)}
          onMerged={(resultado) => {
            setUniendo(false);
            const total = Object.values(resultado.movidos).reduce((a, b) => a + b, 0);
            setUnido(
              total > 0
                ? `Contactos unidos: ${total} registros pasaron a este contacto.`
                : "Contactos unidos. El duplicado no tenía registros asociados.",
            );
          }}
        />
      ) : null}
    </>
  );
}
