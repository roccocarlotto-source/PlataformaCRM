import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FileInputButton } from "../../design-system/FileInputButton";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { extractKnowledgeBaseText } from "./api";
import { useCreateKnowledgeBaseEntry, useUpdateKnowledgeBaseEntry } from "./mutations";
import { useKnowledgeBaseEntry } from "./queries";
import {
  EXTENSIONES_ARCHIVO_SOPORTADAS,
  type CreateKnowledgeBaseEntryInput,
  type KnowledgeBaseEntry,
  type UpdateKnowledgeBaseEntryInput,
} from "./types";

// Los mismos topes que el backend (knowledgeBaseEntry.controller.ts). El
// maxLength del navegador es comodidad, no la garantía: quien valida es Zod.
const MAX_TITLE = 200;
const MAX_CONTENT = 10_000;

interface KnowledgeBaseFormValues {
  branchId: string | undefined;
  title: string;
  content: string;
  isActive: boolean;
}

const EMPTY_FORM: KnowledgeBaseFormValues = {
  branchId: undefined,
  title: "",
  content: "",
  isActive: true,
};

const PLACEHOLDER_CONTENIDO =
  "Ej.: Atendemos de lunes a viernes de 9 a 18 y los sábados de 9 a 13. El último turno se da media hora antes del cierre.";

const ETIQUETA_ARCHIVO = "Completar desde un archivo (.txt, .docx o .pdf)";

// El aviso antes de pisar lo que ya estaba escrito. window.confirm y no un
// componente nuevo: el proyecto no tiene hoy ningún diálogo de confirmación
// compartido, y el ítem 60 no es razón para inventar uno — lo mismo hace
// ContactListPage antes de borrar.
const CONFIRMAR_PISAR_CONTENIDO =
  "El campo Contenido ya tiene texto. Si seguís, el archivo lo reemplaza por completo. ¿Seguimos?";

// El aviso antes de quitar el archivo (ítem 67). Se pregunta por lo mismo que
// arriba: quitar no es un gesto visual, borra el Contenido que el archivo
// dejó, y eso puede ser un documento entero.
const CONFIRMAR_QUITAR_ARCHIVO =
  "Se quita el archivo y se borra el contenido que trajo, dejando el campo vacío. " +
  "No se recupera lo que hubiera antes de elegirlo. ¿Seguimos?";

function toFormValues(entry: KnowledgeBaseEntry): KnowledgeBaseFormValues {
  return {
    branchId: entry.branchId,
    title: entry.title,
    content: entry.content,
    isActive: entry.isActive,
  };
}

// El error de validación del cliente, o null si el formulario puede viajar.
// Solo mira lo que la validación nativa del navegador NO cubre: Título y
// Contenido llevan `required` y los frena el propio <form>.
function validar(values: KnowledgeBaseFormValues): string | null {
  // El `required` de BranchSelect no alcanza: mientras la lista de sucursales
  // carga, el componente no renderiza ningún input (solo el rótulo y el aviso
  // de carga), así que no hay nada que el navegador pueda frenar. Es el hueco
  // que el propio BranchSelect documenta y que cada formulario cubre por su
  // cuenta. Acá vale para los DOS modos, no solo para la creación: la sucursal
  // se puede cambiar también al editar.
  if (!values.branchId) {
    return "Elegí la sucursal a la que pertenece esta entrada.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alta y edición de una entrada de la base de conocimiento — el modo se
// distingue del propio param de ruta (:id), mismo patrón que AgentFormPage y
// BranchFormPage.
//
// Cuatro campos, y a propósito no hay más: NO tiene modelo, ni acciones, ni
// canales, ni reglas del agente. Esto es texto que el negocio carga y que se
// suma tal cual al prompt de TODOS los agentes de la sucursal — sin traducción
// y sin confirmación, a diferencia de las reglas del agente (ítem 56), porque
// no hay nada que interpretar: lo que se escribe es lo que el modelo lee.
//
// LA SUCURSAL SÍ SE PUEDE CAMBIAR, y es la diferencia con AgentFormPage —donde
// el selector se muestra deshabilitado en edición. Un Agent no se mueve porque
// sus conversaciones históricas llevan el branchId denormalizado; una entrada
// de KB no tiene nada equivalente, así que mover una FAQ cargada en la
// sucursal equivocada es exactamente lo que alguien quiere poder hacer. Ver la
// nota de UpdateKnowledgeBaseEntryInput en
// src/services/knowledgeBaseEntry.service.ts.
// ---------------------------------------------------------------------------
export function KnowledgeBaseFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const entryQuery = useKnowledgeBaseEntry(isEditMode ? id : undefined);
  const createEntryMutation = useCreateKnowledgeBaseEntry();
  const updateEntryMutation = useUpdateKnowledgeBaseEntry(id ?? "");

  const [values, setValues] = useFormDraft<KnowledgeBaseFormValues>(
    entryQuery.data?.id,
    entryQuery.data ? toFormValues(entryQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [extrayendo, setExtrayendo] = useState(false);
  const [truncado, setTruncado] = useState(false);
  // El nombre que muestra el FileInputButton. Existe solo para eso: el archivo
  // en sí no se guarda en ningún estado porque no sobrevive a la extracción.
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);

  const isSubmitting = createEntryMutation.isPending || updateEntryMutation.isPending;

  // -------------------------------------------------------------------------
  // Completar el Contenido desde un archivo (ítem 60).
  //
  // El archivo se sube, el backend extrae el texto y lo devuelve; el archivo
  // no se guarda en ningún lado ni queda asociado a la entrada. Lo que llega
  // es una CARGA INICIAL del campo, no una fuente de verdad separada: apenas
  // cae en el textarea es texto común y corriente, editable, y lo que se
  // guarda al final es lo que esté ahí.
  //
  // LA CONFIRMACIÓN VA ANTES DE SUBIR, no después de recibir el texto. Subir
  // primero gastaría el request y una de las diez extracciones por minuto que
  // permite el endpoint para algo que la persona va a cancelar igual.
  // -------------------------------------------------------------------------
  async function handleArchivo(archivo: File | null) {
    // Cancelar el explorador, o cancelar la confirmación, dejan el control como
    // estaba: sin nombre a la vista, porque no se leyó ningún archivo. Limpiar
    // el value del input para poder reelegir el mismo archivo ya no es asunto
    // de esta pantalla — lo hace FileInputButton.
    if (!archivo) {
      setNombreArchivo(null);
      return;
    }

    if (values.content.trim() !== "" && !window.confirm(CONFIRMAR_PISAR_CONTENIDO)) {
      setNombreArchivo(null);
      return;
    }

    setNombreArchivo(archivo.name);
    setError(null);
    setTruncado(false);
    setExtrayendo(true);
    try {
      const { text, truncated } = await extractKnowledgeBaseText(archivo);
      setValues({ ...values, content: text });
      setTruncado(truncated);
    } catch (err) {
      // El error se muestra donde se muestran los del formulario y NO toca
      // nada de lo que ya estaba cargado: un archivo que no se pudo leer no
      // puede costarle a nadie el título ni el texto que venía escribiendo.
      // Los tres casos que llegan acá son 400 (formato o archivo roto), 413
      // (más de 5 MB) y 422 (el documento no tiene texto), cada uno con su
      // mensaje del backend.
      setError(
        err instanceof Error
          ? `No pudimos leer el archivo: ${err.message}`
          : "No pudimos leer el archivo.",
      );
      // El nombre se va con el error: lo que quedó cargado en Contenido NO
      // salió de ese archivo, y dejarlo a la vista diría lo contrario.
      setNombreArchivo(null);
    } finally {
      setExtrayendo(false);
    }
  }

  // -------------------------------------------------------------------------
  // Quitar el archivo elegido (ítem 67).
  //
  // BORRA DOS COSAS, NO UNA: el nombre a la vista y el texto que ese archivo
  // puso en Contenido. No es una limpieza visual — es deshacer la extracción
  // entera. Dejar el nombre en "Ningún archivo elegido" con el texto del
  // archivo todavía en el campo sería peor que no tener el botón: la pantalla
  // estaría diciendo que no se cargó nada.
  //
  // Y "deshacer" solo puede significar volver a vacío. La extracción REEMPLAZA
  // el contenido por completo (setValues({ ...values, content: text })), no lo
  // agrega al final, y no se guarda en ningún lado lo que hubiera antes —ya se
  // pisó, con la confirmación de CONFIRMAR_PISAR_CONTENIDO de por medio—. Que
  // no restaure el texto anterior no es un caso sin cubrir: es que ese texto
  // no existe más. Por eso el mensaje lo dice antes de que la persona
  // confirme.
  // -------------------------------------------------------------------------
  function handleQuitarArchivo() {
    if (!window.confirm(CONFIRMAR_QUITAR_ARCHIVO)) return;
    setNombreArchivo(null);
    setValues({ ...values, content: "" });
    // El aviso de recorte hablaba del texto de ESE archivo; sin el texto no
    // tiene de qué hablar.
    setTruncado(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const errorDeValidacion = validar(values);
    if (errorDeValidacion !== null) {
      setError(errorDeValidacion);
      return;
    }

    // Se mandan todos los campos, sin diferenciar cuál cambió (mismo criterio
    // que Agent, Branch y Source): "la entrada queda así" es más simple que un
    // diff, y el PATCH parcial lo acepta. Acá el payload de los dos modos es
    // idéntico —branchId incluido— justamente porque la sucursal es editable.
    const input: CreateKnowledgeBaseEntryInput = {
      // validar() ya garantizó que hay sucursal elegida.
      branchId: values.branchId ?? "",
      title: values.title.trim(),
      content: values.content.trim(),
      isActive: values.isActive,
    };

    try {
      if (isEditMode) {
        await updateEntryMutation.mutateAsync(input satisfies UpdateKnowledgeBaseEntryInput);
      } else {
        await createEntryMutation.mutateAsync(input);
      }
      navigate("/knowledge-base");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la entrada");
    }
  }

  if (isEditMode && entryQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && entryQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la entrada
        {entryQuery.error instanceof Error ? `: ${entryQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar entrada" : "Nueva entrada"}</h1>
      <div className="ds-stack">
        <Card heading="Datos de la entrada">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Título</span>}>
              <input
                type="text"
                value={values.title}
                maxLength={MAX_TITLE}
                placeholder="Horarios de atención"
                onChange={(event) => setValues({ ...values, title: event.target.value })}
                required
              />
            </FormField>

            {/* Suelto, sin FormField: BranchSelect trae su propio
                <label htmlFor> y FormField ES un <label>. Habilitado también
                en edición, a diferencia de AgentFormPage. */}
            <BranchSelect
              id="knowledge-base-form-branch"
              label="Sucursal"
              value={values.branchId}
              onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
              required
            />

            {/* Ítem 70 — esta entrada la escribió "Sincronizar stock", no una
                persona, y la próxima corrida de esa sucursal la va a volver a
                escribir. El aviso va ANTES que el resto de los hints porque
                cambia lo que significa todo lo de abajo.

                NO SE BLOQUEA LA EDICIÓN, y es una decisión: bloquearla
                obligaría a inventar qué pasa con los cuatro campos (¿se puede
                desactivar? ¿mover de sucursal?) y dejaría sin arreglar el caso
                real de un texto generado que alguien quiere corregir hoy, antes
                de la próxima sincronización. El aviso dice exactamente qué va a
                pasar; con eso alcanza para decidir. */}
            {entryQuery.data?.sourceVehicleId != null ? (
              <p className="ds-hint ds-field-grid--full">
                Esta entrada la generó la sincronización del stock a partir de una unidad. Podés
                editarla, pero la próxima vez que sincronices el stock de esa sucursal se va a
                reescribir con los datos del vehículo.
              </p>
            ) : null}

            {/* Hijo DIRECTO de .ds-field-grid, con ds-field-grid--full en el
                propio <p>: es el patrón que el ítem 58 dejó documentado — el
                margen negativo de .ds-hint está calculado contra el gap de la
                grilla, y metido adentro de otro <div> se come el aire del
                campo de arriba. */}
            <p className="ds-hint ds-field-grid--full">
              El título identifica la entrada en esta lista y encabeza su bloque cuando el agente la
              lee. Conviene una entrada por tema: horarios, formas de pago, política de cancelación.
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
              Si la desactivás, sale del prompt sin borrarse — por ejemplo, una promoción de
              temporada que después vas a querer reactivar.
            </p>
          </div>
        </Card>

        <Card heading="Contenido">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Contenido</span>}>
                <textarea
                  value={values.content}
                  rows={10}
                  maxLength={MAX_CONTENT}
                  placeholder={PLACEHOLDER_CONTENIDO}
                  onChange={(event) => setValues({ ...values, content: event.target.value })}
                  disabled={extrayendo}
                  required
                />
              </FormField>
            </div>
            <p className="ds-hint ds-field-grid--full">
              Se suma tal cual al prompt de todos los agentes de esa sucursal, sin traducción ni
              confirmación. Escribilo como se lo contarías a alguien que recién entra a trabajar.
              Hasta {MAX_CONTENT.toLocaleString("es-UY")} caracteres por entrada. Si ya lo tenés en
              un documento, podés subirlo acá abajo en vez de escribirlo.
            </p>

            {/* Suelto adentro de la misma Card que el textarea, y no en una
                Card propia: no es otro dato de la entrada, es otra forma de
                llenar el MISMO campo. El archivo no se guarda ni queda
                asociado a nada — lo único que sobrevive es el texto que cae
                en el textarea de arriba, editable como cualquier otra cosa
                que se hubiera tipeado. */}
            <div className="ds-field-grid--full">
              <FileInputButton
                label={ETIQUETA_ARCHIVO}
                accept={EXTENSIONES_ARCHIVO_SOPORTADAS.join(",")}
                disabled={extrayendo || isSubmitting}
                selectedFileName={nombreArchivo}
                onFileSelected={(archivo) => void handleArchivo(archivo)}
                onClear={handleQuitarArchivo}
              />
            </div>
            <p className="ds-hint ds-field-grid--full">
              {extrayendo
                ? "Extrayendo texto…"
                : "Se lee el texto del documento y se pega acá arriba; el archivo no se guarda. " +
                  "Un PDF escaneado (una foto del papel, sin texto seleccionable) no sirve: ese hay " +
                  "que copiarlo a mano."}
            </p>
            {truncado ? (
              <p className="ds-hint ds-field-grid--full">
                El archivo era muy largo, se cortó el texto — revisalo antes de guardar.
              </p>
            ) : null}
            {/* El maxLength del textarea frena lo que se TIPEA, no lo que se
                asigna desde el archivo: un documento de 12.000 caracteres
                entra entero y se vería bien hasta que el POST lo rechaza con
                el mensaje crudo de la API. Este aviso existe para que se vea
                antes, con el número exacto que sobra, y se pueda recortar a
                mano. El tope sigue validándose en un solo lugar de verdad —el
                backend—; acá no se corta nada. */}
            {values.content.length > MAX_CONTENT ? (
              <p className="ds-hint ds-field-grid--full">
                El texto tiene {values.content.length.toLocaleString("es-UY")} caracteres y el
                máximo por entrada es {MAX_CONTENT.toLocaleString("es-UY")}. Recortá{" "}
                {(values.content.length - MAX_CONTENT).toLocaleString("es-UY")} antes de guardar.
              </p>
            ) : null}
          </div>
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting || extrayendo}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
