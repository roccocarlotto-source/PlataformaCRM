import { useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useConfirm } from "../../design-system/useConfirm";
import { PageHeader } from "../../design-system/PageHeader";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { useToast } from "../../design-system/useToast";
import { useAutomation } from "../automation/queries";
import { accionConPlantilla, type AccionConPlantilla } from "./acciones";
import { ESTADOS } from "./estados";
import {
  useCreateWhatsappTemplate,
  useDeleteWhatsappTemplate,
  useRefreshWhatsappTemplate,
} from "./mutations";
import { insertarToken, previewDePlantilla, TOKEN_LINK, TOKEN_NOMBRE } from "./preview";
import { useWhatsappTemplate } from "./queries";
import type { WhatsappTemplate } from "./types";

// Los idiomas que tiene sentido ofrecer hoy. El backend acepta cualquier
// código de Meta; la UI acota, igual que las monedas en Organización.
const IDIOMAS = [
  { value: "es_AR", label: "Español (Argentina)" },
  { value: "es", label: "Español" },
  { value: "es_MX", label: "Español (México)" },
  { value: "es_ES", label: "Español (España)" },
  { value: "en_US", label: "Inglés (EE. UU.)" },
  { value: "pt_BR", label: "Portugués (Brasil)" },
];

interface FormValues {
  name: string;
  language: string;
  bodyText: string;
}

// Con qué arranca una plantilla nueva: depende de la acción de la regla (el
// texto del cupón no es el del QR).
function formInicial(accion: AccionConPlantilla): FormValues {
  return { name: accion.nombreInicial, language: "es_AR", bodyText: accion.textoInicial };
}

function Preview({ texto }: { texto: string }) {
  return (
    <div className="ds-stack">
      <span className="ds-field-label">Vista previa</span>
      <div className="ds-chat-bubble" aria-label="Vista previa del mensaje">
        {previewDePlantilla(texto) || "…"}
      </div>
    </div>
  );
}

// La plantilla actual: su estado en Meta y las dos acciones que tiene.
function PlantillaActual({
  plantilla,
  onBorrada,
}: {
  plantilla: WhatsappTemplate;
  onBorrada: (plantilla: WhatsappTemplate) => void;
}) {
  const confirm = useConfirm();
  const refreshMutation = useRefreshWhatsappTemplate();
  const deleteMutation = useDeleteWhatsappTemplate();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADOS[plantilla.status];

  async function actualizar() {
    setError(null);
    try {
      await refreshMutation.mutateAsync(plantilla.id);
      toast.show("Estado actualizado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el estado");
    }
  }

  async function borrar() {
    if (
      !(await confirm(
        "¿Borrar esta plantilla? Se borra también en WhatsApp y, hasta que cargues otra y Meta la apruebe, esta automatización no manda ningún mensaje.",
        { confirmLabel: "Borrar", danger: true },
      ))
    ) {
      return;
    }
    setError(null);
    try {
      await deleteMutation.mutateAsync(plantilla);
      onBorrada(plantilla);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar la plantilla");
    }
  }

  const ocupado = refreshMutation.isPending || deleteMutation.isPending;

  return (
    <Card heading="Plantilla actual">
      <div className="ds-stack">
        <p>
          <Badge variant={estado.variant}>{estado.label}</Badge>{" "}
          <span className="ds-hint">
            {plantilla.name} · {plantilla.language}
          </span>
        </p>
        {plantilla.status === "PENDING" ? (
          <p className="ds-hint">
            Meta la está revisando (suele tardar de minutos a unas horas). Mientras tanto esta
            automatización no manda nada; los envíos quedan en espera y salen solos cuando se
            apruebe.
          </p>
        ) : null}
        {plantilla.status === "REJECTED" ? (
          <p className="ds-hint">
            Meta no la aprobó
            {plantilla.rejectedReason ? `: ${plantilla.rejectedReason}` : ""}. Borrala y volvé a
            intentar con otro texto.
          </p>
        ) : null}
        <Preview texto={plantilla.bodyText} />
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button
            onClick={() => void actualizar()}
            disabled={ocupado}
            loading={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? "Consultando…" : "Actualizar estado"}
          </Button>{" "}
          <Button
            variant="danger"
            onClick={() => void borrar()}
            disabled={ocupado}
            loading={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Borrando…" : "Borrar y volver a intentar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function NuevaPlantilla({
  automationId,
  accion,
  inicial,
}: {
  automationId: string;
  accion: AccionConPlantilla;
  inicial: FormValues;
}) {
  const createMutation = useCreateWhatsappTemplate();
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(inicial);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertar(token: string) {
    const textarea = textareaRef.current;
    const seleccion = textarea
      ? { inicio: textarea.selectionStart, fin: textarea.selectionEnd }
      : { inicio: values.bodyText.length, fin: values.bodyText.length };
    const { texto, cursor } = insertarToken(values.bodyText, token, seleccion);
    setValues({ ...values, bodyText: texto });
    // El cursor queda después del token, para seguir escribiendo ahí.
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await createMutation.mutateAsync({
        automationId,
        name: values.name.trim(),
        language: values.language,
        bodyText: values.bodyText,
      });
      toast.show("Plantilla enviada a Meta para su aprobación");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la plantilla");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card heading="Nueva plantilla">
        <div className="ds-stack">
          <p className="ds-hint">
            Escribí el mensaje con tus palabras. Donde va el nombre del cliente poné {TOKEN_NOMBRE}{" "}
            y donde va {accion.queEsElLink} poné {TOKEN_LINK}: cada uno una vez, {TOKEN_NOMBRE}{" "}
            antes que {TOKEN_LINK}, y con texto antes y después de los dos (Meta no acepta un
            mensaje que empiece o termine con uno). Meta revisa la plantilla antes de que se pueda
            usar.
          </p>
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre interno</span>}>
              <input
                type="text"
                value={values.name}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>
            <Select
              label="Idioma"
              value={values.language}
              options={IDIOMAS}
              onChange={(language) => setValues({ ...values, language: language || "es_AR" })}
              required
            />
            <p className="ds-hint ds-field-grid--full">
              El nombre solo puede tener minúsculas, números y guion bajo (ej.
              seguimiento_postventa), y no puede repetir el de otra plantilla.
            </p>
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Mensaje</span>}>
                <textarea
                  ref={textareaRef}
                  value={values.bodyText}
                  rows={5}
                  onChange={(event) => setValues({ ...values, bodyText: event.target.value })}
                  required
                />
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              <Button onClick={() => insertar(TOKEN_NOMBRE)}>Insertar {TOKEN_NOMBRE}</Button>{" "}
              <Button onClick={() => insertar(TOKEN_LINK)}>Insertar {TOKEN_LINK}</Button>
            </div>
          </div>
          <Preview texto={values.bodyText} />
          {error ? <ErrorState>{error}</ErrorState> : null}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={createMutation.isPending}
              loading={createMutation.isPending}
            >
              {createMutation.isPending ? "Enviando…" : "Enviar a Meta para aprobación"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

// La plantilla de WhatsApp de UNA regla de automatización (ítem 160 de
// docs/frontend-cambios-pendientes.md; por regla desde el ítem 181): el
// mensaje con que esa regla le escribe al cliente. Se llega desde el listado
// (WhatsappTemplateListPage), con la regla en la URL. Singleton por regla:
// muestra la plantilla actual o el formulario para crearla. Vive bajo
// AdminRoute (todo el endpoint es ADMIN-only).
//
// "Borrar y volver a intentar" deja el formulario precargado con el texto que
// se borró: el caso típico es un rechazo de Meta, y corregir es más corto que
// reescribir.
export function WhatsappTemplatePage() {
  const { automationId = "" } = useParams<{ automationId: string }>();
  const reglaQuery = useAutomation(automationId);
  const plantillaQuery = useWhatsappTemplate(automationId);
  const [borrada, setBorrada] = useState<WhatsappTemplate | null>(null);

  if (reglaQuery.isLoading || plantillaQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  const error = reglaQuery.error ?? plantillaQuery.error;
  if (reglaQuery.isError || plantillaQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la plantilla de WhatsApp
        {error instanceof Error ? `: ${error.message}` : "."}
      </ErrorState>
    );
  }

  const regla = reglaQuery.data;
  const accion = regla ? accionConPlantilla(regla.actionType) : undefined;
  if (!regla || !accion) {
    // Una regla que no manda WhatsApp no lleva plantilla (el backend la
    // rechazaría con un 400); se dice acá en vez de ofrecer un formulario
    // que no puede funcionar.
    return (
      <div className="ds-form">
        <PageHeader
          title="Plantilla de WhatsApp"
          back={{ to: "/whatsapp-template", label: "Plantillas de WhatsApp" }}
        />
        <ErrorState>Esta automatización no manda WhatsApp, así que no lleva plantilla.</ErrorState>
      </div>
    );
  }

  const plantilla = plantillaQuery.data ?? null;

  return (
    <div className="ds-form">
      <PageHeader
        title="Plantilla de WhatsApp"
        back={{ to: "/whatsapp-template", label: "Plantillas de WhatsApp" }}
        subtitle={
          <>
            Automatización: <strong>{regla.name}</strong> ({accion.label})
          </>
        }
      />
      <div className="ds-stack">
        <p className="ds-hint">
          Es el mensaje con el que sale esta automatización por WhatsApp. Sin una plantilla aprobada
          por Meta, no se manda ninguno.
        </p>
        {plantilla ? (
          <PlantillaActual plantilla={plantilla} onBorrada={setBorrada} />
        ) : (
          <NuevaPlantilla
            key={borrada?.id ?? "nueva"}
            automationId={automationId}
            accion={accion}
            inicial={
              borrada
                ? { name: borrada.name, language: borrada.language, bodyText: borrada.bodyText }
                : formInicial(accion)
            }
          />
        )}
      </div>
    </div>
  );
}
