// ---------------------------------------------------------------------------
// Página HTML pública del módulo QR — puerto directo de
// Plataforma-QR/supabase/functions/_shared/landing.ts (Fase 2 de
// docs/qr-integration.md).
//
// Devuelve `string`; el controller hace res.status(x).type("html").send(html)
// en vez del `new Response(...)` de Deno. Mismo shell visual, mismo copy.
//
// Landing genérica (buildLandingHtml): se muestra para cualquier QR que no
// esté activo — inexistente, borrado, o con la suscripción vencida. El
// cliente nunca ve cuál de los casos es (DEC-007 original): todos renderizan
// la misma página.
//
// HASTA 20260904120000_remove_qr_claim_and_single_use esta función además
// tomaba un qrId/claimAppUrl opcionales para armar el link "¿Sos el
// dueño...?" hacia el claim de un QR físico, y este archivo tenía
// buildSingleUseConfirmHtml/buildSingleUseUsedHtml para el QR de un solo uso.
// Los tres se eliminaron junto con esas funcionalidades — ver
// docs/qr-integration.md, sección "Qué se desvió".
// ---------------------------------------------------------------------------

export function buildLandingHtml(): string {
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
</style>
</head>
<body>
  <main>
    <h1>Este código todavía no está activo</h1>
    <p>Si sos el dueño de este negocio, contactanos para activarlo.</p>
  </main>
</body>
</html>`;
}
