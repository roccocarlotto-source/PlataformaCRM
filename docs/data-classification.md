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

**Hoy no hay ningún dato Regulated en el sistema, y es una afirmación
sobre el esquema, no una esperanza.** Ningún modelo tiene campos de
salud, biométricos ni de menores. `Opportunity.amount` es un importe
comercial de una operación entre empresas, no un dato financiero de una
persona física. Lo que convertiría esto en falso: que un `fieldMapping`
empiece a mapear un campo de salud desde un formulario, o que el CRM se
use para vender a consumidores finales con datos de pago. Las dos cosas
se verían primero en `rawPayload`, que es texto libre por diseño.

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

### 2.2 Leads y contactos — el núcleo del problema

| Modelo · campo | Clase | Nota |
|---|---|---|
| `Contact.firstName`, `Contact.lastName` | **Sensitive** | `NOT NULL`. Identifican a una persona física |
| `Contact.email` | **Sensitive** | Único parcial por organización sobre `lower(email)` |
| `Contact.phone` | **Sensitive** | |
| `Contact.jobTitle` | **Sensitive** | Menos identificatorio por sí solo, pero es un atributo de la persona y viaja siempre junto a su nombre |
| `Contact.source` | **Internal** | Texto libre de hasta 100; hoy lo escribe la ingesta con el nombre de la `Source` |
| `Contact.lifecycleStage` | **Internal** | |

### 2.3 La capa de ingesta

| Modelo · campo | Clase | Nota |
|---|---|---|
| `IngestionEvent.rawPayload` | **Sensitive** | `NOT NULL`, JSONB, **contenido arbitrario**: es la fila cruda del formulario o de la planilla. Es el dato personal menos acotado del sistema — nada valida qué trae |
| `IngestionEvent.promotionNotes` | **Sensitive** | **No es un identificador.** `NotaConflicto` guarda `crm` y `entrante`, o sea los **valores** de `firstName`, `lastName`, `phone` y `jobTitle` que se descartaron. Ningún review lo había clasificado |
| `IngestionEvent.errorMessage` | **Internal declarado, Sensitive potencial** | Nada garantiza que un mensaje de validación no transporte el valor que falló. Es el hallazgo `D2-7`, todavía abierto |
| `IngestionEvent.externalId` | **Internal si es derivado, Sensitive si es provisto** | El derivado es un SHA-256 del payload canónico y no revela nada. El provisto llega por `X-External-Id` y una fuente puede mandar ahí el email del lead |
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
| `Activity.subject` | **Internal por diseño, Sensitive por contenido** | `VarChar(255)` escrito por una persona sobre un contacto |
| `Activity.body` | **Internal por diseño, Sensitive por contenido** | Texto **sin límite de longitud**. Es el campo más grande y menos controlado del esquema fuera de `rawPayload` |
| `Opportunity.title`, `Opportunity.lostReason` | **Internal por diseño, Sensitive por contenido** | |

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
| `POST /api/ingest` | **Entrada**, no salida. Escribe `rawPayload` | Una `ApiKey` válida, sin JWT |

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

Lo que el estándar exige para Sensitive, contra lo que existe hoy:

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

Lo que alcanza y lo que no está en §6 y en el propio endpoint.

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

Escrito para que ninguna de estas cosas se lea como cubierta:

1. **Jurisdicción.** Este documento es framework-agnóstico, como el
   estándar. Si algún lead es residente de la UE, `STD-LEG-001` (GDPR)
   se activa y trae obligaciones propias — base legal, plazos de
   respuesta, registro de actividades de tratamiento. Es la pregunta
   `Q-1`, abierta desde el 27 de agosto y **todavía sin responder**.
   Nada de acá la contesta.
2. **El texto libre queda afuera del borrado** (§2.5). Es la limitación
   más grande y la más fácil de olvidar.
3. **`GET /api/contacts` no registra accesos**, y es la superficie por
   la que más datos Sensitive salen del servidor. El log de `D2-5` cubre
   los tres endpoints de ingesta porque ahí es donde los reviews
   encontraron el hueco; extenderlo al CRM entero es otra decisión, con
   otro volumen de log.
4. **`errorMessage` sigue sin garantía** (`D2-7`).
5. **No hay retención para el CRM** (§5.1).
6. **Acceso y objeción no son mecánicamente soportables** (§5.3).
7. **La retención depende de que alguien corra un comando** (§5.1).

---

## 7. Cuándo hay que volver acá

Este documento se desactualiza solo. Hay que revisarlo cuando:

- se agregue un campo a cualquier modelo con datos de una persona;
- se agregue un endpoint que devuelva `Contact`, `User`, `Invitation` o
  cualquier parte de un `IngestionEvent`;
- se active el ítem 6 de la ingesta (bases de datos externas, hoy
  pospuesto por §7 de `docs/ingestion-architecture.md`): traería datos
  personales de un origen que nadie de este lado controla;
- se responda `Q-1`, que puede cambiar la clase de todo lo que hoy es
  Sensitive a Regulated para una parte de los titulares;
- se comparta cualquier dato con un tercero — hoy no pasa, y el estándar
  exige base legal, acuerdo de tratamiento y documentación antes de que
  pase.
