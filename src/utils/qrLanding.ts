// ---------------------------------------------------------------------------
// Páginas HTML públicas del módulo QR — puerto directo de
// Plataforma-QR/supabase/functions/_shared/landing.ts (Fase 2 de
// docs/qr-integration.md).
//
// Devuelven `string`; el controller hace res.status(x).type("html").send(html)
// en vez del `new Response(...)` de Deno. Mismo escapeHtml, mismo shell visual,
// mismo copy — incluida la nota de "copy provisional, pendiente de una pasada
// de Design", que se conserva a propósito: no se inventa copy nuevo acá.
//
// Landing genérica (buildLandingHtml): se muestra para cualquier QR que no
// esté activo — inexistente, borrado, o con la suscripción vencida. El cliente
// nunca ve cuál de los casos es (DEC-007 original): todos renderizan la misma
// página. Cuando se conoce un qrId válido y QR_CLAIM_APP_URL está configurada,
// lleva además el link "¿Sos el dueño...?" hacia la ruta de claim del
// frontend. Hoy esa env var no apunta a ningún lado (Fase 3): sin ella, el
// link simplemente no se renderiza — mismo comportamiento que el original con
// ADMIN_APP_URL ausente.
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildLandingHtml(opts: { qrId?: string; claimAppUrl?: string } = {}): string {
  let claimLinkHtml = "";
  if (opts.qrId && opts.claimAppUrl) {
    const claimUrl = `${opts.claimAppUrl.replace(/\/$/, "")}/claim/${encodeURIComponent(opts.qrId)}`;
    claimLinkHtml = `<p><a href="${escapeHtml(claimUrl)}">¿Sos el dueño de este negocio? Iniciá sesión para activarlo</a></p>`;
  }

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR Reviews</title>
<style>
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    text-align: center;
    padding: 24px;
  }
  main { max-width: 28rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { color: #94a3b8; line-height: 1.5; }
  a { color: #38bdf8; }
</style>
</head>
<body>
  <main>
    <h1>Este código todavía no está activo</h1>
    <p>Si sos el dueño de este negocio, contactanos para activarlo.</p>
    ${claimLinkHtml}
  </main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Páginas del QR de un solo uso (Cycle 26/27/28 del original). Copy
// explícitamente PROVISIONAL — el diseño del Cycle 27 difirió el texto final a
// una pasada de Product Design (OQ-2, todavía no hecha). Mismo shell visual
// que buildLandingHtml.
// ---------------------------------------------------------------------------

function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    text-align: center;
    padding: 24px;
  }
  main { max-width: 28rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { color: #94a3b8; line-height: 1.5; }
  button {
    font: inherit;
    background: #38bdf8;
    color: #0f172a;
    border: none;
    border-radius: 0.5rem;
    padding: 0.75rem 1.5rem;
    margin-top: 0.5rem;
    cursor: pointer;
  }
</style>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

// Sin usar y con la organización activa: la única página que ofrece el botón
// "Continuar" — un <form method="POST"> real, sin JavaScript, para que el
// consumo nunca dependa de un fetch del lado del cliente hacia un endpoint
// privilegiado (Cycle 28 §8 original). El POST llega a la misma URL
// /qr/resolve/:qrId que ya está en el link — no hay una URL/token especial.
export function buildSingleUseConfirmHtml(): string {
  return pageShell(
    "QR Reviews",
    `<h1>Dejanos tu reseña</h1>
    <p>Este código se puede usar una sola vez. Al continuar, vas a ir directo a dejar tu opinión.</p>
    <!-- copy provisional, pendiente de una pasada de Design (OQ-2, Cycle 27) -->
    <form method="POST">
      <button type="submit">Continuar</button>
    </form>`,
  );
}

// Ya usado (usedAt no nulo): única excepción deliberada a DEC-007 — el motivo
// real ("ya usado") no es información sensible del negocio, a diferencia de
// "no reclamado"/"suscripción vencida" (Cycle 26 §7 original).
export function buildSingleUseUsedHtml(): string {
  return pageShell(
    "QR Reviews",
    `<h1>Este código ya fue utilizado</h1>
    <p>Este código de un solo uso ya se usó anteriormente.</p>
    <!-- copy provisional, pendiente de una pasada de Design (OQ-2, Cycle 27) -->`,
  );
}
