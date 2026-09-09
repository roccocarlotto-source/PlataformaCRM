# Prompt para continuar — integración con Resea

Prompt listo para pegar en la sesión de Claude que trabaja este repo (`Plataforma CRM`). Agregado 28/08/2026 junto con `docs/integracion-resea-crm.md`.

---

Che, leé `docs/integracion-resea-crm.md` (nuevo, agregado hoy 28/08 desde una sesión de análisis cross-repo del proyecto "Sistema Saas") junto con `docs/roadmap-implementacion.md` §P1 y §2.4. Verificó contra nuestro código real dos cosas que no estaban explícitas antes:

1. `Sucursal` no existe todavía como entidad en `prisma/schema.prisma` — todo cuelga de `Organization`. Es un prerrequisito real para `BranchIntegration`, no solo la tabla de integración en sí.
2. El lado de Resea todavía no confirmó si el envío final del WhatsApp/email lo arma y manda el CRM (contrato original, `DEC-068` confirmada de su lado) o si Resea lo va a mandar directamente (una arquitectura distinta que investigaron en su Cycle 29, todavía sin decisión activa, choca con una decisión de privacidad de ellos). Hasta que confirmen, construí este lado asumiendo el contrato original: Resea entrega un link/QR, nosotros armamos y mandamos el mensaje.

Seguí el orden de `docs/roadmap-implementacion.md` §P1: si el motor de eventos salientes todavía no existe, es lo primero (lo necesita esto y también el recordatorio de turnos y cualquier automatización futura). Después, en orden: decidir/modelar `Sucursal`, la tabla `BranchIntegration` + admin, el mecanismo de API key de servicio saliente (dirección inversa al `ApiKey` de ingesta que ya tenemos — mismo patrón, código nuevo), y la acción "enviar QR" en automatizaciones.

Documentá el avance con el mismo criterio que venimos usando (bitácora en `docs/bitacora-*.md`, PR con `pr-body-*.md` + `gh pr create --body-file`, sin mergear vos).
