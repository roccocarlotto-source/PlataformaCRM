import { randomBytes } from "node:crypto";

// Genera la clave maestra de SECRET_ENCRYPTION_KEY (src/utils/encryption.ts).
//
// Mismo espíritu que gen-signing-key.ts: una cosa que hay que generar bien una
// sola vez, con un script que la genera bien siempre, en vez de instrucciones
// que alguien sigue a mano. La diferencia con aquel es el destino — aquel
// ESCRIBE un archivo que la CLI de Supabase espera en una ruta fija; este
// IMPRIME, porque el valor va a un gestor de secretos o a un .env que este
// script no debería tocar ni conocer.
//
// 32 bytes = 256 bits, que es el largo que exige aes-256. randomBytes es el
// CSPRNG del sistema operativo: NUNCA Math.random(), NUNCA un UUID, NUNCA algo
// derivado de un nombre o de un timestamp — el mismo requisito, y por el mismo
// motivo, que el que encabeza src/utils/apiKey.ts.
//
// base64 (no base64url, no hex): es el formato que espera parseMasterKey(), y el
// que menos fricción tiene para pegar en un .env o en un gestor de secretos.
//
// LA CLAVE NO SE ROTA SOLA. Cambiarla deja ilegible todo lo ya cifrado con la
// anterior: las conexiones de Google Calendar existentes dejarían de descifrar y
// cada sucursal tendría que reconectar. Rotar de verdad exige descifrar con la
// vieja y volver a cifrar con la nueva, y hoy no hay ninguna herramienta que
// haga eso — el prefijo de versión del formato es lo que la haría posible sin
// migrar los datos de golpe.

const clave = randomBytes(32).toString("base64");

console.log(clave);
console.error(
  "\nClave maestra de 256 bits generada (base64).\n" +
    "Configurala como SECRET_ENCRYPTION_KEY en el entorno — NO la commitees.\n" +
    "Cambiarla deja ilegibles los secretos ya cifrados con la anterior.\n",
);
