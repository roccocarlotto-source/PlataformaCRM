import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env";
import { AppError } from "./AppError";

// ---------------------------------------------------------------------------
// Cifrado simétrico de secretos RECUPERABLES, en reposo.
//
// GENÉRICO A PROPÓSITO — nada acá dice "Google" ni "refresh token". Hoy el único
// consumidor es GoogleCalendarConnection.refreshToken, pero esta es la clase de
// utilitario que va a necesitar cualquier otro secreto que el sistema tenga que
// guardar Y VOLVER A USAR (la API key de servicio de Resea, tokens de WhatsApp
// Business, credenciales de una base externa). Escribirlo atado al primer caso
// garantizaba escribirlo dos veces.
//
// ---------------------------------------------------------------------------
// POR QUÉ ESTE ARCHIVO EXISTE Y NO SE REUSÓ utils/apiKey.ts
// ---------------------------------------------------------------------------
//
// docs/booking-architecture.md §3/§4 pide guardar el refresh token "cifrado en
// reposo, igual criterio que ApiKey". Esa premisa es FALSA y se verificó contra
// el repo antes de escribir una línea: ApiKey no está cifrada, está HASHEADA con
// SHA-256 sin sal, irreversible a propósito. No había ningún módulo de cifrado
// en el proyecto (grep por createCipheriv/decrypt/aes-256 sobre src/, prisma/ y
// scripts/: cero coincidencias).
//
// LA DIFERENCIA NO ES DE IMPLEMENTACIÓN, ES DE PROBLEMA:
//
//   - Una API key hay que RECONOCERLA. Llega en un header, se hashea, se busca
//     la fila por igualdad. El sistema nunca necesita recuperar el valor, así
//     que la primitiva correcta es la que hace imposible recuperarlo.
//   - Un refresh token hay que RECUPERARLO. Se le manda a Google para pedir un
//     access token. Hashearlo lo volvería inútil.
//
// Cifrado y hasheo no son dos formas de "proteger un secreto": son respuestas a
// dos preguntas distintas, y elegir la de al lado rompe el caso de uso o la
// seguridad. Si algún día aparece un secreto que solo hay que reconocer, va a
// utils/apiKey.ts, no acá.
//
// ---------------------------------------------------------------------------
// QUÉ PROTEGE ESTO REALMENTE, Y QUÉ NO
// ---------------------------------------------------------------------------
//
// PROTEGE: un volcado de la base. Un backup robado, una réplica de lectura, un
// snapshot de Supabase, alguien con SELECT sobre la tabla. En todos esos casos
// la clave no viaja con los datos y el ciphertext no sirve para nada.
//
// NO PROTEGE: una máquina de aplicación comprometida. La clave vive en el
// entorno del proceso, junto a DATABASE_URL y a SUPABASE_SERVICE_ROLE_KEY —
// quien pueda leer el entorno ya tiene todo. Está escrito acá para que nadie
// lea "cifrado en reposo" como una garantía más grande de la que es.
//
// ---------------------------------------------------------------------------
// EL ALGORITMO
// ---------------------------------------------------------------------------
//
// AES-256-GCM, con node:crypto (sin dependencia nueva — mismo módulo del que ya
// sale randomBytes en utils/apiKey.ts).
//
// GCM y no CBC, y no es una preferencia: GCM es AEAD, o sea que AUTENTICA además
// de cifrar. Un ciphertext manipulado falla al descifrar en vez de devolver
// bytes distintos que parecen válidos. Con CBC habría que agregar un HMAC aparte
// y componerlo bien (encrypt-then-MAC), que es exactamente el tipo de detalle
// que se implementa mal en silencio.
//
// El IV es de 12 bytes, ALEATORIO Y NUEVO EN CADA LLAMADA. 12 y no 16 porque es
// el tamaño nativo de GCM: con otro largo, Node aplica una derivación extra
// (GHASH) y se pierde la garantía estándar. Y nuevo cada vez porque REPETIR UN
// IV CON LA MISMA CLAVE ROMPE GCM POR COMPLETO — no debilita el ciphertext, sino
// que expone la clave de autenticación y permite falsificar tags. Es el único
// error verdaderamente fatal de este archivo, y por eso el IV nunca se pasa por
// parámetro ni se deriva de nada: sale de randomBytes, siempre.
// ---------------------------------------------------------------------------

const ALGORITMO = "aes-256-gcm";

// 32 bytes = 256 bits. Es el largo que exige aes-256, no una preferencia.
export const MASTER_KEY_BYTES = 32;

// 12 bytes = el tamaño nativo del nonce de GCM. Ver arriba.
const IV_BYTES = 12;

// 16 bytes = el tag de autenticación completo de GCM. Truncarlo es una opción
// del estándar y acá no se usa: no ahorra nada medible y debilita la
// autenticación.
const AUTH_TAG_BYTES = 16;

// Etiqueta de versión del formato, para que rotar el esquema no exija una
// migración de datos: el día que haya un "v2", decrypt sigue entendiendo las
// filas viejas mirando este prefijo. Sin él, cambiar cualquier cosa del formato
// deja ilegible todo lo ya guardado.
const VERSION = "v1";

// El separador es "." porque base64url no lo produce nunca (su alfabeto es
// A-Z a-z 0-9 - _), así que partir por "." no puede cortar en medio de un campo.
const SEPARADOR = ".";

// ---------------------------------------------------------------------------
// Derivación de subclaves (HKDF-SHA256)
//
// POR QUÉ EXISTE: el proyecto tiene UNA clave maestra en el entorno y más de un
// uso criptográfico que la necesita — cifrar secretos (acá) y firmar el `state`
// de OAuth (utils/oauthState.ts). Usar la misma clave cruda para AES-GCM y para
// HMAC es la clase de reutilización que las dos primitivas no prometen resistir,
// y la respuesta estándar es derivar una subclave por propósito.
//
// La alternativa era una segunda variable de entorno. Se eligió derivar porque
// no agrega una cosa más que alguien tiene que generar y configurar bien, y
// porque el aislamiento que da es el mismo: sin la maestra no se obtiene
// ninguna, y con dos `info` distintos las subclaves son independientes entre sí.
//
// SIN SALT (cadena vacía): HKDF lo admite explícitamente, y su función es
// aportar entropía cuando el material de entrada NO es uniformemente aleatorio
// (una contraseña, un secreto compartido de Diffie-Hellman). Acá la entrada son
// 32 bytes de un CSPRNG, que ya es uniforme. Un salt fijo hardcodeado no
// agregaría nada; uno variable habría que guardarlo, y entonces la clave sola ya
// no alcanzaría para descifrar.
// ---------------------------------------------------------------------------
export function deriveKey(masterKey: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, new Uint8Array(0), info, MASTER_KEY_BYTES));
}

// El `info` de esta subclave. Cambiarlo deja ilegible todo lo ya cifrado — es
// parte del formato, no una etiqueta decorativa.
const INFO_CIFRADO = "plataforma-crm:secret-encryption:v1";

// ---------------------------------------------------------------------------
// Validación de la clave maestra
// ---------------------------------------------------------------------------

// Traduce el valor de entorno (base64) a los 32 bytes que exige aes-256, y falla
// ruidoso si no lo es. El error es explícito sobre CUÁNTOS bytes llegaron: el
// modo de fallo probable es pegar una clave de otro largo o con espacios, y un
// "clave inválida" a secas obligaría a adivinar cuál de los dos fue.
export function parseMasterKey(valor: string): Buffer {
  let bytes: Buffer;

  try {
    bytes = Buffer.from(valor, "base64");
  } catch {
    // isOperational: false en todos los AppError de este archivo que van a
    // 500: nombran variables de entorno, comandos internos o el formato del
    // esquema de cifrado —versión, largos de IV y authTag—, información sin
    // valor para un cliente legítimo y con valor para quien intente entender
    // cómo está armado el cifrado. El mensaje sigue en el log (M-11 b).
    throw new AppError("SECRET_ENCRYPTION_KEY no es base64 válido", 500, false);
  }

  if (bytes.length !== MASTER_KEY_BYTES) {
    throw new AppError(
      `SECRET_ENCRYPTION_KEY debe ser de ${MASTER_KEY_BYTES} bytes en base64 y es de ${bytes.length}. Generá una con: npm run gen:encryption-key`,
      500,
      false,
    );
  }

  // Una clave de solo ceros es lo que sale de un default mal puesto o de un
  // secreto vacío rellenado por un pipeline. Es criptográficamente válida y por
  // eso ningún chequeo de largo la ve — el único momento en que se puede
  // rechazar es acá.
  if (timingSafeEqual(bytes, Buffer.alloc(MASTER_KEY_BYTES))) {
    throw new AppError(
      "SECRET_ENCRYPTION_KEY es una clave de solo ceros — eso no es una clave. Generá una con: npm run gen:encryption-key",
      500,
      false,
    );
  }

  return bytes;
}

// ---------------------------------------------------------------------------
// El cifrador
//
// FACTORY + SINGLETON PEREZOSO, el patrón que ya usan rateLimit.ts y
// outboxHandlers.ts: producción usa el singleton, los tests construyen el suyo
// con una clave propia y quedan aislados sin depender del entorno ni de estado
// global. Es además lo que permite que encryption.test.ts sea un test UNITARIO
// de verdad — sin variables de entorno, sin base, sin red.
// ---------------------------------------------------------------------------

export interface Cifrador {
  // Devuelve "v1.<iv>.<authTag>.<ciphertext>", todo en base64url.
  encrypt(textoPlano: string): string;
  // Inversa. Lanza si el formato no es el esperado, si la clave no es la que
  // cifró, o si algún byte fue manipulado.
  decrypt(guardado: string): string;
}

export function crearCifrador(masterKey: Buffer): Cifrador {
  const clave = deriveKey(masterKey, INFO_CIFRADO);

  return {
    encrypt(textoPlano) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITMO, clave, iv);
      const ciphertext = Buffer.concat([cipher.update(textoPlano, "utf8"), cipher.final()]);

      return [
        VERSION,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(SEPARADOR);
    },

    decrypt(guardado) {
      const partes = guardado.split(SEPARADOR);

      if (partes.length !== 4) {
        throw new AppError("Secreto cifrado con formato inválido", 500, false);
      }

      const [version, ivB64, tagB64, ciphertextB64] = partes;

      if (version !== VERSION) {
        // No es lo mismo que "formato inválido": esto es una fila escrita por
        // una versión del formato que este código no conoce, y el mensaje tiene
        // que decirlo para que no se lea como corrupción.
        throw new AppError(`Secreto cifrado con una versión desconocida: ${version}`, 500, false);
      }

      const iv = Buffer.from(ivB64, "base64url");
      const authTag = Buffer.from(tagB64, "base64url");

      // Los largos se validan ANTES de construir el decipher: Node lanza un
      // Error crudo (no un AppError) si el IV o el tag tienen un largo que no
      // acepta, y ese error terminaría en errorHandler como un 500 sin mensaje
      // útil. Chequearlo acá convierte un fallo opaco en uno que dice qué pasó.
      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
        throw new AppError("Secreto cifrado con formato inválido", 500, false);
      }

      const decipher = createDecipheriv(ALGORITMO, clave, iv);
      decipher.setAuthTag(authTag);

      try {
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertextB64, "base64url")),
          // Acá es donde GCM verifica el tag. Si el ciphertext fue manipulado, o
          // la clave no es la que cifró, esto LANZA en vez de devolver bytes
          // plausibles — que es todo el motivo por el que se eligió GCM.
          decipher.final(),
        ]).toString("utf8");
      } catch {
        // El error de Node se descarta a propósito: no dice nada accionable
        // ("Unsupported state or unable to authenticate data") y adjuntarlo solo
        // arrastraría detalles del criptosistema a un log.
        throw new AppError(
          "No se pudo descifrar el secreto: fue manipulado, o SECRET_ENCRYPTION_KEY no es la clave con la que se cifró",
          500,
        );
      }
    },
  };
}

// El que usa producción. PEREZOSO y no construido al importar, por el mismo
// motivo que getJwks() en lib/jwt.ts: SECRET_ENCRYPTION_KEY es opcional en
// config/env.ts, así que el servidor tiene que poder arrancar (y /health
// responder) sin ella. Falla recién cuando alguien intenta cifrar de verdad, con
// un mensaje que dice qué falta.
let cifrador: Cifrador | undefined;

export function getCifrador(): Cifrador {
  if (cifrador) {
    return cifrador;
  }

  if (!env.SECRET_ENCRYPTION_KEY) {
    throw new AppError(
      "SECRET_ENCRYPTION_KEY no está configurada en el servidor: sin ella no se pueden guardar ni leer secretos cifrados",
      500,
    );
  }

  cifrador = crearCifrador(parseMasterKey(env.SECRET_ENCRYPTION_KEY));

  return cifrador;
}

// Solo para tests: descarta el singleton memoizado. Sin esto, un test que
// configura la variable de entorno después de que otro ya llamó a getCifrador()
// recibiría el cifrador de aquél.
export function resetCifradorParaTests(): void {
  cifrador = undefined;
}
