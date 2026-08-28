# Clasificación de datos personales

Inventario de los datos personales que maneja la Plataforma CRM, su
clasificación según `STD-LEG-002` (Data Privacy), por dónde salen del
servidor y qué los protege hoy.

Este documento define decisiones, no implementación. Ante una duda no
cubierta acá, plantearla antes de resolverla por defecto.

Existe porque dos rondas de review lo pidieron y ninguna lo encontró:
`D-1` de `docs/review-ingesta-2026-08-27.md` y `D2-1` de
`docs/review-fase2-2026-08-28.md`. El estándar es explícito en que la
clasificación es el **paso previo** a todo lo demás — sin ella, las
decisiones de retención, de control de acceso y de borrado se toman a
ojo. Las tres se venían tomando a ojo.

Su alcance es **el proyecto entero**, no la capa de ingesta. La ingesta
es donde el problema se hizo visible, pero `Contact` ya guardaba nombre,
email y teléfono mucho antes de que existiera un `IngestionEvent`.

---

## 1. Las cuatro categorías

Copiadas de `STD-LEG-002`, no reformuladas:

| Clase | Definición | Manejo que exige |
|---|---|---|
| **Public** | Destinado a distribución sin restricción | Ninguna |
| **Internal** | Uso organizacional; no para distribución externa | Control de acceso; nada afuera sin autorización |
| **Sensitive** | Datos personales; datos cuya divulgación causaría daño | Cifrado en reposo y en tránsito, **registro de accesos**, control de acceso estricto |
| **Regulated** | Sujeto a protección legal (salud, financiero, biométrico, datos de menores) | Todo lo de Sensitive más los requisitos de la jurisdicción |

**Los datos personales de un lead son Regulated desde el 2026-08-28**,
cuando se respondió `Q-1` (§6.1): hay —o no se puede descartar que
haya— titulares residentes de la Unión Europea, así que `STD-LEG-001`
(GDPR) pasa de Conditional a **Mandatory**.

Conviene ser preciso sobre por qué encajan en esa clase, porque los
ejemplos entre paréntesis de la tabla podrían sugerir lo contrario.
**No** entran por su naturaleza: siguen sin existir campos de salud,
biométricos ni de menores en el esquema, y `Opportunity.amount` sigue
siendo un importe comercial entre empresas y no un dato financiero de
una persona física. Entran por lo primero de la definición —*"sujeto a
protección legal"*— y sobre todo por la columna de manejo, que es la que
tiene consecuencias: *"todo lo de Sensitive más los requisitos de la
jurisdicción"*. Eso es exactamente lo que GDPR agrega.

**Por qué se reclasifica todo el conjunto y no una parte.** El esquema
no tiene ningún campo que registre el país ni la residencia de un lead
(revisado modelo por modelo en §2), así que "los leads de la UE" no es
un subconjunto que el sistema pueda distinguir. Segmentar exigiría un
dato que nadie recolecta. La única lectura consistente con el criterio
conservador que este documento aplica en todos lados es tratar el
conjunto entero como Regulated.

Lo que sí sigue valiendo del párrafo anterior: que un `fieldMapping`
empiece a mapear un campo de salud, o que el CRM se use para vender a
consumidores finales con datos de pago, agregaría obligaciones
**además** de las de GDPR. Las dos cosas se verían primero en
`rawPayload`, que es texto libre por diseño.

---

## 2. Inventario por modelo

Recorrido completo de `prisma/schema.prisma`, no solo de lo que miraron
los reviews. Se omiten `id`, `organizationId`, `createdAt`, `updatedAt`
y `deletedAt` cuando no agregan nada: son identificadores y marcas de
tiempo **Internal** en todos los modelos.

### 2.1 Personas usuarias de la plataforma

| Modelo · campo | Clase | Nota |
|---|---|---|
| `User.email` | **Sensitive** | Dato personal de una persona identificada. Único global |
| `User.fullName` | **Sensitive** | |
| `User.lastLoginAt` | **Internal** | Dato de comportamiento; junto al resto identifica actividad de una persona |
| `User.id` | **Internal** | Es el `sub` del JWT de Supabase — identificador directo de la persona, pero no revela nada por sí solo |
| `Invitation.email` | **Sensitive** | Email de alguien que **todavía no es usuario**: dato personal de un tercero |

**Estos cuatro NO se reclasificaron a Regulated al cerrar `Q-1`, y es
deliberado.** La pregunta que se respondió fue sobre la jurisdicción de
los **leads** —las personas cuyos datos entran por la capa de ingesta—,
no sobre la de las personas que usan la plataforma, que son el personal
de las organizaciones cliente. Es una pregunta distinta y **nadie la
hizo todavía**: si ese personal incluye residentes de la UE, estos
campos suben igual. Queda anotado acá en vez de decidirse por analogía,
porque la respuesta de una no es evidencia de la otra.

### 2.2 Leads y contactos — el núcleo del problema

| Modelo · campo | Clase | Nota |
|---|---|---|
| `Contact.firstName`, `Contact.lastName` | **Regulated** | `NOT NULL`. Identifican a una persona física |
| `Contact.email` | **Regulated** | Único parcial por organización sobre `lower(email)` |
| `Contact.phone` | **Regulated** | |
| `Contact.jobTitle` | **Regulated** | Menos identificatorio por sí solo, pero es un atributo de la persona y viaja siempre junto a su nombre |
| `Contact.source` | **Internal** | Texto libre de hasta 100; hoy lo escribe la ingesta con el nombre de la `Source` |
| `Contact.lifecycleStage` | **Internal** | |

Los cuatro primeros eran **Sensitive** hasta el cierre de `Q-1` (§6.1).
Subieron de clase por la jurisdicción, no porque cambiara el dato ni el
código: son los datos personales de un lead, y no hay forma de saber
cuáles de esos leads son residentes de la UE.

### 2.3 La capa de ingesta

| Modelo · campo | Clase | Nota |
|---|---|---|
| `IngestionEvent.rawPayload` | **Regulated** | `NOT NULL`, JSONB, **contenido arbitrario**: es la fila cruda del formulario o de la planilla. Es el dato personal menos acotado del sistema — nada valida qué trae |
| `IngestionEvent.promotionNotes` | **Regulated** | **No es un identificador.** `NotaConflicto` guarda `crm` y `entrante`, o sea los **valores** de `firstName`, `lastName`, `phone` y `jobTitle` del lead que se descartaron. Es dato personal del titular igual que `rawPayload`, así que sube con él |
| `IngestionEvent.errorMessage` | **Internal declarado; Regulated si alguna vez transporta un valor** | Desde `D2-7` hay tests que fijan que ningún mensaje de validación haga eco del valor recibido. Lo que la clase dice es qué pasa si esa garantía se rompe, no qué es hoy |
| `IngestionEvent.externalId` | **Internal si es derivado, Regulated si es provisto** | El derivado es un SHA-256 del payload canónico y no revela nada. El provisto llega por `X-External-Id` y una fuente puede mandar ahí el email del lead |
| `ApiKey.keyHash`, `ApiKey.keyPrefix` | **Sensitive** (credencial) | No es dato personal: entra por la segunda mitad de la definición, _"datos cuya divulgación causaría daño"_. El secreto en claro **nunca se persiste** — solo el hash |
| `Source.name`, `Source.fieldMapping` | **Internal** | El mapeo nombra columnas de un archivo, no contiene valores |

### 2.4 Datos de empresas y de negocio

| Modelo · campo | Clase | Nota |
|---|---|---|
| `Company.name`, `.domain`, `.industry`, `.city`, `.country` | **Internal** | Datos de una persona jurídica, no de una física |
| `Company.phone` | **Internal**, con borde | Un conmutador es dato de empresa; en una empresa unipersonal es el teléfono de una persona. Se clasifica Internal y se deja el borde escrito en vez de fingir que no existe |
| `Opportunity.amount`, `.currency`, `.status` | **Internal** | |
| `Organization.*`, `Role.*` | **Internal** | Datos del tenant y catálogo de roles |

### 2.5 Texto libre — la categoría incómoda

| Modelo · campo | Clase | Nota |
|---|---|---|
| `Activity.subject` | **Internal por diseño, Regulated por contenido** | `VarChar(255)` escrito por una persona sobre un contacto |
| `Activity.body` | **Internal por diseño, Regulated por contenido** | Texto **sin límite de longitud**. Es el campo más grande y menos controlado del esquema fuera de `rawPayload` |
| `Opportunity.title`, `Opportunity.lostReason` | **Internal por diseño, Regulated por contenido** | |

La mitad "por contenido" sube con el resto al cerrar `Q-1`: si lo que
alguien escribió ahí es el nombre de un lead, es el mismo dato de la
misma persona, guardado en otra columna. La mitad "por diseño" no
cambia — un campo de notas no es un campo de datos personales, y esa es
justamente la razón por la que el problema es difícil.

**Por qué no se resuelve clasificándolos Sensitive y listo.** Tratar todo
texto libre como Sensitive obligaría a loguear cada lectura de cada
actividad, que es la mitad del uso normal de un CRM, y a incluirlos en el
borrado de datos personales — donde no se puede borrar "la parte que
nombra a la persona" de un párrafo sin borrar el párrafo entero, que es
información de negocio legítima de la organización.

Se clasifican por diseño y se deja escrita la consecuencia: **el borrado
de datos personales (§5.2) no alcanza el texto libre.** Quien escribe el
nombre de un lead en el cuerpo de una actividad lo pone fuera del alcance
de las garantías de este documento.

---

## 3. Por dónde salen del servidor

Lo que importa del estándar no es dónde se guarda un dato sino quién
puede verlo. Todo lo de abajo exige `authenticate` (JWT de Supabase
verificado por JWKS/ES256) y está aislado por organización.

| Superficie | Qué expone | Quién puede |
|---|---|---|
| `GET /api/contacts`, `GET /api/contacts/:id` | Nombre, email, teléfono, cargo | **Cualquier usuario autenticado** de la organización, no solo ADMIN |
| `GET /api/ingestion-events` | Estados de la cola. **Sin `rawPayload` ni `promotionNotes`** — proyección explícita | ADMIN |
| `GET /api/imports/:batchId` | Motivo de falla de hasta 100 filas. **Ya no devuelve `rawPayload`** — cerrado por `D2-2` | ADMIN |
| `POST /api/ingestion-events/:id/retry` | No devuelve datos del lead, pero identifica un evento concreto | ADMIN |
| `GET /api/users`, `GET /api/invitations` | Email y nombre de personas usuarias e invitadas | ADMIN |
| `GET /api/activities` | Texto libre | Cualquier usuario autenticado |
| `POST /api/imports/preview` | **Entrada**, no salida. Devuelve solo los encabezados — pero recibe el archivo entero: ver la excepción de abajo | ADMIN |
| `POST /api/ingest` | **Entrada**, no salida. Escribe `rawPayload` | Una `ApiKey` válida, sin JWT |

### Excepción declarada a la minimización: `POST /api/imports/preview`

*(Hallazgo `D2-6` de `docs/review-fase2-2026-08-28.md`, aceptado como
excepción el 2026-08-28.)*

El endpoint **sube el archivo completo —hasta 10 MB, hasta 10.000 filas de
datos personales— para devolver una sola fila**, la de encabezados. En
términos estrictos del estándar es recolección desproporcionada: se
transfiere y se expande en memoria mucho más de lo necesario para la
finalidad declarada.

**Se acepta y no se corrige**, por la razón que el propio review anota en
su §3.3 como decisión correcta y no como descuido: la garantía central
del endpoint es que devuelve **los mismos** encabezados que la
importación real, y la sostiene llamando a la **misma** cadena de parseo
(§9.11 de `docs/ingestion-architecture.md`). Un lector parcial que solo
leyera la primera fila sería un segundo camino de parseo, y dos parsers
que interpretan distinto un BOM o un espacio desalinean el
`fieldMapping` **en silencio**: las filas fallan después con *"ninguna
columna del fieldMapping existe"* y nada explica por qué.

El riesgo de tener dos caminos de parseo es peor que el de transferir de
más. Lo que acota el costo no es una lectura parcial —no existe— sino el
límite de tamaño (`IMPORT_MAX_FILE_BYTES`) y la cuota propia del endpoint
(`S2-3`, 10 requests/minuto por identidad). **Nada se persiste**: el
preview no toca la base, no lee `Source` y no escribe ningún
`IngestionEvent`.

Qué la volvería revisable: que aparezca una forma de leer encabezados que
use exactamente el mismo parser que la importación real, en vez de uno
propio.

La asimetría que conviene tener presente: **la capa de ingesta es más
restrictiva que el CRM**. Ver la cola de eventos es ADMIN-only; ver la
ficha del contacto que salió de esa misma cola, con los mismos nombre,
email y teléfono ya promovidos, lo puede hacer cualquier usuario. No es
una incoherencia a corregir a ciegas —un CRM que no deja ver sus
contactos no sirve— pero sí es el lugar donde el control de acceso a
datos Sensitive es más laxo, y conviene decidirlo a propósito y no por
herencia.

---

## 4. Controles vigentes

Lo que el estándar exige para Sensitive, contra lo que existe hoy.
**Regulated exige todo esto y además los requisitos de la jurisdicción**,
que desde el cierre de `Q-1` (§6.1) son los de GDPR: la columna de la
derecha no cambió con esa respuesta —el trabajo técnico ya estaba
hecho—, pero lo que la exige sí. Lo que GDPR agrega por encima de esta
tabla no es código y está en §6.1.

| Control exigido | Estado |
|---|---|
| **Cifrado en reposo** | Sí, por la infraestructura de Supabase (Postgres gestionado). No es un control que este código implemente ni pueda verificar |
| **Cifrado en tránsito** | Sí. HTTPS hasta Supabase; el frontend habla con el backend por HTTPS en cualquier despliegue real |
| **Control de acceso por rol** | Sí. `authenticate` + `authorize("ADMIN")`, más RLS en Postgres. El aislamiento por organización está verificado end-to-end |
| **Registro de accesos** | **Parcial, desde `D2-5`.** Los tres endpoints de ingesta que exponen o identifican datos de leads dejan una línea de log estructurada. `GET /api/contacts` **no** — ver §6 |
| **Minimización** | Parcial. La proyección del listado de eventos y el cierre de `D2-2` son minimización real. `rawPayload` es lo contrario por diseño: guarda todo lo que llegue |
| **Retención** | Sí para `IngestionEvent`, desde `D2-3` — ver §5.1. **No para el resto** |
| **Borrado a pedido** | Sí para un `Contact`, desde `D2-4` — ver §5.2 |
| **Compartir con terceros** | No aplica: hoy no se comparte ningún dato personal con ningún tercero. Supabase es infraestructura, no destinatario |

**Ninguna fila de esta tabla cambió al reclasificar a Regulated, y eso
es el resultado, no una omisión.** Los controles que GDPR exige de un
software —minimización, retención acotada, acceso controlado y
registrado, borrado a pedido— se construyeron en el ciclo de privacidad
(`D2-1` a `D2-5`) cuando todavía eran buenas prácticas voluntarias. La
respuesta a `Q-1` no destapó trabajo pendiente: cambió el estatus de lo
que ya estaba hecho, de recomendación a obligación. Las tres filas que
siguen sin decir "Sí" completo —registro de accesos parcial,
minimización parcial, retención solo de `IngestionEvent`— eran huecos
declarados antes y lo siguen siendo ahora, con más peso.

---

## 5. Retención y borrado

El estándar exige, para cada categoría: período máximo, disparador de
borrado y método.

### 5.1 `IngestionEvent` — 90 días, por tiempo, borrado físico

|  |  |
| --- | --- |
| **Período** | 90 días desde `created_at` |
| **Alcance** | Solo `PROCESSED` y `DUPLICATE` |
| **Disparador** | Tiempo. Ejecución manual, no automática |
| **Método** | `DELETE` físico. No es soft delete: la tabla no tiene `deletedAt` y el punto es que el dato deje de existir |

**`FAILED` y `PENDING` no se purgan nunca, sin importar la edad.** Un
`PENDING` es trabajo sin hacer y un `FAILED` es el único lugar donde vive
el dato que no se pudo promover: borrarlos sería perder información que
nadie recuperó todavía. Es el comportamiento que §9.1 de
`docs/ingestion-architecture.md` ya especificaba.

Se ejecuta con `npm run purge:ingestion-events`, y con `--dry-run` para
contar sin borrar. **No hay cron**: el proyecto no tiene scheduler ni
pipeline de CD, y no se inventa infraestructura que no existe. La
consecuencia es explícita: la retención se cumple si alguien corre el
comando. Está escrito acá para que la brecha sea visible y no una
suposición.

**Los otros modelos no tienen política de retención**, y es un hueco
declarado, no un olvido: `Contact`, `Activity` y `Opportunity` se
retienen indefinidamente porque son el CRM. Definir una política de
retención para el núcleo del producto es una decisión de negocio.

### 5.2 Borrado a pedido de una persona — anonimización, irreversible

Es una acción **separada** del soft delete de `Contact`, que sigue
existiendo y sigue siendo reversible. Son dos conceptos distintos:

- **Soft delete** (`DELETE /api/contacts/:id`): saca el contacto de la
  vista. Los datos siguen ahí. Reversible.
- **Borrado de datos personales**
  (`POST /api/contacts/:id/erase-personal-data`): destruye los datos
  personales y deja la fila. **Irreversible.**

Método: **anonimización en el lugar**, no borrado de la fila. Borrar el
`Contact` rompería las FK de `Opportunity` y `Activity`, que son
historial de negocio de la organización y no datos de la persona.

El estándar es exigente acá y conviene citarlo: _"la seudonimización no
es anonimización"_. Reemplazar un nombre por un marcador fijo sí lo es,
porque el marcador no es reversible ni re-identificable; conservar el
`id` del contacto no re-identifica a nadie por sí mismo.

**Qué alcanza**, exactamente:

| Dato | Queda en |
|---|---|
| `Contact.firstName`, `Contact.lastName` | Un marcador fijo, igual para todos. Son `NOT NULL`, no hay opción de vaciarlos |
| `Contact.email`, `.phone`, `.jobTitle` | `NULL` |
| `IngestionEvent.rawPayload` de los eventos que promovieron a ese contacto | `{ erased: true }`. Es `NOT NULL`, así que no puede ir a `NULL`; un `{}` se leería como "el formulario no mandó nada", que es un estado real y distinto |
| `IngestionEvent.promotionNotes` de esos mismos eventos | **Redactado, no borrado.** Se conservan `tipo`, `campo` y `motivo`; los valores —`crm` y `entrante`— pasan al mismo marcador fijo |

`email` va a `NULL` y no a un marcador por una razón concreta, no por
gusto: existe el único parcial `contacts_org_email_unique` sobre
`(organization_id, lower(email)) WHERE email IS NOT NULL`. Con un marcador
fijo, el **segundo** borrado de la misma organización chocaría contra ese
índice. `NULL` queda fuera del índice parcial por definición.

**`promotionNotes` se redacta y no se borra** *(2026-08-28)*, y ahí hubo
una tensión real que valía la pena resolver bien en vez de rápido. La
columna guarda dos cosas distintas: **qué pasó** —hubo un conflicto, en
qué campo, por qué se ignoró algo— y **con qué valor**. Lo primero es el
registro que §4 de `docs/ingestion-architecture.md` exige y que borrar
destruiría; lo segundo es dato personal del titular.

Se separan: `tipo`, `campo` y `motivo` quedan intactos, y `crm` y
`entrante` pasan al marcador. Después de un borrado sigue siendo cierto y
consultable que hubo un conflicto en `phone`; lo que ya no se puede leer
es qué teléfono era. No se está sobrescribiendo el registro en silencio —
se está borrando el dato personal que ese registro contenía, a pedido de
su titular, dejando el registro en pie.

`NotaRevisionManual` no se toca: su `motivo` es una explicación fija que
escribe el código, no un valor que haya llegado de un formulario. Y ante
una forma que no reconoce —la columna es JSONB y una escritura directa a
la base puede dejar ahí cualquier cosa— la redacción es **fail-closed**:
borra la columna entera. En una operación de borrado, "no reconozco esto"
no puede significar "lo dejo como está".

**Qué NO alcanza, y hay que leerlo antes de dar el borrado por completo:**

1. **`IngestionEvent.errorMessage`**. Desde `D2-7` hay tests que fijan
   que ningún mensaje de validación haga eco del valor recibido, así que
   hoy no transporta datos personales; lo que falta es una garantía
   estructural, no una corrección pendiente.
2. **`IngestionEvent.externalId`**, que si lo proveyó la fuente por
   `X-External-Id` puede ser el email del lead.
3. **Los eventos de esa persona que nunca se promovieron** (`FAILED`,
   `PENDING`): no tienen `promotedContactId`, así que nada los vincula
   al contacto y el borrado no los encuentra.
4. **El texto libre** de `Activity` y `Opportunity` (§2.5).

Las cuatro están escritas también en el código que las deja afuera.
**`promotionNotes` salió de esta lista el 2026-08-28**: era el punto 1 y
se resolvió redactándolo, como se explica más arriba.

### 5.3 Los otros derechos del titular

El estándar pide cuatro, framework-agnósticos. Estado real:

| Derecho | Estado |
|---|---|
| **Acceso** (entregar copia de los datos) | **No soportado mecánicamente.** Se puede armar a mano consultando `Contact` e `IngestionEvent`; no hay endpoint |
| **Corrección** | Sí — `PATCH /api/contacts/:id` |
| **Borrado** | Sí — §5.2, con los límites de §6 |
| **Objeción** | **No soportado.** No hay noción de "no procesar a esta persona": un lead objetado que vuelva a enviar el formulario se reingesta igual |

---

## 6. Lo que este documento NO resuelve

Escrito para que ninguna de estas cosas se lea como cubierta. Empieza
por la jurisdicción, que es la que más cambió: dejó de ser una pregunta
abierta y pasó a ser una obligación con una parte que este documento
cubre y otra que no.

### 6.1 Jurisdicción — `Q-1` está respondida, y lo que abre no es código

*(Respondida el 2026-08-28. Era la última pregunta abierta de los dos
reviews del Toolkit.)*

**Rocco confirmó que hay —o que no se puede descartar que haya— leads
residentes de la Unión Europea en alcance.** `STD-LEG-001` (GDPR) pasa
de **Conditional** a **Mandatory**.

Dos consecuencias, y ninguna es una tarea de ingeniería pendiente:

1. **La reclasificación de §1, §2.2, §2.3 y §2.5.** Los datos personales
   de un lead pasan de Sensitive a **Regulated**. Todo el conjunto y no
   una parte: el esquema no registra el país ni la residencia de un
   lead, así que no hay forma de segmentar por jurisdicción sin un dato
   que nadie recolecta.
2. **`D-3`, `D2-2` y `D2-5` dejan de ser buenas prácticas y pasan a ser
   la forma en que este sistema cumple una obligación legal.** Los tres
   ya están implementados —la retención a 90 días, el `rawPayload` que
   dejó de viajar al navegador, el registro de accesos—, y `D2-4` (el
   borrado a pedido) también. **No hizo falta escribir código nuevo para
   cerrar `Q-1`.** Lo que cambió es qué obliga a mantenerlos.

#### Lo que NO resuelve ningún documento de arquitectura

Estas tres son preguntas legales, no técnicas. Quedan explícitamente
abiertas, y ninguna se completó acá con un valor razonable:

- **Base legal del tratamiento.** ¿Consentimiento? ¿Interés legítimo?
  Tiene que decidirse y documentarse, y probablemente **varía según cómo
  cada organización-cliente de Plataforma CRM recolectó sus leads** — no
  es algo que el software pueda decidir por todos los tenants a la vez.
  Acá no se elige ninguna.
- **Plazos de respuesta a solicitudes de titulares.** GDPR exige
  responder sin demora indebida y dentro de un plazo máximo. Que
  `POST /api/contacts/:id/erase-personal-data` sea inmediato y
  sincrónico ayuda —no hay cola ni proceso diferido entre el pedido y el
  borrado—, pero **el plazo es una obligación operativa de la
  organización que usa el CRM**, no algo que el código garantice por sí
  solo. Acá no se fija ninguna fecha.
- **Registro de actividades de tratamiento (Art. 30).** Este documento
  ya cubre buena parte de lo que ese registro pediría: qué dato, dónde
  vive, para qué, cuánto se retiene, quién accede. Pero **formalizarlo
  como el registro que el artículo exige es una decisión y una redacción
  legal**, no una tarea de ingeniería, y no se hace acá.

**Esta tarea deja el sistema técnicamente alineado con lo que GDPR
exigiría de un software** —minimización, retención, acceso controlado y
registrado, borrado a pedido—, **pero no constituye asesoría legal ni
determina por sí sola el cumplimiento GDPR del negocio.** Eso requiere
la revisión de alguien con competencia legal, que es además quien es
dueño de la decisión de negocio. Nada de lo escrito acá sustituye esa
revisión.

---

Y lo que este documento sigue sin resolver, además de lo de arriba:

1. **El texto libre queda afuera del borrado** (§2.5). Es la limitación
   más grande y la más fácil de olvidar.
2. **`GET /api/contacts` no registra accesos**, y es la superficie por
   la que más datos Regulated salen del servidor. El log de `D2-5` cubre
   los tres endpoints de ingesta porque ahí es donde los reviews
   encontraron el hueco; extenderlo al CRM entero es otra decisión, con
   otro volumen de log. Con GDPR Mandatory pesa más que antes.
3. **No hay retención para el CRM** (§5.1).
4. **Acceso y objeción no son mecánicamente soportables** (§5.3), y son
   dos de los cuatro derechos que GDPR exige poder atender.
5. **La retención depende de que alguien corra un comando** (§5.1).
6. **La jurisdicción de las personas USUARIAS de la plataforma sigue sin
   preguntarse** (§2.1). `Q-1` fue sobre los leads, que es otra
   población.

---

## 7. Cuándo hay que volver acá

Este documento se desactualiza solo. Hay que revisarlo cuando:

- se agregue un campo a cualquier modelo con datos de una persona;
- se agregue un endpoint que devuelva `Contact`, `User`, `Invitation` o
  cualquier parte de un `IngestionEvent`;
- se active el ítem 6 de la ingesta (bases de datos externas, hoy
  pospuesto por §7 de `docs/ingestion-architecture.md`): traería datos
  personales de un origen que nadie de este lado controla;
- se responda la pregunta de jurisdicción que `Q-1` **no** hizo: la de
  las personas usuarias de la plataforma (§2.1). La de los leads ya se
  respondió y disparó la reclasificación a Regulated (§6.1);
- aparezca cualquier forma de saber de qué país es un lead. Hoy no
  existe, y por eso la reclasificación fue del conjunto entero; con ese
  dato, segmentar volvería a ser posible — y habría que decidir si
  conviene;
- se comparta cualquier dato con un tercero — hoy no pasa, y el estándar
  exige base legal, acuerdo de tratamiento y documentación antes de que
  pase.
