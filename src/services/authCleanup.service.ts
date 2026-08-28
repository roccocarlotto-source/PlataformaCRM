import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";

// ---------------------------------------------------------------------------
// Purga de identidades de auth.users que nunca se confirmaron — la
// contrapartida de ALTO-2.
//
// EL RESIDUO QUE ESTO LIMPIA. `POST /api/onboarding/otp` crea la fila en
// auth.users ANTES de que nadie haya probado nada: es la única forma de emitir
// un código con @supabase/supabase-js (ver el encabezado de
// onboarding.service.ts). Quien pide un código y abandona deja esa fila sin
// confirmar para siempre. Es el costo aceptado de la opción elegida, y esto es
// lo que impide que se acumule.
//
// El squatting que ALTO-2 cerraba no vuelve por esta puerta: una identidad sin
// confirmar NO bloquea nada — `signInWithOtp` la reutiliza y le manda un código
// nuevo, así que el dueño real del email puede completar el registro sin que
// nadie limpie nada. La purga es higiene, no una defensa.
//
// ---------------------------------------------------------------------------
// EL PREDICADO, Y POR QUÉ `invited_at` NO ES OPCIONAL
// ---------------------------------------------------------------------------
//
// "Sin confirmar y vieja" NO alcanza, y la versión ingenua de este script
// borraría gente real: `inviteUserByEmail` (invitation.service.ts) crea la
// identidad del invitado con `email_confirmed_at` en null — se confirma recién
// cuando acepta. Una invitación que estuvo dos semanas sin aceptarse es
// exactamente "sin confirmar y vieja", y borrarla destruiría la identidad de
// alguien a quien un ADMIN invitó a propósito.
//
// El discriminador es `invited_at`: GoTrue lo sella únicamente en las
// identidades creadas por invitación. Las que nacen de signInWithOtp no lo
// tienen. Las cuatro condiciones se exigen juntas:
//
//   1. email_confirmed_at == null  — nunca probó el email
//   2. invited_at == null          — no nació de una invitación
//   3. created_at < corte          — no es un registro en curso
//   4. sin fila en public.users    — no tiene perfil de negocio
//
// La (4) es redundante con la (1) mientras el resto del código sea correcto —
// no debería existir un perfil de negocio de un email no confirmado— y está
// igual: es el chequeo que convierte un borrado irreversible de identidades en
// uno que no puede tocar a un usuario del CRM aunque alguna de las otras tres
// se equivoque.
// ---------------------------------------------------------------------------

// 7 días. Un registro que quedó a medias se retoma en minutos, no en días; una
// semana es holgura de sobra y deja margen para que alguien mire el --dry-run
// antes de que la fila desaparezca.
export const DIAS_DE_RETENCION_IDENTIDAD_SIN_CONFIRMAR = 7;

export function fechaDeCorteDeIdentidades(ahora: Date = new Date()): Date {
  const corte = new Date(ahora);
  corte.setUTCDate(corte.getUTCDate() - DIAS_DE_RETENCION_IDENTIDAD_SIN_CONFIRMAR);
  return corte;
}

// Solo lo que el predicado necesita. Tipo propio y no el `User` de
// @supabase/auth-js: así la función es pura, testeable sin base ni red, y no
// arrastra 40 campos que no mira.
export interface IdentidadCandidata {
  id: string;
  email?: string;
  created_at: string;
  email_confirmed_at?: string | null;
  invited_at?: string | null;
}

// Las tres condiciones que se pueden decidir sin consultar Postgres. La cuarta
// —que no haya perfil de negocio— la resuelve purgeUnconfirmedAuthUsers con una
// sola consulta para todo el lote, en vez de una por identidad.
export function esCandidataAPurga(identidad: IdentidadCandidata, corte: Date): boolean {
  if (identidad.email_confirmed_at) return false;
  if (identidad.invited_at) return false;

  const creada = new Date(identidad.created_at);
  if (Number.isNaN(creada.getTime())) {
    // Una fecha que no parsea no se borra. Un dato que no se entiende nunca es
    // motivo suficiente para una operación irreversible.
    return false;
  }

  return creada < corte;
}

export interface ResultadoDePurga {
  revisadas: number;
  candidatas: number;
  conPerfilDeNegocio: number;
  borradas: number;
  fallidas: number;
}

const POR_PAGINA = 200;

export async function purgeUnconfirmedAuthUsers(opciones: {
  dryRun: boolean;
  corte?: Date;
}): Promise<ResultadoDePurga> {
  const corte = opciones.corte ?? fechaDeCorteDeIdentidades();
  const admin = getSupabaseAdmin();

  const resultado: ResultadoDePurga = {
    revisadas: 0,
    candidatas: 0,
    conPerfilDeNegocio: 0,
    borradas: 0,
    fallidas: 0,
  };

  const candidatas: IdentidadCandidata[] = [];

  // La Admin API no filtra por estos campos, así que se pagina todo y se filtra
  // acá. Es un script de mantenimiento manual, no un camino caliente.
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });

    if (error) {
      throw new Error(`No se pudo listar auth.users (página ${String(pagina)}): ${error.message}`);
    }

    const usuarios = data.users;
    resultado.revisadas += usuarios.length;

    for (const usuario of usuarios) {
      if (esCandidataAPurga(usuario as IdentidadCandidata, corte)) {
        candidatas.push(usuario as IdentidadCandidata);
      }
    }

    if (usuarios.length < POR_PAGINA) break;
  }

  resultado.candidatas = candidatas.length;

  if (candidatas.length === 0) {
    return resultado;
  }

  // La cuarta condición, en UNA consulta para todo el lote. Se compara por id
  // —public.users.id comparte valor con auth.users.id, ver el encabezado del
  // modelo User— y no por email: el id es la clave real de la relación.
  const conPerfil = await prisma.user.findMany({
    where: { id: { in: candidatas.map((c) => c.id) } },
    select: { id: true },
  });
  const idsConPerfil = new Set(conPerfil.map((u) => u.id));
  resultado.conPerfilDeNegocio = idsConPerfil.size;

  const aBorrar = candidatas.filter((c) => !idsConPerfil.has(c.id));

  if (opciones.dryRun) {
    return resultado;
  }

  for (const identidad of aBorrar) {
    const { error } = await admin.auth.admin.deleteUser(identidad.id);
    if (error) {
      resultado.fallidas++;
      logger.error(
        { err: error, authUserId: identidad.id },
        "No se pudo borrar una identidad sin confirmar",
      );
      continue;
    }
    resultado.borradas++;
  }

  return resultado;
}
