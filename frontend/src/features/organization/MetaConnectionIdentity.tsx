import type { MetaPageConnection } from "./types";

// ---------------------------------------------------------------------------
// Qué página y qué Instagram están conectados, para las dos tarjetas de
// "Facebook e Instagram": la informativa de Configuración → Organización y la
// de Plataforma → Página de Facebook.
//
// Con los nombres: "AutoMax Demo · @automax.demo.uy", y los ids en chico
// debajo (sirven para cruzar con el panel de Meta). Sin los nombres —Meta no
// los mandó, o el backend no pudo completarlos para una conexión vieja—, los
// ids como antes.
// ---------------------------------------------------------------------------
type Conexion = Pick<
  MetaPageConnection,
  "pageId" | "pageName" | "instagramBusinessAccountId" | "instagramUsername"
>;

export function MetaConnectionIdentity({ conexion }: { conexion: Conexion }) {
  const { pageId, pageName, instagramBusinessAccountId, instagramUsername } = conexion;

  if (!pageName) {
    return (
      <p>
        Página: <strong>{pageId}</strong>
        {" · "}
        Instagram:{" "}
        {instagramBusinessAccountId ? (
          <strong>{instagramBusinessAccountId}</strong>
        ) : (
          "sin cuenta vinculada"
        )}
      </p>
    );
  }

  const instagram = instagramUsername ? `@${instagramUsername}` : instagramBusinessAccountId;

  return (
    <>
      <p>
        <strong>{pageName}</strong>
        {" · "}
        {instagram ? <strong>{instagram}</strong> : "sin Instagram vinculado"}
      </p>
      <p className="ds-hint">
        Página {pageId}
        {instagramBusinessAccountId ? ` · Instagram ${instagramBusinessAccountId}` : null}
      </p>
    </>
  );
}
