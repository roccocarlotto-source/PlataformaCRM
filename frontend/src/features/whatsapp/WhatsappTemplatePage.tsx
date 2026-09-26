import { useRef, useState, type FormEvent } from "react";
import { Badge, type BadgeVariant } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Select } from "../../design-system/Select";
import { useToast } from "../../design-system/useToast";
import {
  useCreateWhatsappTemplate,
  useDeleteWhatsappTemplate,
  useRefreshWhatsappTemplate,
} from "./mutations";
import { insertarToken, previewDePlantilla, TOKEN_LINK, TOKEN_NOMBRE } from "./preview";
import { useCurrentWhatsappTemplate } from "./queries";
import type { WhatsappTemplate, WhatsappTemplateStatus } from "./types";

const ESTADOS: Record<WhatsappTemplateStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: "Pendiente", variant: "info" },
  APPROVED: { label: "Aprobada", variant: "success" },
  REJECTED: { label: "Rechazada", variant: "danger" },
};

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

const FORM_INICIAL: FormValues = {
  name: "seguimiento_postventa",
  language: "es_AR",
  bodyText:
    "Hola {nombre}, gracias por tu compra. Nos ayudaría mucho conocer tu opinión sobre la atención que recibiste. Podés dejarla en este enlace: {link} ¡Muchas gracias!",
};

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
      !window.confirm(
        "¿Borrar esta plantilla? Se borra también en WhatsApp y, hasta que cargues otra y Meta la apruebe, no sale ningún seguimiento.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteMutation.mutateAsync(plantilla.id);
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
            Meta la está revisando (suele tardar de minutos a unas horas). Mientras tanto no sale
            ningún seguimiento; quedan en espera y salen solos cuando se apruebe.
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
          <Button onClick={() => void actualizar()} disabled={ocupado}>
            {refreshMutation.isPending ? "Consultando…" : "Actualizar estado"}
          </Button>{" "}
          <Button variant="danger" onClick={() => void borrar()} disabled={ocupado}>
            {deleteMutation.isPending ? "Borrando…" : "Borrar y volver a intentar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function NuevaPlantilla({ inicial }: { inicial: FormValues }) {
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
            y donde va el link del QR poné {TOKEN_LINK}: cada uno una vez, {TOKEN_NOMBRE} antes que{" "}
            {TOKEN_LINK}, y con texto antes y después de los dos (Meta no acepta un mensaje que
            empiece o termine con uno). Meta revisa la plantilla antes de que se pueda usar.
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
            <Button type="submit" variant="primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Enviando…" : "Enviar a Meta para aprobación"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

// La plantilla de WhatsApp del seguimiento post-venta (ítem 160 de
// docs/frontend-cambios-pendientes.md): el mensaje que la automatización
// "Enviar QR por WhatsApp" le manda al cliente cuando se gana una
// oportunidad. Singleton, como Organización: la organización tiene a lo sumo
// una plantilla activa, así que la pantalla muestra esa o el formulario para
// crearla. Vive bajo AdminRoute (todo el endpoint es ADMIN-only).
//
// "Borrar y volver a intentar" deja el formulario precargado con el texto que
// se borró: el caso típico es un rechazo de Meta, y corregir es más corto que
// reescribir.
export function WhatsappTemplatePage() {
  const plantillaQuery = useCurrentWhatsappTemplate();
  const [borrada, setBorrada] = useState<WhatsappTemplate | null>(null);

  if (plantillaQuery.isLoading) {
    return <LoadingState />;
  }

  if (plantillaQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la plantilla de WhatsApp
        {plantillaQuery.error instanceof Error ? `: ${plantillaQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const plantilla = plantillaQuery.data ?? null;

  return (
    <div className="ds-form">
      <h1>Plantilla de WhatsApp</h1>
      <div className="ds-stack">
        <p className="ds-hint">
          Es el mensaje con el que sale el seguimiento post-venta por WhatsApp (la automatización
          &quot;Enviar QR por WhatsApp&quot; al ganar una oportunidad). Sin una plantilla aprobada
          por Meta, no se manda ninguno.
        </p>
        {plantilla ? (
          <PlantillaActual plantilla={plantilla} onBorrada={setBorrada} />
        ) : (
          <NuevaPlantilla
            key={borrada?.id ?? "nueva"}
            inicial={
              borrada
                ? { name: borrada.name, language: borrada.language, bodyText: borrada.bodyText }
                : FORM_INICIAL
            }
          />
        )}
      </div>
    </div>
  );
}
