import { useAuth } from "../auth/AuthContext";
import { Notice } from "../design-system/Notice";

export const AVISO_DE_MODO_DEMO =
  "Modo demo: los mensajes se simulan y no le llegan a nadie. Nada sale de la plataforma.";

// El aviso fijo de una organización en modo demo (src/services/modoDemo.service.ts,
// docs-privados/taller-demo-diseno.md §2, local): quien la usa tiene que saber
// que los WhatsApp, Messenger e Instagram que ve "enviados" no salieron. Para
// cualquier otra organización no renderiza nada.
export function AvisoDeModoDemo() {
  const { me } = useAuth();
  if (me?.isDemo !== true) return null;
  return (
    <Notice tone="info" alert={false}>
      {AVISO_DE_MODO_DEMO}
    </Notice>
  );
}
