import { useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { CopyButton } from "../../design-system/CopyButton";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Table } from "../../design-system/Table";
import { useFormDraft } from "../../lib/useFormDraft";
import { estadoDeToken } from "./embedToken.types";
import { useCreateEmbedToken, useRevokeEmbedToken, useUpdateAgent } from "./mutations";
import { ORIGEN_MAX_LENGTH, ORIGENES_MAX_ITEMS, validarOrigen } from "./origin";
import { useAgent, useEmbedTokens } from "./queries";

// Lo que va en `data-embed-token` cuando NO hay un token en claro disponible
// —es decir, casi siempre que se vuelve a esta pantalla—. Es deliberadamente
// imposible de confundir con un token real y de pegar sin darse cuenta: el
// widget con este valor falla con un 401 claro, no con un chat que parece
// andar. NUNCA se pone acá el `tokenPrefix` de la tabla: es un fragmento, no
// sirve para autenticar, y mostrarlo en el lugar del token sugeriría que sí.
const PLACEHOLDER_TOKEN = "PEGÁ_ACÁ_TU_TOKEN";

// El nombre del archivo que emite el build del widget
// (frontend/vite.widget.config.ts, en modo lib, SIN hash en el nombre a
// propósito: el snippet que un negocio pega en su sitio es texto estático que
// no se regenera solo).
const WIDGET_FILENAME = "/widget.js";

function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString();
}

// ---------------------------------------------------------------------------
// "Instalar en un sitio": la pantalla que arma el <script> del widget del
// canal Web de UN agente, con sus dominios permitidos y sus tokens de embed
// (ítem 63 de docs/frontend-cambios-pendientes.md).
//
// ES EL PUNTO 10 DE LA NOTA DEL 13/09/2026 de docs/ai-agent-architecture.md
// §9, que dejó esto explícitamente pendiente: en ese momento el módulo de
// Agentes no tenía NINGUNA UI de administración, y una pantalla que generara
// el snippet sin el resto habría sido una pantalla huérfana. Con el ítem 55 ya
// existen AgentListPage/AgentFormPage, así que este es exactamente el trabajo
// que esa nota difirió. Cero backend nuevo: las tres rutas que consume
// (PATCH /agents/:id, GET/POST/DELETE /agents/:id/embed-tokens) están
// construidas desde el paso 5a.
//
// LOS TRES PASOS ESTÁN EN EL ORDEN EN QUE HAY QUE HACERLOS, y no es
// decorativo: sin dominio el widget no carga en ningún lado (el CORS del 5b es
// fail-closed) y sin token no autentica, así que el snippet —el paso 3— es lo
// único que se pega en el sitio del cliente y lo último que tiene sentido
// copiar.
//
// EL TOKEN EN CLARO VIVE EN UN SOLO LUGAR: `tokenEnClaro`, estado de React de
// esta pantalla. No está en el listado (la API no lo devuelve nunca más), no
// se persiste, y tampoco queda en el MutationCache: apenas el POST responde se
// copia al estado y se llama a `reset()` sobre la mutación (ver más abajo).
// Al navegar afuera o generar otro token, se pierde — que es exactamente la
// garantía que da el backend, donde solo vive el hash. La pantalla no finge
// que se puede recuperar después.
//
// TODA LA PANTALLA ES ADMIN-ONLY (vive dentro de <AdminRoute />, ver
// app/router.tsx): las tres rutas de tokens son authorize("ADMIN") —la
// LECTURA incluida, porque quién tiene tokens y cuándo se usaron es
// información de administración— y el PATCH del agente también. Por eso no
// hay ningún gate `isAdmin` acá adentro: sería una condición que nunca
// evalúa a false, mismo criterio que AgentListPage.
// ---------------------------------------------------------------------------
export function AgentEmbedPage() {
  const { id } = useParams<{ id: string }>();
  const agentId = id ?? "";

  const agentQuery = useAgent(id);
  const tokensQuery = useEmbedTokens(id);
  const updateAgentMutation = useUpdateAgent(agentId);
  const createTokenMutation = useCreateEmbedToken(agentId);
  const revokeTokenMutation = useRevokeEmbedToken(agentId);

  // La lista editable se DERIVA del agente mientras nadie la tocó, igual que
  // cualquier formulario del proyecto: un refetch (refetchOnWindowFocus está
  // prendido) no puede pisar dominios recién agregados y todavía sin guardar.
  const [origenes, setOrigenes] = useFormDraft<string[]>(
    agentQuery.data?.id,
    agentQuery.data?.allowedOrigins ?? [],
  );
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [tokenEnClaro, setTokenEnClaro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cambiar la lista invalida el "Guardado" de la última vez: dejarlo en
  // pantalla mientras hay ediciones sin guardar sería el cartel mintiendo.
  function cambiarOrigenes(nuevos: string[]) {
    setOrigenes(nuevos);
    updateAgentMutation.reset();
  }

  function agregar() {
    const resultado = validarOrigen(draft, origenes);
    if (!resultado.ok) {
      setAddError(resultado.error);
      return;
    }
    cambiarOrigenes([...origenes, resultado.origen]);
    // Vacío y con el foco puesto para cargar el siguiente sin volver a hacer
    // click — mismo detalle que EquipmentField.
    setDraft("");
    setAddError(null);
    inputRef.current?.focus();
  }

  function quitar(origen: string) {
    cambiarOrigenes(origenes.filter((item) => item !== origen));
    setAddError(null);
  }

  // Enter agrega, no envía nada: esta pantalla no tiene <form>, pero el gesto
  // es el que espera cualquiera que esté cargando una lista.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      agregar();
    }
  }

  // Se manda la lista ENTERA, no un diff: es el mismo criterio "se manda cómo
  // queda" del resto de los formularios. El PATCH lleva SOLO allowedOrigins
  // —updateAgentSchema es .partial()— así que esta pantalla no puede pisar sin
  // querer nada de lo que configura AgentFormPage.
  function handleGuardarDominios() {
    updateAgentMutation.mutate({ allowedOrigins: origenes });
  }

  async function handleGenerarToken() {
    try {
      const creado = await createTokenMutation.mutateAsync();
      setTokenEnClaro(creado.token);
      // EL reset() NO ES OPCIONAL, y va acá y no al cerrar un cuadro (como en
      // ApiKeyListPage) porque esta pantalla no tiene nada que cerrar: el
      // token queda a la vista mientras dure la visita. useMutation guarda su
      // resultado en el MutationCache como `.data`, con el token adentro; con
      // el valor ya copiado al estado de React, borrarlo en el acto deja una
      // sola copia en memoria en vez de dos.
      createTokenMutation.reset();
    } catch {
      // El error queda en createTokenMutation.isError y se muestra abajo. El
      // catch existe para que la promesa rechazada no quede sin manejar.
    }
  }

  function handleRevocar(tokenId: string) {
    if (
      !window.confirm(
        "¿Revocar este token? El widget que lo esté usando deja de responder de inmediato y hay que pegar el código de nuevo con un token nuevo.",
      )
    ) {
      return;
    }
    revokeTokenMutation.mutate(tokenId);
  }

  if (agentQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (agentQuery.isError || !agentQuery.data) {
    return (
      <ErrorState>
        No pudimos cargar el agente
        {agentQuery.error instanceof Error ? `: ${agentQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  const agent = agentQuery.data;

  // La advertencia del paso 3 mira los dominios GUARDADOS, no el borrador de
  // arriba: lo que decide si el widget carga es lo que está en la base, así
  // que agregar un dominio sin apretar Guardar no puede apagar el aviso.
  const sinDominiosGuardados = agent.allowedOrigins.length === 0;
  const tokens = tokensQuery.data?.data ?? [];

  // EL ORIGEN DEL src SE CALCULA, NO SE HARDCODEA: el widget se sirve del
  // MISMO deploy que esta SPA (el segundo build de Vite escribe widget.js en
  // el mismo dist/), así que el origen desde el que se está viendo el CRM
  // ahora mismo es por construcción el correcto — en producción y en local.
  // Un dominio de Vercel escrito a mano acá sería una constante que se
  // desactualiza sola el día que cambie el dominio.
  const snippet = [
    "<script",
    `  src="${window.location.origin}${WIDGET_FILENAME}"`,
    `  data-agent-id="${agent.id}"`,
    `  data-embed-token="${tokenEnClaro ?? PLACEHOLDER_TOKEN}"`,
    "  async",
    "></script>",
  ].join("\n");

  return (
    <div className="ds-form">
      <h1>Instalar el widget en un sitio</h1>
      <p className="ds-hint">
        Agente: <strong>{agent.name}</strong>. <Link to="/agents">Volver a Agentes</Link>
      </p>

      <div className="ds-stack">
        <Card heading="1. Dominios permitidos">
          <p className="ds-hint">
            El widget solo se puede usar desde estos dominios. Es a propósito: un token filtrado no
            sirve de nada si el sitio donde se pega no está en la lista.
          </p>

          {origenes.length > 0 ? (
            <ul className="ds-chip-list" aria-label="Dominios permitidos">
              {origenes.map((origen) => (
                <li key={origen}>
                  <Badge variant="neutral">
                    {origen}
                    <button
                      type="button"
                      className="ds-chip-remove"
                      aria-label={`Quitar ${origen}`}
                      onClick={() => quitar(origen)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            // NO es un vacío neutro: es el estado en el que el widget está
            // apagado, y la pantalla lo dice para que nadie lo lea como un
            // dato que falta cargar por olvido.
            <EmptyState>
              El widget no va a funcionar en ningún sitio hasta que agregues al menos un dominio.
            </EmptyState>
          )}

          <div className="ds-chip-add">
            <label className="ds-sr-only" htmlFor="agent-embed-origin">
              Dominio nuevo
            </label>
            <input
              id="agent-embed-origin"
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={ORIGEN_MAX_LENGTH}
              placeholder="https://ejemplo.com"
              disabled={origenes.length >= ORIGENES_MAX_ITEMS}
              onChange={(event) => {
                setDraft(event.target.value);
                if (addError !== null) setAddError(null);
              }}
              onKeyDown={handleKeyDown}
            />
            <Button onClick={agregar} disabled={origenes.length >= ORIGENES_MAX_ITEMS}>
              Agregar
            </Button>
          </div>

          {addError !== null ? (
            <p role="alert" className="ds-error">
              {addError}
            </p>
          ) : null}

          <p className="ds-hint">
            Solo el dominio, sin ninguna ruta después: <code>https://tusitio.com</code>, no{" "}
            <code>https://tusitio.com/contacto</code>. Si el sitio usa un subdominio (
            <code>https://www.tusitio.com</code>), agregalo también: para el navegador son dos
            orígenes distintos.
          </p>

          <Button
            variant="primary"
            onClick={handleGuardarDominios}
            disabled={updateAgentMutation.isPending}
            loading={updateAgentMutation.isPending}
          >
            {updateAgentMutation.isPending ? "Guardando…" : "Guardar dominios"}
          </Button>

          {updateAgentMutation.isSuccess ? <p role="status">Dominios guardados.</p> : null}

          {updateAgentMutation.isError ? (
            <ErrorState>
              No pudimos guardar los dominios
              {updateAgentMutation.error instanceof Error
                ? `: ${updateAgentMutation.error.message}`
                : "."}
            </ErrorState>
          ) : null}
        </Card>

        <Card heading="2. Tokens de embed">
          <p className="ds-hint">
            El token identifica a este agente en el código que se pega en el sitio. Se muestra una
            sola vez, al generarlo: después solo queda su prefijo, para saber cuál es cuál.
          </p>

          <Button
            variant="primary"
            onClick={() => void handleGenerarToken()}
            disabled={createTokenMutation.isPending}
            loading={createTokenMutation.isPending}
          >
            {createTokenMutation.isPending ? "Generando…" : "Generar token nuevo"}
          </Button>

          {createTokenMutation.isError ? (
            <ErrorState>
              No pudimos generar el token
              {createTokenMutation.error instanceof Error
                ? `: ${createTokenMutation.error.message}`
                : "."}
            </ErrorState>
          ) : null}

          {tokenEnClaro !== null ? (
            <div>
              <p role="alert" className="ds-error">
                Esta es la única vez que vas a poder ver este token. No se guarda en ningún lado: si
                lo perdés, hay que revocarlo y generar otro. El código del paso 3 ya lo tiene
                puesto.
              </p>
              <label className="ds-field">
                <span className="ds-field-label">Token</span>
                {/* readOnly y no disabled: un input deshabilitado no se puede
                    seleccionar, y seleccionar a mano es el respaldo cuando el
                    portapapeles no está disponible. */}
                <input
                  type="text"
                  className="ds-secret"
                  value={tokenEnClaro}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <CopyButton text={tokenEnClaro} />
            </div>
          ) : null}

          {tokensQuery.isLoading ? <LoadingState variant="rows" /> : null}

          {tokensQuery.isError ? (
            <ErrorState>
              No pudimos cargar los tokens
              {tokensQuery.error instanceof Error ? `: ${tokensQuery.error.message}` : "."}
            </ErrorState>
          ) : null}

          {/* El 409 de "ya fue revocado" es una carrera real (otra pestaña,
              otro ADMIN, o el borrado del agente que revoca en cascada), no un
              fallo del sistema: se muestra con el mensaje del backend tal cual
              —"Este token ya fue revocado"— y la lista se refresca sola
              (onSettled en useRevokeEmbedToken), así que la tabla de abajo
              termina coincidiendo con lo que dice el cartel. */}
          {revokeTokenMutation.isError ? (
            <ErrorState>
              No pudimos revocar el token
              {revokeTokenMutation.error instanceof Error
                ? `: ${revokeTokenMutation.error.message}`
                : "."}
            </ErrorState>
          ) : null}

          {tokensQuery.isSuccess && tokens.length === 0 ? (
            <EmptyState>Este agente todavía no tiene ningún token.</EmptyState>
          ) : null}

          {tokens.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <th>Prefijo</th>
                  <th>Estado</th>
                  <th>Último uso</th>
                  <th>Creado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const activo = estadoDeToken(token) === "ACTIVE";
                  return (
                    <tr key={token.id}>
                      <td className="ds-cell-primary">
                        {/* El PREFIJO, no el token: los primeros caracteres
                            alcanzan para saber cuál se está por revocar y no
                            sirven para autenticar. */}
                        <code className="ds-secret">{token.tokenPrefix}…</code>
                      </td>
                      <td>
                        <Badge variant={activo ? "success" : "neutral"}>
                          {activo ? "Activo" : "Revocado"}
                        </Badge>
                        {token.revokedAt !== null ? (
                          <div className="ds-cell-muted">{formatFechaHora(token.revokedAt)}</div>
                        ) : null}
                      </td>
                      <td className="ds-cell-muted">
                        {token.lastUsedAt !== null ? formatFechaHora(token.lastUsedAt) : "Nunca"}
                      </td>
                      <td className="ds-cell-muted">{formatFechaHora(token.createdAt)}</td>
                      <td>
                        {/* Un token revocado no ofrece revocar de nuevo: el
                            backend responde 409 y ofrecer una acción que solo
                            puede fallar es peor que no ofrecerla. Mismo
                            criterio que ApiKeyListPage. */}
                        {activo ? (
                          <Button
                            variant="danger"
                            onClick={() => handleRevocar(token.id)}
                            disabled={revokeTokenMutation.isPending}
                            loading={
                              revokeTokenMutation.isPending &&
                              revokeTokenMutation.variables === token.id
                            }
                          >
                            Revocar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : null}
        </Card>

        <Card heading="3. Código para instalar en el sitio">
          {sinDominiosGuardados ? (
            // Sin role="alert": está desde que la pantalla carga y se va
            // cuando se guarda el primer dominio, así que nunca IRRUMPE — un
            // lector de pantalla lo lee al llegar, en su orden. El alert
            // queda para lo que sí aparece de golpe (el token recién
            // generado, los errores).
            <p className="ds-error">
              Este código todavía no va a funcionar: falta agregar al menos un dominio en el paso 1
              y guardarlo.
            </p>
          ) : null}

          {tokenEnClaro === null ? (
            <p className="ds-hint">
              El código lleva un marcador en lugar del token porque un token solo se puede ver en el
              momento de generarlo. Generá uno nuevo en el paso 2 y el código de abajo se completa
              solo, o reemplazá <code>{PLACEHOLDER_TOKEN}</code> a mano por el que tengas guardado.
            </p>
          ) : null}

          <pre className="ds-code-field ds-json-preview">{snippet}</pre>

          <CopyButton text={snippet} label="Copiar código" />

          <p className="ds-hint">
            Va pegado antes de <code>&lt;/body&gt;</code> en todas las páginas donde tenga que
            aparecer el chat.
          </p>
        </Card>
      </div>
    </div>
  );
}
