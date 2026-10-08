import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select, type SelectOption } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { QrSelect } from "../qr/QrSelect";
import { MensajeDeWhatsappCard } from "./MensajeDeWhatsappCard";
import {
  ACTION_CREATE_FOLLOW_UP,
  ACTION_DRAFT_FOLLOW_UP,
  ACTION_INQUIRY_FOLLOW_UP,
  ACTION_SEND_DISCOUNT_VOUCHER,
  ACTION_SEND_QR_FOLLOWUP,
  CONFIG_DE_ACCION,
  CONFIG_DE_TRIGGER,
  DEFAULT_ACTION,
  DEFAULT_TRIGGER,
  INTERVALO_DE_LOS_ENVIOS_MINUTOS,
  MAX_DAYS_SINCE_LAST_MESSAGE,
  MAX_DAYS_UNTIL_DUE,
  MAX_DAYS_WITHOUT_ACTIVITY,
  MAX_FOLLOW_UPS,
  MAX_EXPIRES_IN_DAYS,
  MAX_NOTES,
  MAX_SUBJECT,
  MAX_VOUCHER_LABEL,
  MIN_DAYS_SINCE_LAST_MESSAGE,
  MIN_DAYS_UNTIL_DUE,
  MIN_DAYS_WITHOUT_ACTIVITY,
  MIN_EXPIRES_IN_DAYS,
  MIN_FOLLOW_UPS,
  TRIGGER_CONTACT_INQUIRY_STALLED,
  TRIGGER_OPPORTUNITY_STALE,
  TRIGGER_OPTIONS,
  UNIDAD_DE_DEMORA_OPTIONS,
  accionConMensajeDeWhatsapp,
  accionesParaTrigger,
  textoInicial,
  type ConfigDraft,
  type UnidadDeDemora,
} from "./catalog";
import { useCreateAutomation, useUpdateAutomation } from "./mutations";
import { useAutomation } from "./queries";
import type { Automation, CreateAutomationInput, UpdateAutomationInput } from "./types";

// El mismo tope que el backend (automation.controller.ts). El maxLength del
// navegador es comodidad, no la garantía: quien valida es Zod.
const MAX_NAME = 200;

interface AutomationFormValues {
  name: string;
  triggerType: string;
  // Borrador de la configuración del trigger elegido (ítem 76), con la misma
  // convención que actionConfig.
  triggerConfig: ConfigDraft;
  actionType: string;
  // Borrador de la configuración de la acción elegida, con todos los campos
  // como string. Ver ConfigDraft en catalog.ts.
  actionConfig: ConfigDraft;
  isActive: boolean;
}

const EMPTY_FORM: AutomationFormValues = {
  name: "",
  // Con un solo trigger y una sola acción vienen elegidos, igual que el
  // proveedor de modelo en AgentFormPage. Son la PRIMERA entrada del catálogo,
  // no un valor escrito a mano: sumar una segunda no cambia este archivo.
  triggerType: DEFAULT_TRIGGER,
  triggerConfig: CONFIG_DE_TRIGGER[DEFAULT_TRIGGER].draftVacio(),
  actionType: DEFAULT_ACTION,
  actionConfig: CONFIG_DE_ACCION[DEFAULT_ACTION].draftVacio(),
  isActive: true,
};

// Una regla guardada antes del formato elegible no trae messageText ni
// whatsappFormat: el formulario arranca con el texto y el formato de la
// plantilla que ya tiene en Meta, y si no tiene ninguna, con el inicial. Así,
// guardarla sin tocar el mensaje manda exactamente lo aprobado y no pide otra
// aprobación.
function conMensajeDeLaPlantilla(automation: Automation): Record<string, unknown> {
  const config = automation.actionConfig;
  if (!accionConMensajeDeWhatsapp(automation.actionType)) return config;
  const approval = automation.whatsappApproval;
  const whatsappFormat = config.whatsappFormat ?? approval?.formato ?? "LINK";
  return {
    ...config,
    whatsappFormat,
    messageText:
      config.messageText ??
      approval?.bodyText ??
      textoInicial(automation.actionType, String(whatsappFormat)),
  };
}

function toFormValues(automation: Automation): AutomationFormValues {
  const config = CONFIG_DE_ACCION[automation.actionType];
  const configDeTrigger = CONFIG_DE_TRIGGER[automation.triggerType];
  return {
    name: automation.name,
    triggerType: automation.triggerType,
    // Una regla guardada antes del ítem 76 puede no traer triggerConfig en
    // alguna respuesta cacheada: se trata como "{}", que es su valor real.
    triggerConfig: configDeTrigger
      ? configDeTrigger.draftDesde(automation.triggerConfig ?? {})
      : {},
    actionType: automation.actionType,
    // Una acción guardada que este catálogo todavía no conoce no tiene cómo
    // dibujar sus campos: el borrador queda vacío y validar() frena el submit
    // con un mensaje, en vez de mandar una config a medias.
    actionConfig: config ? config.draftDesde(conMensajeDeLaPlantilla(automation)) : {},
    isActive: automation.isActive,
  };
}

// Las opciones del catálogo más, si hace falta, el valor ya guardado en la
// regla. Sin esto, una regla creada con un trigger o una acción que el backend
// ya conoce y este espejo todavía no dejaría al <Select> mostrando un rótulo
// vacío y al `required` del navegador bloqueando el guardado para siempre: la
// pantalla no podría ni corregir la regla ni dejarla como estaba. Mismo
// criterio que isKnownTimezone en BranchFormPage (ítem 26) — el valor legacy
// sigue siendo una opción más, mostrada cruda.
function opcionesCon(options: SelectOption<string>[], value: string): SelectOption<string>[] {
  if (value === "" || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: value }];
}

// El error de validación del cliente, o null si el formulario puede viajar.
// Solo mira lo que la validación nativa del navegador NO cubre: Nombre y los
// campos de la config llevan `required` y los frena el propio <form>.
//
// LA VALIDACIÓN DEL RANGO DE LA CONFIG SE HACE ACÁ Y NO SOLO EN EL BACKEND a
// propósito: el 400 llega con el mensaje de Zod ("daysUntilDue no puede
// superar los 365 días"), que nombra el campo con su nombre técnico. El
// mensaje de acá nombra lo que se ve en la pantalla. El backend sigue siendo
// quien decide: esto se adelanta, no lo reemplaza.
function validar(values: AutomationFormValues): string | null {
  // Un trigger que este espejo no conoce no se valida acá: su config viaja
  // tal como está guardada (ver handleSubmit) y la valida el backend.
  const configDeTrigger = CONFIG_DE_TRIGGER[values.triggerType];
  const errorDeTrigger = configDeTrigger ? configDeTrigger.validar(values.triggerConfig) : null;
  if (errorDeTrigger !== null) {
    return errorDeTrigger;
  }
  const config = CONFIG_DE_ACCION[values.actionType];
  if (!config) {
    return `La acción "${values.actionType}" no se puede configurar desde esta pantalla todavía.`;
  }
  return config.validar(values.actionConfig);
}

// ---------------------------------------------------------------------------
// Los campos de configuración del trigger elegido (ítem 76). Mismo patrón que
// CamposDeLaAccion de abajo —un switch, un Fragment de hijos directos de la
// grilla— y por los mismos motivos. Un trigger sin campos (opportunity.won)
// no dibuja nada.
// ---------------------------------------------------------------------------
function CamposDelTrigger({
  triggerType,
  values,
  onChange,
  disabled,
}: {
  triggerType: string;
  values: ConfigDraft;
  onChange: (values: ConfigDraft) => void;
  disabled: boolean;
}) {
  switch (triggerType) {
    case TRIGGER_OPPORTUNITY_STALE:
      return (
        <>
          <FormField label={<span className="ds-required">Días sin movimiento</span>}>
            <input
              type="number"
              min={MIN_DAYS_WITHOUT_ACTIVITY}
              max={MAX_DAYS_WITHOUT_ACTIVITY}
              step={1}
              value={values.daysWithoutActivity ?? ""}
              onChange={(event) => onChange({ ...values, daysWithoutActivity: event.target.value })}
              disabled={disabled}
              required
            />
          </FormField>
          <p className="ds-hint ds-field-grid--full">
            Se dispara con las oportunidades abiertas que no tuvieron ningún cambio en esa cantidad
            de días. Se revisa una vez por día, y cada oportunidad dispara una sola vez hasta que
            vuelva a tener movimiento. Solo puede haber una regla activa con este evento.
          </p>
        </>
      );
    case TRIGGER_CONTACT_INQUIRY_STALLED:
      return (
        <>
          <FormField label={<span className="ds-required">Días sin respuesta</span>}>
            <input
              type="number"
              min={MIN_DAYS_SINCE_LAST_MESSAGE}
              max={MAX_DAYS_SINCE_LAST_MESSAGE}
              step={1}
              value={values.daysSinceLastMessage ?? ""}
              onChange={(event) =>
                onChange({ ...values, daysSinceLastMessage: event.target.value })
              }
              disabled={disabled}
              required
            />
          </FormField>
          <FormField label={<span className="ds-required">Seguimientos como máximo</span>}>
            <input
              type="number"
              min={MIN_FOLLOW_UPS}
              max={MAX_FOLLOW_UPS}
              step={1}
              value={values.maxFollowUps ?? ""}
              onChange={(event) => onChange({ ...values, maxFollowUps: event.target.value })}
              disabled={disabled}
              required
            />
          </FormField>
          <p className="ds-hint ds-field-grid--full">
            Se dispara con los contactos —identificados o no— que escribieron por algún canal y
            llevan esa cantidad de días sin responder, sin una oportunidad abierta y sin la marca
            «sin interés». Se revisa una vez por día. El máximo es cuántos seguimientos se hacen por
            cada vez que el cliente escribe: si responde, la cuenta arranca de cero. Solo puede
            haber una regla activa con este evento.
          </p>
        </>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// "Esperar": un número entero más su unidad (minutos, horas o días), en las
// reglas que agendan un WhatsApp. Dos hijos sueltos de la grilla, igual que
// CamposDeLaAccion. El tope de 30 días lo valida validar() en la unidad que
// sea; el input solo impide negativos y decimales.
// ---------------------------------------------------------------------------
function CampoDeDemora({
  id,
  values,
  onChange,
  disabled,
}: {
  id: string;
  values: ConfigDraft;
  onChange: (values: ConfigDraft) => void;
  disabled: boolean;
}) {
  return (
    <>
      <FormField label={<span className="ds-required">Esperar</span>}>
        <input
          type="number"
          min={0}
          step={1}
          value={values.delayAmount ?? ""}
          onChange={(event) => onChange({ ...values, delayAmount: event.target.value })}
          disabled={disabled}
          required
        />
      </FormField>
      {/* Suelto, sin FormField: Select trae su propio <label htmlFor>. */}
      <Select<UnidadDeDemora>
        id={id}
        label="Unidad"
        value={values.delayUnit as UnidadDeDemora}
        options={UNIDAD_DE_DEMORA_OPTIONS}
        onChange={(delayUnit) => {
          if (delayUnit) onChange({ ...values, delayUnit });
        }}
        disabled={disabled}
        required
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Los campos de configuración de la acción elegida.
//
// Un `switch` sobre actionType y nada más: agregar una acción con otra forma
// de config es agregar un `case` acá y una entrada a CONFIG_DE_ACCION, no
// reescribir el formulario. No hay un motor de formularios genérico manejado
// por metadata —con un catálogo de una acción sería más código del que evita—
// pero el punto de extensión está donde tiene que estar.
//
// Devuelve un Fragment, no un <div>: sus hijos tienen que ser hijos DIRECTOS
// de .ds-field-grid para que la grilla los ubique y para que el margen
// negativo de .ds-hint caiga contra el gap correcto (la regla que dejó el
// ítem 58).
// ---------------------------------------------------------------------------
function CamposDeLaAccion({
  actionType,
  values,
  onChange,
  disabled,
}: {
  actionType: string;
  values: ConfigDraft;
  onChange: (values: ConfigDraft) => void;
  disabled: boolean;
}) {
  switch (actionType) {
    case ACTION_CREATE_FOLLOW_UP:
      return (
        <>
          <FormField label={<span className="ds-required">Título de la tarea</span>}>
            <input
              type="text"
              value={values.subject ?? ""}
              maxLength={MAX_SUBJECT}
              placeholder="Llamar para coordinar la entrega"
              onChange={(event) => onChange({ ...values, subject: event.target.value })}
              disabled={disabled}
              required
            />
          </FormField>
          <FormField label={<span className="ds-required">Vence en (días)</span>}>
            <input
              type="number"
              min={MIN_DAYS_UNTIL_DUE}
              max={MAX_DAYS_UNTIL_DUE}
              step={1}
              value={values.daysUntilDue ?? ""}
              onChange={(event) => onChange({ ...values, daysUntilDue: event.target.value })}
              disabled={disabled}
              required
            />
          </FormField>
          {/* Opcional, y por eso sin el asterisco de .ds-required ni el
              required del input. A lo ancho, como <textarea> y sin placeholder:
              calcado del campo "Notas" del formulario MANUAL de actividades
              (ActivityFormPage), porque es literalmente el mismo dato
              —Activity.body— y llamarlo distinto acá lo volvería un concepto
              aparte. El <div> envolvente es el que lleva la clase de la grilla,
              porque FormField ES un <label> y no acepta className. */}
          <div className="ds-field-grid--full">
            <FormField label="Notas">
              <textarea
                value={values.notes ?? ""}
                maxLength={MAX_NOTES}
                onChange={(event) => onChange({ ...values, notes: event.target.value })}
                disabled={disabled}
              />
            </FormField>
          </div>
          <p className="ds-hint ds-field-grid--full">
            La tarea se crea asignada al dueño de la oportunidad, con ese título y venciendo en esa
            cantidad de días contados desde que se dispara. Entre {MIN_DAYS_UNTIL_DUE} y{" "}
            {MAX_DAYS_UNTIL_DUE}; con {MIN_DAYS_UNTIL_DUE} vence el mismo día. Las notas son
            opcionales: si las cargás, quedan en el campo "Notas" de la tarea creada.
          </p>
        </>
      );
    case ACTION_DRAFT_FOLLOW_UP:
      // Sin campos propios: su único parámetro es del trigger.
      return (
        <p className="ds-hint ds-field-grid--full">
          La IA redacta un mensaje breve para retomar el contacto con el cliente, usando los datos
          de la oportunidad y su última conversación si la hay, y lo deja como una tarea para el
          dueño de la oportunidad que vence ese mismo día. El mensaje no se le manda a nadie: lo
          revisa y lo envía el vendedor.
        </p>
      );
    case ACTION_INQUIRY_FOLLOW_UP:
      // Sin campos propios además del mensaje (la tarjeta de abajo).
      return (
        <p className="ds-hint ds-field-grid--full">
          Por WhatsApp se le manda al cliente el mensaje de abajo, dentro del horario de la sucursal
          (si escribió hace menos de 24 horas, el agente redacta uno con el contexto de la
          conversación). Por Messenger, Instagram o el sitio web, o si una persona ya está
          atendiendo la conversación, se crea una tarea para el vendedor asignado con el resumen de
          lo que preguntó. Si el cliente responde, el agente sigue la conversación.
        </p>
      );
    case ACTION_SEND_QR_FOLLOWUP:
      return (
        <>
          {/* Suelto, sin FormField: QrSelect trae su propio <label htmlFor>
              (es un Select del design system), igual que los selectores de
              evento y acción de arriba. */}
          <QrSelect
            id="automation-form-qr"
            label="QR a enviar"
            value={values.qrCodeId}
            onChange={(qrCodeId) => onChange({ ...values, qrCodeId })}
            disabled={disabled}
            required
          />
          <CampoDeDemora
            id="automation-form-qr-delay-unit"
            values={values}
            onChange={onChange}
            disabled={disabled}
          />
          <p className="ds-hint ds-field-grid--full">
            Cuando la oportunidad se gana, se agenda un WhatsApp al contacto con el QR elegido, que
            sale pasada esa espera (hasta 30 días; con 0 sale apenas se gana). Los envíos agendados
            se revisan cada {INTERVALO_DE_LOS_ENVIOS_MINUTOS} minutos, así que puede salir hasta{" "}
            {INTERVALO_DE_LOS_ENVIOS_MINUTOS} minutos después. Se manda desde el número de WhatsApp
            de la sucursal del QR. Si para entonces la oportunidad ya no está ganada, no se manda.
          </p>
        </>
      );
    case ACTION_SEND_DISCOUNT_VOUCHER:
      return (
        <>
          <div className="ds-field-grid--full">
            <FormField label={<span className="ds-required">Descuento</span>}>
              <input
                type="text"
                value={values.label ?? ""}
                maxLength={MAX_VOUCHER_LABEL}
                placeholder="15% de descuento en el taller"
                onChange={(event) => onChange({ ...values, label: event.target.value })}
                disabled={disabled}
                required
              />
            </FormField>
          </div>
          {/* Suelto, sin FormField: BranchSelect trae su propio <label htmlFor>. */}
          <BranchSelect
            id="automation-form-branch"
            label="Sucursal"
            value={values.branchId}
            onChange={(branchId) => onChange({ ...values, branchId })}
            disabled={disabled}
            required
          />
          <CampoDeDemora
            id="automation-form-voucher-delay-unit"
            values={values}
            onChange={onChange}
            disabled={disabled}
          />
          <FormField label={<span className="ds-required">Vence a los (días)</span>}>
            <input
              type="number"
              min={MIN_EXPIRES_IN_DAYS}
              max={MAX_EXPIRES_IN_DAYS}
              step={1}
              value={values.expiresInDays ?? ""}
              onChange={(event) => onChange({ ...values, expiresInDays: event.target.value })}
              disabled={disabled}
              required
            />
          </FormField>
          <p className="ds-hint ds-field-grid--full">
            Cuando la oportunidad se gana, se agenda un WhatsApp al contacto con un cupón de un solo
            uso, que sale pasada esa espera desde el número de WhatsApp de la sucursal (puede salir
            hasta {INTERVALO_DE_LOS_ENVIOS_MINUTOS} minutos después: los envíos agendados se revisan
            cada {INTERVALO_DE_LOS_ENVIOS_MINUTOS} minutos). El cupón nace al mandarse y vence a los
            días indicados. Se canjea escaneando su QR en "Canjear cupón".
          </p>
        </>
      );
    default:
      // Solo se llega acá con una acción que el backend conoce y este espejo
      // todavía no. No se inventa un editor de JSON crudo: se dice qué pasa.
      return (
        <p className="ds-hint ds-field-grid--full">
          Esta acción todavía no se puede configurar desde esta pantalla. Su configuración actual se
          conserva tal cual mientras no se guarde la regla.
        </p>
      );
  }
}

function mensajeDeSincronizacion(motivo: string): string {
  return `La regla se guardó, pero el mensaje no se pudo mandar a aprobación de WhatsApp: ${motivo} Guardá de nuevo para reintentar.`;
}

// ---------------------------------------------------------------------------
// Alta y edición de una automatización — el modo se distingue del propio param
// de ruta (:id), mismo patrón que KnowledgeBaseFormPage y AgentFormPage.
//
// LO QUE ESTA PANTALLA ES: la forma de crear una regla sin pegarle a la API a
// mano. El motor (trigger → acción, dispatcher idempotente sobre el outbox) ya
// estaba construido y probado del lado del backend
// (docs/automations-architecture.md); este formulario no ejecuta nada ni sabe
// nada de ejecuciones, solo configura.
//
// LOS DOS SELECTORES SON SELECTORES DE VERDAD, y el de acción ofrece solo las
// que admite el evento elegido (ACCIONES_POR_TRIGGER en catalog.ts). Sumar un
// trigger o una acción es agregar entradas a catalog.ts y, si trae campos, un
// `case` a CamposDelTrigger o a CamposDeLaAccion.
// ---------------------------------------------------------------------------
export function AutomationFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const automationQuery = useAutomation(isEditMode ? id : undefined);
  const createAutomationMutation = useCreateAutomation();
  const updateAutomationMutation = useUpdateAutomation(id ?? "");

  const [values, setValues] = useFormDraft<AutomationFormValues>(
    automationQuery.data?.id,
    automationQuery.data ? toFormValues(automationQuery.data) : EMPTY_FORM,
  );
  const location = useLocation();
  // Un alta cuyo mensaje no llegó a Meta vuelve a esta pantalla, ya en
  // edición, con el motivo (ver handleSubmit).
  const errorAlCrear = (location.state as { whatsappSyncError?: string } | null)?.whatsappSyncError;
  const [error, setError] = useState<string | null>(
    errorAlCrear ? mensajeDeSincronizacion(errorAlCrear) : null,
  );

  const isSubmitting = createAutomationMutation.isPending || updateAutomationMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const errorDeValidacion = validar(values);
    if (errorDeValidacion !== null) {
      setError(errorDeValidacion);
      return;
    }

    // Se mandan todos los campos, sin diferenciar cuál cambió (mismo criterio
    // que Knowledge Base, Agent y Branch): "la regla queda así" es más simple
    // que un diff, y el PATCH parcial lo acepta. Acá además evita un caso
    // real: el service revalida el actionConfig EFECTIVO contra la acción
    // EFECTIVA, así que mandar el actionType sin su config lo obligaría a
    // revalidar la config vieja contra el schema nuevo.
    // Un trigger que este espejo no conoce no manda triggerConfig: el backend
    // revalida la que la regla ya tiene guardada contra su trigger.
    const configDeTrigger = CONFIG_DE_TRIGGER[values.triggerType];
    const input: CreateAutomationInput = {
      name: values.name.trim(),
      triggerType: values.triggerType,
      ...(configDeTrigger ? { triggerConfig: configDeTrigger.aPayload(values.triggerConfig) } : {}),
      actionType: values.actionType,
      // validar() ya garantizó que la acción está en el catálogo.
      actionConfig: CONFIG_DE_ACCION[values.actionType].aPayload(values.actionConfig),
      isActive: values.isActive,
    };

    try {
      const guardada = isEditMode
        ? await updateAutomationMutation.mutateAsync(input satisfies UpdateAutomationInput)
        : await createAutomationMutation.mutateAsync(input);
      // La regla quedó guardada, pero el mensaje no llegó a WhatsApp (Meta no
      // contestó, rechazó el texto, falta configuración): se queda acá para
      // que se vea y se pueda guardar de nuevo. Un alta pasa a la edición de
      // la regla ya creada, para que guardar otra vez no cree una segunda.
      if (guardada.whatsappSyncError) {
        // También en el alta: React Router reusa esta misma instancia al
        // pasar de /new a /:id/edit, y el estado inicial de abajo no vuelve a
        // correr. El state de la navegación cubre el remonte.
        setError(mensajeDeSincronizacion(guardada.whatsappSyncError));
        if (!isEditMode) {
          navigate(`/automations/${guardada.id}/edit`, {
            replace: true,
            state: { whatsappSyncError: guardada.whatsappSyncError },
          });
        }
        return;
      }
      navigate("/automations");
    } catch (err) {
      // El mensaje del backend se muestra tal cual y NO se toca nada de lo
      // cargado: un 400 no puede costarle a nadie lo que venía escribiendo.
      // No se mapea a un campo concreto porque el proyecto no tiene hoy
      // ninguna infraestructura de errores por campo —ningún formulario la
      // tiene— y el ítem 62 no es razón para inventarla: los mensajes de Zod
      // del backend ya nombran el campo ("daysUntilDue debe ser un número
      // entero"), y los rangos se adelantan en validar() con el nombre de la
      // pantalla.
      setError(err instanceof Error ? err.message : "No pudimos guardar la automatización");
    }
  }

  if (isEditMode && automationQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (isEditMode && automationQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la automatización
        {automationQuery.error instanceof Error ? `: ${automationQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <PageHeader title={isEditMode ? "Editar automatización" : "Nueva automatización"} />
      <div className="ds-stack">
        <Card heading="Datos de la automatización">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.name}
                maxLength={MAX_NAME}
                placeholder="Seguimiento post-venta"
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>

            <p className="ds-hint ds-field-grid--full">
              El nombre es para vos: identifica la regla en esta lista y no lo ve nadie más.
            </p>

            <div className="ds-field-grid--full">
              <FormField label="Activa">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => setValues({ ...values, isActive: event.target.checked })}
                />
              </FormField>
            </div>

            <p className="ds-hint ds-field-grid--full">
              Si la desactivás, deja de ejecutarse sin borrarse — por ejemplo, para pausarla unos
              días y volver a prenderla después.
            </p>
          </div>
        </Card>

        <Card heading="Cuándo se ejecuta">
          <div className="ds-field-grid">
            {/* Suelto, sin FormField: Select trae su propio <label htmlFor> y
                FormField ES un <label>. */}
            <Select
              id="automation-form-trigger"
              label="Evento"
              value={values.triggerType}
              options={opcionesCon(TRIGGER_OPTIONS, values.triggerType)}
              onChange={(triggerType) => {
                if (!triggerType) return;
                // Cambiar de evento cambia la forma de SU config —se arranca
                // de cero, igual que al cambiar de acción— y puede dejar a la
                // acción elegida fuera de las que el evento admite: en ese
                // caso se pasa a la primera que sí, con su config vacía, en
                // vez de dejar armada una combinación que el backend rechaza.
                const configDeTrigger = CONFIG_DE_TRIGGER[triggerType];
                const permitidas = accionesParaTrigger(triggerType);
                const accionSigue = permitidas.some((option) => option.value === values.actionType);
                const actionType = accionSigue ? values.actionType : permitidas[0]?.value;
                const configDeAccion = actionType ? CONFIG_DE_ACCION[actionType] : undefined;
                setValues({
                  ...values,
                  triggerType,
                  triggerConfig: configDeTrigger ? configDeTrigger.draftVacio() : {},
                  ...(accionSigue || !actionType
                    ? {}
                    : {
                        actionType,
                        actionConfig: configDeAccion ? configDeAccion.draftVacio() : {},
                      }),
                });
              }}
              required
            />
            <CamposDelTrigger
              triggerType={values.triggerType}
              values={values.triggerConfig}
              onChange={(triggerConfig) => setValues({ ...values, triggerConfig })}
              disabled={isSubmitting}
            />
            <p className="ds-hint ds-field-grid--full">
              El evento que dispara la regla. El otro caso previsto —recordatorio de turno por
              WhatsApp— todavía no está disponible.
            </p>
          </div>
        </Card>

        <Card heading="Qué hace">
          <div className="ds-field-grid">
            <Select
              id="automation-form-action"
              label="Acción"
              value={values.actionType}
              options={opcionesCon(accionesParaTrigger(values.triggerType), values.actionType)}
              onChange={(actionType) => {
                if (!actionType) return;
                // Cambiar de acción cambia la FORMA de la config: el borrador
                // de la acción anterior no significa nada en la nueva, así que
                // se arranca de cero en vez de arrastrar campos ajenos.
                const config = CONFIG_DE_ACCION[actionType];
                setValues({
                  ...values,
                  actionType,
                  actionConfig: config ? config.draftVacio() : {},
                });
              }}
              required
            />
            <CamposDeLaAccion
              actionType={values.actionType}
              values={values.actionConfig}
              onChange={(actionConfig) => setValues({ ...values, actionConfig })}
              disabled={isSubmitting}
            />
          </div>
        </Card>

        {accionConMensajeDeWhatsapp(values.actionType) ? (
          <MensajeDeWhatsappCard
            actionType={values.actionType}
            values={values.actionConfig}
            onChange={(actionConfig) => setValues({ ...values, actionConfig })}
            disabled={isSubmitting}
            approval={automationQuery.data?.whatsappApproval}
            automationId={isEditMode ? id : undefined}
          />
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
