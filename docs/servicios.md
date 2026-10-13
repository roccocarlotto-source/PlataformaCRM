# Servicios: el taller de postventa de una concesionaria

> Documento de diseño. Estado: **aprobado, sin código**. Fecha:
> 2026-10-13. Aprobado por Rocco el mismo día, con D1–D18 en la opción
> recomendada y cuatro ajustes (§14.1). Nada de lo descrito acá existe todavía. Las referencias
> `archivo:línea` son al código de `master` en el merge de #512 y sirven para
> ubicar qué se reusa y dónde se tocaría.
>
> Las decisiones que ya tomó Rocco están en §0.2 y no se vuelven a discutir. Las
> que se tomaron sobre este documento están en §14 (D1–D18). Los PR del plan (§11) se numeran S0–S14.

## 0. Por qué

### 0.1 El pedido

Las concesionarias que tienen taller necesitan registrar los autos que entran
al service, seguirlos hasta que el cliente los retira y, sobre todo, **hacer
que el cliente vuelva**. El dolor principal del taller es que los clientes se
olvidan del próximo service. El segundo es comercial: un cliente de taller cambia
de auto cada 4 o 5 años, y nadie en ventas se entera de que se acerca el momento.

### 0.2 Decisiones ya tomadas (Rocco, 2026-10-13)

1. **Es un módulo, `servicios`**, que el platform admin activa por
   organización. Se suma a la edición que la organización tenga, ESENCIAL o
   COMPLETA. No es una edición nueva ni un rubro nuevo. **Solo rubro
   AUTOMOTORA.**
2. **Funciona sin IA.** El módulo sirve aunque no haya agente.
3. **Entidades:** el **vehículo del cliente**, distinto del stock, y la
   **orden de servicio** (§2).
4. **Estados:** un set simple, de Agendado a Entregado, más Cancelado (§3).
5. **Aprobación de trabajos extra:** el cliente aprueba por teléfono o por
   WhatsApp con una persona, y el encargado la registra a mano (quién, cuándo y
   por qué medio). No hay link de aprobación ni presupuesto por líneas.
6. **Avisos al cliente** ("listo para retirar"): por ahora los manda una
   persona. Se pueden proponer ayudas (§8).
7. **Fuera de alcance:** facturación, cobro, repuestos e inventario, horas de
   mecánicos, firma de la orden y garantías. No es un ERP.
8. **Lo más importante del módulo es el recordatorio del próximo service.** Es
   por fecha, sale de un intervalo por tipo de servicio editable a mano, y lo
   mandan las automatizaciones con plantilla aprobada, sin una persona (§6).
9. **Recambio de auto:** un evento de automatización "Se acerca el recambio",
   calculado desde la fecha de compra y configurable por organización. Puede ir
   en una fase posterior, pero queda diseñado (§7).
10. **La reseña no es parte del módulo.** Lo que hace falta son los eventos
    "Orden entregada" y "La orden cambió de estado" para engancharla (§9).
11. **Agente de IA: fuera de la primera fase.** Queda anotado para después
    (§12).

### 0.3 Principio: quien no tiene el módulo no ve ninguna diferencia

Es la misma regla que sostuvieron ediciones (`docs/ediciones.md` §5) y rubros
(`docs/rubros.md` §14.1). Para una organización sin el módulo:

- ninguna respuesta cambia;
- ningún menú, ninguna tarjeta del dashboard ni ningún evento del catálogo de
  automatizaciones cambia;
- ningún worker hace trabajo nuevo.

Cómo se garantiza: §13.

---

## 1. Activación del módulo

### 1.1 Qué hay hoy

- **El catálogo** es `src/config/ediciones.ts`.
  - `modulosDe(edition, industry)` (`:147`) es la intersección de
    `MODULOS_POR_EDICION` y `MODULOS_POR_RUBRO`, precalculada para las cuatro
    combinaciones.
- **El gate** es `exigirModuloDeLaEdicion` (`src/middlewares/moduloDeLaEdicion.ts`),
  que llama `authenticate`.
  - Para COMPLETA + AUTOMOTORA es casi un no-op. La única excepción son las
    rutas de un módulo de `SOLO_CLINICA`, que dan 403 con `motivo: "RUBRO"`
    (`:67-80`).
- **No existe ninguna marca por organización** aparte de `edition` e
  `industry`. Todo lo que una organización tiene se deduce de esas dos
  columnas.

`servicios` es el primer módulo que **no sale de la edición ni del rubro**: es
una tercera dimensión, "módulos activados". Se diseña genérica, porque es
probable que no sea la última.

### 1.2 Dónde vive la marca (D1)

Una tabla nueva, `organization_modules`, en lugar de una columna en
`organizations`:

```prisma
model OrganizationModule {
  organizationId String    @map("organization_id") @db.Uuid
  module         String    @db.VarChar(50)          // "servicios"; CHECK contra la lista de módulos activables
  enabledAt      DateTime  @default(now()) @map("enabled_at")
  enabledById    String    @map("enabled_by_id") @db.Uuid   // el platform admin
  disabledAt     DateTime? @map("disabled_at")
  disabledById   String?   @map("disabled_by_id") @db.Uuid
  @@id([organizationId, module])
  @@map("organization_modules")
}
```

- **Activo** = la fila existe y `disabled_at` es NULL. Reactivar limpia
  `disabled_at`.
- **Por qué una tabla:**
  - no se toca `organizations`;
  - queda registrado quién lo activó y cuándo;
  - el próximo módulo activable no necesita otra migración de columnas.
- **El CHECK** limita `module` a los valores activables (hoy, solo
  `'servicios'`). Un valor que el backend no sabe gatear no puede quedar
  escrito.
- **RLS** con la política uniforme por organización, más H-01 y la fila 5 del
  diagnóstico, como toda tabla nueva. **Solo la escribe** el service de
  Plataforma.

### 1.3 Cómo entra en el catálogo

```ts
// src/config/ediciones.ts
export const MODULOS = [ /* ...los de hoy... */, "servicios" ] as const;

/** Módulos que una organización tiene solo si un platform admin los activó
 *  (docs/servicios.md §1). No los da la edición ni el rubro. */
export const MODULOS_ACTIVABLES: ReadonlySet<Modulo> = new Set<Modulo>(["servicios"]);

/** En qué rubros se puede activar cada uno. */
export const RUBROS_DEL_MODULO_ACTIVABLE: Record<"servicios", readonly OrganizationIndustry[]> = {
  servicios: ["AUTOMOTORA"],
};

export function modulosDe(
  edition: OrganizationEdition,
  industry: OrganizationIndustry,
  activados: ReadonlySet<Modulo> = SIN_ACTIVADOS,   // falla cerrado
): ReadonlySet<Modulo>;
```

- **La regla:** `modulosDe` devuelve lo de edición ∩ rubro **sin** los
  activables, más los activables que estén en `activados` **y** que el rubro
  admita.
- **Una fila de `servicios` en una clínica no da nada.** El alta la rechaza
  (§1.5), y aunque la fila exista por un `INSERT` a mano, `modulosDe` la
  ignora.
- **El parámetro nuevo tiene default vacío.** Un llamador que se olvide de
  pasarlo **no ve** `servicios`, que es el lado seguro.
  - Hoy hay 6 llamadores: el gate, `/me`, el controller de oportunidades,
    `automation.service.ts` (`:115`, `:199`), `programacion.service.ts` e
    `importacionEdicion.ts`.
  - Solo el gate, `/me` y `automation.service` necesitan los activados. Los
    otros preguntan por módulos que no son activables.
- **`MODULOS_POR_EDICION` y `MODULOS_POR_RUBRO`** sacan `servicios` del set
  base. Para `modulosDe(e, r)` sin activados el resultado es **idéntico al de
  hoy**, y lo fija la suite "automotora sin cambios" contra la lista fija de
  módulos (§13).
- **Precálculo:** las combinaciones dejan de ser cuatro. El gate cachea por
  clave `edition/industry/activados-ordenados`, con una entrada por
  combinación real. Hoy son a lo sumo ocho.

### 1.4 AuthContext y el gate

- **`findUserForAuth`** suma, en el mismo SELECT que ya hace JOIN con
  `organizations`, una subconsulta:
  `array(select module from organization_modules where organization_id = o.id and disabled_at is null)`.
  Es el mismo truco que `sedes` (R20) y no agrega ninguna consulta por pedido.
  `AuthContext` suma `modulosActivados: readonly string[]`.
- **El gate.** El atajo de COMPLETA + AUTOMOTORA hoy mira solo `SOLO_CLINICA`
  y pasa a mirar también los activables:

  ```ts
  if (auth.edition === "COMPLETA" && auth.industry === "AUTOMOTORA") {
    const modulo = moduloDeLaRuta(rutaDelRequest(req));
    if (modulo !== undefined && SOLO_CLINICA.has(modulo)) throw /* 403, RUBRO, como hoy */;
    if (modulo !== undefined && MODULOS_ACTIVABLES.has(modulo) && !auth.modulosActivados.includes(modulo))
      throw /* 403 MODULO_NO_INCLUIDO, motivo NO_ACTIVADO */;
    return;
  }
  ```

  En las otras combinaciones el camino general ya lo cubre: `modulosDe` con los
  activados.
- **Respuesta.** Es la misma que conocen los clientes de la API:
  `403 { code: "MODULO_NO_INCLUIDO", modulo: "servicios", motivo: "NO_ACTIVADO" }`.
  - `motivo` suma un tercer valor. Es aditivo: ninguna respuesta que hoy recibe
    alguien cambia, porque ninguna organización tiene rutas de `servicios`.
  - En una clínica el motivo es `RUBRO`.
  - El frontend muestra "Este módulo no está activado para tu organización" y no
    ofrece nada más.
- **`motivoDeExclusion`** suma ese caso. Si el rubro no lo admite, el motivo
  es `RUBRO`. Si lo admite y no está activado, es `NO_ACTIVADO`.
- **Caché.** Activar o desactivar llama a `vaciarContextosDeAuth()`, como el
  cambio de edición (ediciones §5.2 punto 6).

### 1.5 Quién lo activa y cómo

- **Rutas nuevas, módulo `plataforma`, con `requirePlatformAdmin`:**
  - `PUT /api/admin/organizations/:organizationId/modulos/:modulo`: activa.
    Repetirlo no hace nada.
  - `DELETE /api/admin/organizations/:organizationId/modulos/:modulo`:
    desactiva.
  - El listado `GET /api/admin/organizations` suma `modulosActivados`.
- **Validaciones:**
  - un módulo que no está en `MODULOS_ACTIVABLES` da 400;
  - un rubro que no admite el módulo da 409 `MODULO_NO_DISPONIBLE_EN_EL_RUBRO`;
  - el cambio de rubro de una organización con `servicios` activado da 409, como
    el de una organización con datos (rubros D1).
- **Al activar:** se crea `workshop_settings` con los defaults (§2.6), en la
  misma transacción. Si la fila falta, el código usa los defaults, así que nada
  depende de que exista (el patrón de `ClinicSettings`).
- **Al desactivar (D15):**
  - **los datos se conservan**;
  - las rutas dan 403 y el menú desaparece;
  - los barridos de §6 y §7 no miran la organización;
  - los envíos pendientes se cancelan al revalidar, con el motivo "módulo
    desactivado".
  - Reactivar devuelve todo como estaba. Los recordatorios cuya fecha pasó
    mientras estaba apagado salen solo dentro del margen de §6.4.
- **Pantalla:** Plataforma → Organizaciones (la del paso A de ediciones) suma
  una columna "Módulos" y la acción "Activar Servicios" / "Desactivar
  Servicios", con confirmación. Desactivar avisa cuántas órdenes abiertas
  tiene.
- **El ADMIN de la organización no lo activa.** En `/organization` lo ve como
  dato de solo lectura, igual que la edición.

### 1.6 Rutas del módulo

Todas con `authenticate` y clasificadas en `RUTAS_POR_MODULO.servicios`. El test
"toda ruta clasificada" (`src/config/ediciones.test.ts`) obliga a hacerlo. Viven
en una carpeta propia, `src/servicios/`, con la misma organización por capas
que `src/clinicas/`.

| Recurso | Rutas |
|---|---|
| Vehículos del cliente | `GET, POST /api/servicios/vehiculos` · `GET, PATCH, DELETE /api/servicios/vehiculos/:id` · `GET /api/servicios/vehiculos/:id/ordenes` · `POST /api/servicios/vehiculos/:id/dueno` (§2.2.1) |
| Órdenes | `GET, POST /api/servicios/ordenes` · `GET, PATCH /api/servicios/ordenes/:id` · `POST /api/servicios/ordenes/:id/estado` · `POST /api/servicios/ordenes/:id/aprobaciones` |
| Fotos | `GET, POST /api/servicios/ordenes/:id/fotos` · `DELETE /api/servicios/fotos/:id` |
| Configuración (ADMIN) | `GET, PUT /api/servicios/configuracion` · `GET, POST /api/servicios/tipos` · `PATCH, DELETE /api/servicios/tipos/:id` |
| Dashboard | `GET /api/servicios/dashboard` · `GET /api/servicios/recambios` · `POST /api/servicios/vehiculos/:id/avisos` (§4.7) |

**No hay campos de servicios en rutas de otros módulos.** Por eso no hacen
falta bloqueos por campo (`CAMPOS_POR_RUTA`): la ficha del contacto pide sus
vehículos a `GET /api/servicios/vehiculos?contactId=`, que da 403 sin el
módulo, y el frontend ni la llama.

---

## 2. Modelo de datos

Convenciones del repo para todas las tablas:

- `organization_id` NOT NULL y FKs compuestas `(organization_id, x_id)`;
- RLS con la política uniforme `organization_id = public.current_organization_id()`
  (`prisma/sql/rls_policies.sql:66-74`);
- H-01 en `tenant-isolation.integration-test.ts` y la fila 5 de
  `docs/auditoria-2026-08-21-diagnostico.sql`;
- las FKs a `contacts` se suman al inventario de `contactMerge` (§2.8).

### 2.1 RLS por organización y por sucursal

**RLS es solo por organización, como en todo el repo.** Ninguna tabla tiene hoy
una política por sucursal: el límite de sede es de la aplicación
(`filtroDeSedes` / `exigirSedeDelActor`, `src/services/permisos.ts:99-132`), y
en una automotora `sedesDelActor` devuelve "todas".

Las tablas del taller llevan `branch_id` donde corresponde (la orden, el
vehículo como sucursal de referencia). El listado se filtra por sucursal en la
UI y pasa por `filtroDeSedes`, así que si algún día hay usuarios de taller
limitados a una sede (§10), el límite ya tiene dónde aplicarse.

Poner una política RLS por sucursal sería la primera del repo. Además, el
backend no conoce la sede del usuario en la sesión de Postgres. **No se
propone.**

### 2.2 Vehículo del cliente

```prisma
model CustomerVehicle {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId      String    @db.Uuid
  contactId           String    @db.Uuid              // el dueño; un contacto puede tener varios
  branchId            String?   @db.Uuid              // sucursal de referencia: de donde salen los recordatorios
  make                String    @db.VarChar(60)
  model               String    @db.VarChar(80)
  year                Int?                            // CHECK 1950..(año actual + 1)
  licensePlate        String?   @db.VarChar(20)       // como la escribió el usuario
  licensePlateNorm    String?   @db.VarChar(20)       // mayúsculas, sin espacios ni guiones: lo que se busca
  vin                 String?   @db.VarChar(30)       // chasis, opcional
  mileage             Int?                            // último km conocido (lo actualiza cada orden)
  purchasedOn         DateTime? @db.Date              // fecha de compra, si se sabe (§7)
  nextServiceDueOn    DateTime? @db.Date              // próximo service (§6); null = sin recordatorio
  nextServiceSetFromOrderId String? @db.Uuid          // de qué orden salió la fecha; null = cargada a mano
  remindersOptOut     Boolean   @default(false)       // "no recordar": el cliente pidió no recibir
  sourceVehicleId     String?   @db.Uuid              // la unidad del stock de la que salió (§5)
  sourceOpportunityId String?   @db.Uuid              // la venta de la que salió
  ownershipEndedAt    DateTime?                       // "ya no es del cliente" (§2.2.1); null = vigente
  ownershipEndReason  CustomerVehicleEndReason?       // CHECK: los dos o ninguno
  notes               String?   @db.VarChar(2000)
  createdAt, updatedAt, deletedAt                     // soft delete
  @@map("customer_vehicles")
}

enum CustomerVehicleEndReason {
  VENDIDO_A_TERCERO   // el cliente lo vendió y no sabemos a quién
  PERMUTA             // entró a nuestro stock como parte de pago (§2.2.1)
  OTRO                // robo, destrucción, se mudó…
}

enum CustomerVehicleOwnerChangeKind {
  CAMBIO_DE_DUENO     // pasa a otro contacto
  FIN                 // deja de ser de un cliente nuestro
}

model CustomerVehicleOwnerChange {      // el registro de cada cambio de dueño o fin (D16)
  id                String   @id @db.Uuid
  organizationId    String   @db.Uuid
  customerVehicleId String   @db.Uuid
  kind              CustomerVehicleOwnerChangeKind
  fromContactId     String   @db.Uuid
  toContactId       String?  @db.Uuid    // solo con CAMBIO_DE_DUENO (CHECK)
  endReason         CustomerVehicleEndReason?  // solo con FIN (CHECK)
  previousPurchasedOn DateTime? @db.Date // la fecha de compra que se limpió
  stockVehicleId    String?  @db.Uuid    // con PERMUTA: la unidad del stock que coincidió
  note              String?  @db.VarChar(1000)
  changedAt         DateTime @default(now())
  changedById       String?  @db.Uuid    // null = lo hizo el barrido de permutas (§2.2.1)
  @@map("customer_vehicle_owner_changes")
}
```

- **Matrícula opcional.** Un 0 km vendido todavía no tiene matrícula; se
  completa después. La búsqueda usa `license_plate_norm` y `vin`.
- **Unicidad (D16):** índice único parcial `(organization_id, license_plate_norm)`
  `WHERE deleted_at IS NULL AND ownership_ended_at IS NULL AND license_plate_norm IS NOT NULL`,
  y lo mismo con `vin`.
  - Una matrícula duplicada da 409 con el vehículo existente, para que la
    pantalla ofrezca abrirlo.
  - Un vehículo que **ya no es del cliente** queda fuera del único. Así el mismo
    auto puede volver a entrar como vehículo vigente de otro cliente, por
    ejemplo cuando la concesionaria lo recibió en permuta y lo vendió de nuevo.
  - **Cambiar el dueño** no se hace editando `contactId`: tiene su propia acción
    (§2.2.1). El `PATCH` del vehículo rechaza `contactId` con 400.
- **`sourceVehicleId`** tiene un único parcial `WHERE deleted_at IS NULL AND
  ownership_ended_at IS NULL`, de modo que una unidad del stock pasa a cliente
  una sola vez por venta. **No es FK con cascade:** la unidad del stock se puede
  borrar (soft) sin tocar al vehículo del cliente.
- **Borrar** es soft. Con órdenes abiertas da 409.
- **Índices:** `(organization_id, contact_id)`, `(organization_id, next_service_due_on)`
  `WHERE deleted_at IS NULL AND ownership_ended_at IS NULL AND NOT reminders_opt_out`
  (el barrido de §6) y `(organization_id, purchased_on)` con el mismo filtro
  (§7).
- **"Vigente"**, en todo el documento, quiere decir `deleted_at IS NULL AND
  ownership_ended_at IS NULL`. Un vehículo que no está vigente no recibe
  recordatorios ni avisos de recambio y no aparece en el dashboard. Su ficha y
  su historial de órdenes se siguen viendo, con la marca "Ya no es del
  cliente".

#### 2.2.1 Cambiar dueño y "ya no es del cliente" (D16)

**Acción "Cambiar dueño"** en la ficha del vehículo:
`POST /api/servicios/vehiculos/:id/dueno`. Tiene dos variantes:

| Variante | Body | Qué hace |
|---|---|---|
| Pasa a otro contacto | `{ toContactId, nota? }` | `contactId = toContactId`, `purchasedOn = null`, `sourceOpportunityId` queda (es historia). Sigue vigente. |
| Ya no es de un cliente nuestro | `{ fin: "VENDIDO_A_TERCERO" \| "OTRO", nota? }` | `ownershipEndedAt = now()`, `ownershipEndReason`, `purchasedOn = null`. Deja de estar vigente. |

**Las dos variantes:**

- Escriben una fila en `customer_vehicle_owner_changes` en la misma transacción,
  con la fecha de compra que se limpió en `previousPurchasedOn`.
- Con una orden abierta dan 409: primero se entrega o se cancela.
- **Dejan de recordarle al dueño anterior.**
  - Los envíos pendientes se cancelan en la misma transacción, con el motivo
    "cambió el dueño".
  - Además, el worker revalida antes de mandar que `contactId` del envío siga
    siendo el del vehículo (§6.3). Eso cubre lo que se haya encolado en el
    medio.
- **El próximo service:**
  - si pasa a otro contacto, **se conserva**: el auto sigue necesitando el
    service, y los recordatorios le llegan al dueño nuevo;
  - si termina, deja de importar, porque el vehículo no está vigente.
- **El recambio:** al limpiar la fecha de compra, no hay aviso de recambio para
  el dueño nuevo hasta que alguien cargue cuándo lo compró (§7.1).
- **No hay "deshacer".** Un cambio por error se corrige con otro cambio. El
  registro muestra los dos.

**Permuta: una unidad que entra al stock y coincide con un vehículo de
cliente.** Pasa cuando un cliente del taller entrega su auto como parte de pago.
La propuesta:

- **No toca el código de stock.** El barrido de ventas de §5 (S10) suma una
  segunda consulta: unidades del stock vigentes (`vehicles.deleted_at IS NULL`)
  cuya matrícula normalizada o cuyo chasis coincide con un vehículo de cliente
  vigente. La matrícula normalizada se calcula en SQL con
  `upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g'))`, porque
  `vehicles.license_plate` no tiene columna normalizada.
- **Por cada coincidencia,** el vehículo del cliente termina con
  `ownershipEndReason = PERMUTA`. Se escribe la fila del registro con
  `stockVehicleId` y `changedById = null`, y una nota en el contacto: "Su
  {vehiculo} entró al stock (unidad {internalCode})".
- **Se excluye la unidad del stock que salió de ese mismo vehículo de cliente**
  (`sourceVehicleId`). Una venta recién convertida coincide consigo misma
  mientras la unidad siga en el stock como SOLD.
- **Por qué automático:** cuando el auto entra al stock, ya es de la
  concesionaria, así que no hay a quién recordarle el service. Si la
  coincidencia es un error (una matrícula mal cargada en el stock), se corrige
  la matrícula y se usa "Cambiar dueño" sobre una copia nueva.
- **Cuándo:** va en **S10**, no en S3. Usa el mismo barrido, y las columnas y
  la tabla del registro ya entran en S1, así que no suma migración. S3 solo
  trae la acción manual.

### 2.3 Orden de servicio

```prisma
enum ServiceOrderStatus {
  AGENDADO
  RECIBIDO
  EN_TRABAJO
  ESPERANDO_APROBACION
  LISTO_PARA_RETIRAR
  ENTREGADO
  CANCELADO
}

model ServiceOrder {
  id                 String   @id @db.Uuid
  organizationId     String   @db.Uuid
  number             Int                                // consecutivo por organización: "OS-0042" (D18)
  customerVehicleId  String   @db.Uuid
  contactId          String   @db.Uuid                  // quien trae el auto; por defecto, el dueño
  branchId           String   @db.Uuid
  bookingId          String?  @db.Uuid                  // turno de la agenda, opcional (§4.4)
  assigneeId         String?  @db.Uuid                  // encargado de taller (un User)
  status             ServiceOrderStatus @default(AGENDADO)
  scheduledFor       DateTime?                          // cuándo se espera el auto (Agendado)
  mileageIn          Int?                               // km al ingreso
  damageNotes        String?  @db.VarChar(4000)         // daños al ingreso
  notes              String?  @db.VarChar(8000)         // "Notas": qué servicio se hace, texto libre
  amount             Decimal? @db.Decimal(14, 2)        // "Valor": lo que se le cobra al cliente
  currency           String?  @db.VarChar(3)            // ISO 4217, como Opportunity.currency
  receivedAt         DateTime?
  workStartedAt      DateTime?
  readyAt            DateTime?
  deliveredAt        DateTime?
  cancelledAt        DateTime?
  cancelReason       String?  @db.VarChar(500)
  nextServiceDueOn   DateTime? @db.Date                 // la fecha que se fijó al entregar (§6.1)
  createdById        String   @db.Uuid
  createdAt, updatedAt
  @@unique([organizationId, number])
  @@map("service_orders")
}
```

- **Valor:** `amount` y `currency` van juntos (CHECK: los dos o ninguno), con
  `Decimal(14,2)` y `VarChar(3)`, como `Opportunity`. La moneda por defecto es
  `Organization.preferredCurrency` (D17). Es un dato informativo: no hay cobro
  ni factura.
- **Fechas por estado:** las columnas `*_at` guardan la **última** vez que la
  orden entró en ese estado, y son las que usan los listados y el dashboard.
  El historial completo va en §2.4.
- **Sin borrado.** Una orden se cancela, nunca se borra. Así el número
  consecutivo no tiene huecos que expliquen nada.
- **Índices:**
  - `(organization_id, status, branch_id)` para el tablero;
  - `(organization_id, customer_vehicle_id, created_at)` para el historial;
  - un único parcial `(organization_id, customer_vehicle_id)` `WHERE status IN
    ('RECIBIDO','EN_TRABAJO','ESPERANDO_APROBACION','LISTO_PARA_RETIRAR')`, para
    que el mismo auto no esté dos veces en el taller. AGENDADO queda fuera: se
    puede tener un turno futuro mientras el auto está adentro por otra cosa.
- **Número consecutivo:** `workshop_settings.next_order_number`, con
  `UPDATE … RETURNING` en la transacción del alta. Es el patrón de
  `Organization.nextVehicleStockNumber`.

### 2.4 Historial de estados

```prisma
model ServiceOrderStatusChange {
  id             String   @id @db.Uuid
  organizationId String   @db.Uuid
  serviceOrderId String   @db.Uuid
  fromStatus     ServiceOrderStatus?   // null en el alta
  toStatus       ServiceOrderStatus
  changedAt      DateTime @default(now())
  changedById    String   @db.Uuid
  note           String?  @db.VarChar(1000)
  @@map("service_order_status_changes")
}
```

Se escribe en la misma transacción que el cambio, que es condicional sobre el
estado anterior (`WHERE status = :desde`, como `marcarTurno`,
`atendido.service.ts:46`). Dos personas que mueven la misma orden a la vez no
dejan un historial inconsistente: la segunda recibe 409.

### 2.5 Aprobaciones

```prisma
enum ApprovalChannel { TELEFONO WHATSAPP PRESENCIAL OTRO }
enum ApprovalDecision { APROBADO RECHAZADO }

model ServiceOrderApproval {
  id             String   @id @db.Uuid
  organizationId String   @db.Uuid
  serviceOrderId String   @db.Uuid
  description    String   @db.VarChar(2000)          // qué se le consultó: "cambio de pastillas de freno"
  decision       ApprovalDecision
  approverName   String   @db.VarChar(200)           // quién aprobó del lado del cliente: "el titular", "su hijo"
  channel        ApprovalChannel
  decidedAt      DateTime                            // cuándo dijo que sí (puede ser antes de registrarlo)
  amount         Decimal? @db.Decimal(14, 2)         // opcional: cuánto se le dijo
  currency       String?  @db.VarChar(3)
  recordedById   String   @db.Uuid                   // la persona de la plataforma que lo registró
  createdAt      DateTime @default(now())
  @@map("service_order_approvals")
}
```

- **Es solo un registro.** No cambia el Valor de la orden por su cuenta: el
  diálogo ofrece "Sumar al valor de la orden" y, si se marca, hace un `PATCH`
  aparte en la misma transacción.
- **Salir de ESPERANDO_APROBACION exige una aprobación registrada** después de
  la entrada a ese estado, sea aprobada o rechazada. Si no hay, da 409
  `FALTA_REGISTRAR_LA_APROBACION`. Es la única regla del módulo que obliga a
  registrar algo, y es lo que hace útil el estado.
- Con `channel = WHATSAPP`, la ficha ofrece abrir la conversación del contacto
  para ver el mensaje. **No se vincula a un mensaje concreto** en esta versión.

### 2.6 Configuración y tipos de service

```prisma
model WorkshopSettings {            // 1:1 con la organización; se crea al activar el módulo
  organizationId            String  @id @db.Uuid
  nextOrderNumber           Int     @default(1)
  defaultNextServiceMonths  Int?    @default(12)  // si la orden no tiene tipo con intervalo; null = no proponer fecha
  firstServiceAfterMonths   Int?    @default(12)  // primer service de un auto vendido (§6.1, D6); null = no fijar; CHECK 1..60
  createdAt, updatedAt
  @@map("workshop_settings")
}

model ServiceJobType {              // catálogo del taller: "Service 10.000 km", "Cambio de aceite", "Alineación"
  id                     String  @id @db.Uuid
  organizationId         String  @db.Uuid
  name                   String  @db.VarChar(120)
  nextServiceAfterMonths Int?    // CHECK 1..60; null = este trabajo no fija próximo service
  isActive               Boolean @default(true)
  createdAt, updatedAt, deletedAt
  @@map("service_job_types")
}

model ServiceOrderJobType {         // los tipos de una orden (D5)
  organizationId   String @db.Uuid
  serviceOrderId   String @db.Uuid
  serviceJobTypeId String @db.Uuid
  @@id([serviceOrderId, serviceJobTypeId])
  @@map("service_order_job_types")
}
```

**Por qué un catálogo propio y no el `ServiceType` de la agenda (D4).**
`ServiceType` (`schema.prisma:2178`) es un turno reservable: tiene sucursal,
recurso y duración obligatorios. Usarlo para calcular el próximo service
obligaría al taller a armar recursos de agenda aunque no use turnos, y mezclaría
"cuánto dura el turno" con "cada cuánto vuelve". El precedente de clínicas
(`followUpAfterDays`) funcionó porque en una clínica todo pasa por un turno, y
en el taller no.

El intervalo es **en meses**, no en km (§6.6).

### 2.7 Fotos

```prisma
enum ServiceOrderPhotoPhase { ANTES DESPUES }

model ServiceOrderPhoto {
  id             String   @id @db.Uuid
  organizationId String   @db.Uuid
  serviceOrderId String   @db.Uuid
  phase          ServiceOrderPhotoPhase
  storagePath    String   @db.VarChar(500)
  position       Int
  uploadedById   String   @db.Uuid
  createdAt      DateTime @default(now())
  @@map("service_order_photos")
}
```

Detalle en §4.9.

### 2.8 Contactos: unir y borrar

Las tablas con FK a `contacts` son `customer_vehicles`, `service_orders`,
`customer_vehicle_owner_changes` (dos FKs: `from_contact_id` y
`to_contact_id`) y `service_messages` (§6.3).

- **Unir contactos** (`contactMerge.service.ts`): todas se suman a
  `FKS_A_CONTACTS`, al conteo de `aMover` y a `movidos`, con su etiqueta en
  `frontend/src/features/contact/merge.ts`. Los vehículos y las órdenes del
  contacto absorbido pasan al que queda.
- **Borrado completo de datos personales** (`contact.service.ts:716`), D14:
  - borra los objetos de Storage de las fotos de sus órdenes y sus filas;
  - anonimiza matrícula, chasis y notas de sus vehículos, y la nota de sus
    filas en `customer_vehicle_owner_changes`;
  - vacía `damageNotes` y `notes` de sus órdenes, y cancela sus envíos
    pendientes.
  - Las órdenes quedan, sin datos personales, para que los contadores del
    taller no cambien.
  - Lo fija un caso nuevo de `borradoCompleto.integration-test.ts`.
- **Contacto con soft delete:** su vehículo no recibe recordatorios. El
  barrido filtra `contacts.deleted_at IS NULL`.

---

## 3. Estados de la orden

### 3.1 El set final

| Estado | Rótulo | Qué significa |
|---|---|---|
| `AGENDADO` | Agendado | Se acordó que el auto viene. Tiene fecha esperada. |
| `RECIBIDO` | Recibido | El auto está en el taller. Se registran km y daños al ingreso. |
| `EN_TRABAJO` | En trabajo | Se está trabajando. |
| `ESPERANDO_APROBACION` | Esperando aprobación | Apareció un trabajo extra y se le consultó al cliente. |
| `LISTO_PARA_RETIRAR` | Listo para retirar | Terminado; falta que el cliente lo retire. |
| `ENTREGADO` | Entregado | El cliente lo retiró. Se fija el próximo service. **Final.** |
| `CANCELADO` | Cancelado | No se hizo. **Final.** |

### 3.2 Transiciones permitidas

| Desde | Hacia |
|---|---|
| (alta) | `AGENDADO` o `RECIBIDO` (un auto que llega sin turno) |
| `AGENDADO` | `RECIBIDO`, `CANCELADO` |
| `RECIBIDO` | `EN_TRABAJO`, `ESPERANDO_APROBACION`, `LISTO_PARA_RETIRAR`, `CANCELADO` |
| `EN_TRABAJO` | `ESPERANDO_APROBACION`, `LISTO_PARA_RETIRAR`, `CANCELADO` |
| `ESPERANDO_APROBACION` | `EN_TRABAJO`, `LISTO_PARA_RETIRAR`, `CANCELADO` (exige aprobación registrada, §2.5) |
| `LISTO_PARA_RETIRAR` | `ENTREGADO`, `EN_TRABAJO` (volvió a trabajo: el cliente reclamó algo antes de retirar) |

- **Una sola ruta,** `POST /api/servicios/ordenes/:id/estado`, con
  `{ desde, hacia, nota?, ... }`. `desde` es obligatorio: el cambio es
  condicional y, si alguien ya la movió, da 409.
- **Datos que pide cada transición:**
  - `RECIBIDO`: km al ingreso, obligatorio. También actualiza
    `customer_vehicles.mileage` si es mayor.
  - `CANCELADO`: el motivo.
  - `ENTREGADO`: la fecha del próximo service (§6.1).
- **ENTREGADO y CANCELADO son finales (D11).** Si se entregó por error, se
  corrige la fecha del próximo service en el vehículo. Reabrir agrega casos de
  borde con los recordatorios y los eventos ya disparados, y no se pidió.
- **La tabla vive en un solo objeto,** `TRANSICIONES` en
  `src/servicios/config/estados.ts`. Lo usan el service, la UI (los botones que
  se muestran) y un test que recorre todas las combinaciones.

### 3.3 Eventos

Cada cambio de estado emite, **en la misma transacción**, un
`service_order.status_changed`. Si el destino es `ENTREGADO`, emite además un
`service_order.delivered`. Detalle en §9.

---

## 4. Pantallas

Todas viven en `frontend/src/features/servicios/`. Cada ruta va envuelta en
`<ModuloRoute modulo="servicios">` y el menú filtra con `useModulo`.

**Ojo:** `tieneModulo` devuelve `true` cuando `me.modulos` no viene
(`frontend/src/auth/useModulo.ts:20`), para no romper con un backend viejo. Para
un módulo **activable** eso es al revés de lo que hace falta. El hook suma una
regla: un módulo de la lista `MODULOS_ACTIVABLES` del frontend exige estar
presente en `me.modulos`. Lleva su test.

### 4.1 Menú

Una entrada **"Taller"** con tres sub-entradas: Órdenes, Vehículos de clientes
y Configuración. Configuración la ve solo el ADMIN. Va en
`frontend/src/layout/MenuDeAutomotora.tsx`, con su módulo. Sin el módulo, el
snapshot del menú no cambia (§13).

### 4.2 Órdenes: tablero y lista

- **Tablero** (vista por defecto): una columna por estado abierto (Agendado,
  Recibido, En trabajo, Esperando aprobación, Listo para retirar).
  - Cada tarjeta muestra número, vehículo (marca, modelo, matrícula), cliente,
    encargado y cuánto hace que está en ese estado.
  - Mover una tarjeta abre el diálogo de la transición, porque casi todas piden
    algo. No se arrastra a una columna no permitida.
- **Lista** (alternativa): tabla con filtros por estado (incluidos Entregado y
  Cancelado), sucursal, encargado y fechas. Tiene búsqueda por matrícula,
  número de orden o cliente.
- **Filtro de sucursal** arriba, como en Reservas. El último valor queda
  recordado.
- **"Nueva orden":** elegir o crear el vehículo, buscando por matrícula (§4.5).
  El contacto se completa con el dueño, y se eligen sucursal, estado inicial
  (Agendado con fecha, o Recibido con km), tipos, notas y encargado.

### 4.3 Ficha de la orden

- **Cabecera:**
  - número, estado y los botones de las transiciones permitidas;
  - el vehículo, con link a su historial, y el cliente, con link a su ficha;
  - la sucursal, el encargado (editable) y el turno vinculado, si hay.
- **Ingreso:** km y daños al ingreso, más las fotos "Antes".
- **Trabajo:** tipos de service, Notas, Valor (monto y moneda) y fotos
  "Después".
- **Aprobaciones:** la lista y el botón "Registrar aprobación" (§2.5).
- **Historial:** los cambios de estado, con quién y cuándo.
- **Avisar al cliente:** el botón de §8.
- **Al entregar:** el diálogo muestra la fecha del próximo service propuesta
  (§6.1), editable, con la opción "Sin próximo service".

### 4.4 El turno de la agenda

`bookingId` es opcional. El taller puede usar la agenda (un `ServiceType`
"Service" con su recurso) o no usarla.

- **Vincular:** en la ficha, "Vincular turno" lista los turnos `CONFIRMED`
  futuros del contacto. Al vincular se completa `scheduledFor` con el horario
  del turno.
- **Desde la agenda:** en el detalle de un turno, "Crear orden de servicio" abre
  "Nueva orden" con contacto, sucursal, fecha y turno ya cargados.
- **Sin sincronización de estados.** En una automotora los turnos **no emiten
  eventos** (rubros §14.1: "un turno de una automotora no emite eventos al
  outbox"), y cambiar eso tocaría la agenda de todas. Si el turno se cancela,
  la orden no se entera sola: la ficha lo muestra ("El turno vinculado fue
  cancelado") porque lee el estado del turno al abrirla. El dashboard lista
  las órdenes Agendadas con turno cancelado.

### 4.5 Vehículos de clientes, búsqueda por matrícula e historial

- **Búsqueda por matrícula:** un campo único en la cabecera de "Vehículos de
  clientes" y en "Nueva orden".
  - Normaliza lo escrito (mayúsculas, sin espacios ni guiones) y busca por
    prefijo en `license_plate_norm`, y también en `vin` y por cliente.
  - Si no hay resultado, ofrece "Crear vehículo con esta matrícula".
- **Ficha del vehículo:**
  - datos y dueño, con link al contacto;
  - próximo service, editable, con "No recordar" (`remindersOptOut`);
  - fecha de compra y origen ("Vendido por nosotros", con link a la venta, o
    "Cargado a mano");
  - **"Cambiar dueño"** (§2.2.1) y el registro de los cambios. Si ya no es
    del cliente, la marca "Ya no es del cliente" con el motivo y, con
    PERMUTA, el link a la unidad del stock;
  - **historial de órdenes:** número, fecha de entrega, tipos, km al ingreso,
    valor y encargado, de la más nueva a la más vieja;
  - los recordatorios que salieron: fecha, plantilla y estado.

### 4.6 Ficha del contacto con sus vehículos

Una tarjeta "Vehículos" en la ficha del contacto, **solo con el módulo**. La
pide a `GET /api/servicios/vehiculos?contactId=`. Muestra cada vehículo con su
próximo service y su orden abierta, si tiene, y el botón "Agregar vehículo". Sin
el módulo, la ficha no monta la tarjeta ni hace el pedido.

### 4.7 Dashboard del taller

`GET /api/servicios/dashboard?branchId=` devuelve:

| Tarjeta | Qué cuenta |
|---|---|
| Autos en el taller | Órdenes en `RECIBIDO`, `EN_TRABAJO` o `ESPERANDO_APROBACION`, con el desglose por estado. |
| Listos para retirar | Órdenes en `LISTO_PARA_RETIRAR`, con la más antigua ("hace 6 días"). |
| Esperando aprobación hace más de 24 h | Para que no queden colgadas. |
| Próximos services vencidos | Vehículos con `next_service_due_on < hoy`, sin orden abierta ni `remindersOptOut`. Es la lista para llamar. |
| Próximos services en 30 días | Ídem, entre hoy y hoy + 30. |
| Recambios próximos (§7) | Vehículos cuya fecha de recambio cae en los próximos 90 días, y cuántos no tienen fecha de compra. |
| Recambios vencidos sin contactar (§7.4) | Vehículos cuyo aviso de recambio ya pasó **fuera** de la ventana de 7 días del barrido y nadie los contactó. Incluye las ventas viejas cargadas al activar. Link a la lista. |
| Agendados con turno cancelado | §4.4. |

- "Hoy" es en la zona de la organización (`zonedWindow.ts`). Las fechas
  `@db.Date` se comparan como fechas, no como instantes.
- **Dónde se ve:** una pantalla "Taller" propia y, en el inicio, un bloque con
  las tres primeras tarjetas **solo con el módulo**.
- Todas las tarjetas de vehículos cuentan solo vehículos **vigentes** (§2.2). El inicio de una
  organización sin el módulo no cambia.

### 4.8 Configuración (ADMIN)

- Tipos de service: nombre, "Próximo service a los N meses" y Activo.
- Intervalo por defecto, para una orden sin tipos con intervalo.
- "Primer service de un auto vendido, a los N meses de la venta"
  (`firstServiceAfterMonths`, §6.1). Activado, con N = 12 provisorio.
- Los recordatorios y el recambio **no se configuran acá:** son reglas de
  Automatizaciones (§6, §7). La pantalla tiene un link "Configurar
  recordatorios" que abre Automatizaciones con el evento ya elegido.

### 4.9 Fotos: dónde, límites, privacidad y borrado

- **Dónde:** Supabase Storage, en un bucket privado nuevo,
  `service-order-photos`.
  - Reusa `src/lib/supabaseStorage.ts` (`BucketSpec`, `ensureBucket`,
    `uploadObject`, `removeObject`, `createSignedReadUrls`) y el patrón de
    `vehiclePhoto.service.ts` / `vehiclePhotoUpload.ts`.
  - Ruta del objeto: `{organizationId}/{serviceOrderId}/{photoId}.{ext}`.
- **Límites (D10):**
  - 5 MB por foto, JPEG, PNG o WebP: los mismos de las fotos de stock
    (`src/utils/vehiclePhoto.ts`). Valida multer y lo repite el bucket
    (`fileSizeLimit`, `allowedMimeTypes`).
  - **Hasta 10 "Antes" y 10 "Después" por orden.** Al pasarse, 409
    `LIMITE_DE_FOTOS`. El tope se cuenta dentro de la transacción del alta,
    con lock de la orden.
  - Una foto por request (`files: 1`), como las de stock. En el celular se
    suben de a una, con la cámara.
- **Privacidad:**
  - el bucket es privado y no hay URLs públicas;
  - se leen con URLs firmadas de 1 hora, generadas al responder y nunca
    guardadas;
  - las fotos **no se mandan a ningún tercero**: ni al agente, ni a Meta, ni a
    Google.
  - Pueden mostrar la matrícula y objetos personales del interior: se suma una
    fila en `docs/data-classification.md`.
  - Cualquier usuario de la organización que ve la orden ve sus fotos.
- **Borrado:**
  - **Una foto:** primero el objeto en Storage, después la fila, como
    `vehiclePhoto.service.ts`. Si Storage falla, la fila queda y se reintenta.
    Lo puede borrar quien la subió o un ADMIN.
  - **Borrado completo del contacto:** §2.8.
  - **Organización purgada:** el script de purga suma el bucket a lo que
    limpia.
  - **Retención automática:** ninguna en esta versión (D10).

---

## 5. De la venta al vehículo del cliente

**El problema:** hoy, al ganar una oportunidad con una unidad vinculada, la
unidad pasa a `SOLD` (`opportunity.service.ts:254`, `:460`, `:783`) y queda la
fecha `Opportunity.actualCloseDate` (el "hoy" de la organización, `:302`). Nada
más. `opportunity.won` ya tiene **un** consumidor, el despachador de
automatizaciones, y el registro de handlers no admite dos por evento
(`outboxHandlers.ts`: "registrar dos veces el mismo eventType LANZA").

**La propuesta (D2): un barrido, sin tocar el código de oportunidades.** Un
worker nuevo, `vehiculosVendidosWorker`, corre cada 15 minutos, solo sobre
organizaciones con `servicios` activado:

```sql
-- por organización con el módulo
select o.id, o.contact_id, o.vehicle_id, o.actual_close_date, v.*
from opportunities o join vehicles v on v.id = o.vehicle_id
where o.status = 'WON' and o.vehicle_id is not null and o.contact_id is not null
  and o.deleted_at is null
  and not exists (select 1 from customer_vehicles cv
                  where cv.organization_id = o.organization_id
                    and cv.source_vehicle_id = o.vehicle_id and cv.deleted_at is null
                    and cv.ownership_ended_at is null)
```

- **Por cada fila** crea un `CustomerVehicle` con marca, modelo, año,
  matrícula, chasis y km de la unidad, más:
  - `contactId` de la oportunidad;
  - `branchId` de la unidad;
  - `purchasedOn = actualCloseDate`;
  - `sourceVehicleId` y `sourceOpportunityId`.
- **Idempotente:** lo garantiza el único parcial de `source_vehicle_id`
  (`ON CONFLICT DO NOTHING`).
- **Primer service (D6):** si la venta es **posterior a la activación** del
  módulo (`actualCloseDate >= organization_modules.enabled_at`, en la zona de
  la organización) y `firstServiceAfterMonths` no es null, el vehículo nace con
  `nextServiceDueOn = purchasedOn + N meses`. Detalle en §6.1.
- **Ya existe un vehículo vigente con esa matrícula** (el cliente traía el auto al
  taller antes de que la venta se registrara): no se crea otro. Se completan
  `sourceVehicleId`, `sourceOpportunityId` y `purchasedOn` del existente, si
  estaban vacíos.
- **No cambia nada para quien no tiene el módulo:** el código de oportunidades
  no se toca y el barrido no mira su organización.
- **Ventas anteriores a la activación (D3):** la misma consulta las encuentra
  la primera vez, así que **se cargan solas**. Son la base del recambio (§7).
  Al activar, la pantalla de Plataforma avisa "Se van a crear N vehículos de
  clientes a partir de ventas anteriores".
- **Una venta que deja de estar ganada** (vuelve a OPEN o pasa a LOST):
  - el vehículo se borra (soft) si no tiene órdenes;
  - si tiene órdenes, queda, y se agrega una nota en el contacto.
  - Lo hace el mismo barrido, con la consulta inversa.
- **Permutas:** el mismo barrido marca "ya no es del cliente" a los vehículos
  que entraron al stock (§2.2.1). Va en S10.
- **ESENCIAL:** "Vendida" es `WON` (ediciones §3), así que funciona igual.
- **Fecha de la venta y no de la entrega.** La entrega solo existe en COMPLETA
  y muchas quedan sin confirmar. La venta existe en las dos ediciones.

**Alternativas descartadas:**

- **Crear el vehículo en la transacción de ganar:** mete una rama por módulo en
  una transacción de dominio, lo que ediciones D7 descartó por la misma razón.
- **Un botón manual "Pasar a cliente":** depende de que alguien se acuerde, que
  es justo el problema que el módulo viene a resolver.

---

## 6. Recordatorio del próximo service

Es el corazón del módulo.

### 6.1 Cálculo de la fecha

Al **entregar** una orden:

1. Entre los tipos de la orden con `nextServiceAfterMonths`, se toma **el
   menor**. Si dos trabajos fijan plazos distintos, manda el que vence antes.
2. Si ninguno tiene intervalo, se usa `workshop_settings.defaultNextServiceMonths`.
   Si también es null, no se propone fecha.
3. Fecha propuesta = fecha de entrega, en la zona de la organización, + N
   meses. Si el día no existe en ese mes, se usa el último día del mes.
4. El diálogo de entregar la muestra editable, con "Sin próximo service". Lo
   que se confirma se guarda en `service_orders.next_service_due_on` y se
   **copia** al vehículo (`customer_vehicles.next_service_due_on` y
   `next_service_set_from_order_id`).

**A mano:** en la ficha del vehículo, la fecha se edita en cualquier momento, y
`next_service_set_from_order_id` queda en null. Sirve para un vehículo cargado
a mano, o recién vendido, que nunca pasó por el taller.

**Primer service de un auto vendido (D6).** Lo fija el barrido de §5 cuando
crea el vehículo:

- `nextServiceDueOn = purchasedOn + firstServiceAfterMonths` meses, con la
  misma regla de fin de mes. `nextServiceSetFromOrderId` queda en null.
- **Solo ventas posteriores a la activación:** `actualCloseDate` mayor o igual
  que la fecha de `organization_modules.enabled_at`, en la zona de la
  organización. Si el módulo se desactiva y se reactiva, cuenta la **primera**
  activación (`enabled_at` no cambia al reactivar). Las ventas del período en
  que estuvo apagado reciben el primer service igual.
- **Las ventas anteriores a la activación no reciben fecha.** Entran como
  vehículos de clientes (para el recambio), sin recordatorio hasta su primera
  orden o hasta que alguien cargue la fecha a mano. Un auto vendido hace tres
  años no necesita un "primer service".
- **Configuración:** `workshop_settings.firstServiceAfterMonths`, default **12**
  (provisorio) y editable por el ADMIN. En null, no se fija. Cambiarla no
  recalcula los vehículos que ya tienen fecha.
- Si el vehículo ya existía (el cliente lo traía al taller) y tiene fecha, no
  se pisa.

### 6.2 El evento: `service.next_service_due`

El vehículo es la fuente de verdad (una fecha por vehículo), y se usa el patrón
de **barrido de estado** de `opportunityStaleWorker` / `inquiryStalledWorker`:

- **Trigger nuevo**, `service.next_service_due`, rótulo "Cuando se acerca o
  vence el próximo service". Su módulo es `servicios` en `MODULO_DEL_TRIGGER`,
  y no es de regla única.
- **Configuración del trigger:** `offsetDays`, de −60 a +90. Por ejemplo, −7 es
  "una semana antes" y +15 es "15 días después de vencido".
  - **Puede haber varias reglas.** Así una concesionaria arma la secuencia que
    quiera: un aviso una semana antes y otro a los 15 días si no vino.
- **El barrido** es un worker diario por organización con el módulo, a las 10:00
  de su zona. Para cada regla activa busca los vehículos con
  `next_service_due_on + offsetDays ∈ [hoy − 7, hoy]` que cumplen:
  - `remindersOptOut = false`, el vehículo vigente y el contacto vigente y sin
    "sin interés";
  - **sin una orden abierta del vehículo** (§6.5);
  - sin un aviso previo para ese **(regla, vehículo, fecha de service)** en
    `customer_vehicle_notices` (§6.3).
- **El margen de 7 días** cubre una caída del worker o un día sin correr, sin
  mandar recordatorios de hace meses.
- **Por cada vehículo** inserta el aviso en `customer_vehicle_notices` y emite
  el evento al outbox **en la misma transacción**. Si el insert choca con el
  único, no emite: así un barrido repetido no duplica. El payload es
  `{ customerVehicleId, contactId, branchId, nextServiceDueOn, automationId }`.
- **El despachador corre las acciones** de la regla. Lo de abajo es lo que
  hacen.

### 6.3 Acciones y cola de envío

| Acción | Rótulo | Qué hace |
|---|---|---|
| `service.send_next_service_reminder` | "Mandar recordatorio por WhatsApp" | Encola un mensaje con la plantilla de la regla. |
| `activity.create_follow_up` (existente, suma el trigger) | "Crear tarea" | Crea una tarea "Llamar a {cliente} por el service de {vehiculo}". |

**La tarea:**

- Su asignado sigue este orden: el encargado de la última orden del vehículo,
  después el responsable por defecto de la sucursal (`Branch.defaultOwnerId`) y
  por último el ADMIN activo más antiguo.
- Lleva `activities.source_notice_id` (el aviso de abajo), con un índice
  único parcial: una sola tarea por aviso, o sea por (regla, vehículo, fecha).
  Es el mismo patrón que `activities.source_booking_id` de clínicas (rubros
  §7.3).

**El registro de avisos** es lo que hace idempotentes a los dos barridos (este y
el de recambio, §7), sin depender de qué acciones tenga la regla:

```prisma
enum CustomerVehicleNoticeKind { NEXT_SERVICE REPLACEMENT }
enum CustomerVehicleNoticeSource { AUTOMATICO MANUAL }

model CustomerVehicleNotice {
  id                String   @id @db.Uuid
  organizationId    String   @db.Uuid
  customerVehicleId String   @db.Uuid
  kind              CustomerVehicleNoticeKind
  dueOn             DateTime @db.Date     // la fecha de service, o la de recambio, que se avisa
  source            CustomerVehicleNoticeSource
  automationId      String?  @db.Uuid     // con AUTOMATICO (CHECK)
  createdById       String?  @db.Uuid     // con MANUAL (CHECK): quien marcó "contactado" (§7.4)
  createdAt         DateTime @default(now())
  @@map("customer_vehicle_notices")
}
```

- Hay dos únicos parciales: `(automation_id, customer_vehicle_id, kind,
  due_on)` con AUTOMATICO, y `(customer_vehicle_id, kind, due_on)` con MANUAL.
- **No tiene FK a `contacts`:** el contacto sale del vehículo, así que no
  entra al inventario de `contactMerge`.

**La cola** es una tabla nueva propia del módulo, con el patrón de
`BookingMessage` (reclamar, reintentar, cancelar):

```prisma
enum ServiceMessageKind { NEXT_SERVICE }   // REPLACEMENT (§7) y REVIEW_QR (§9) entran con sus PR y su migración, si se piden

model ServiceMessage {
  id                String   @id @db.Uuid
  organizationId    String   @db.Uuid
  kind              ServiceMessageKind
  automationId      String   @db.Uuid      // la regla: de ahí sale la plantilla
  noticeId          String?  @db.Uuid      // el aviso que lo originó (NEXT_SERVICE, REPLACEMENT)
  customerVehicleId String?  @db.Uuid
  serviceOrderId    String?  @db.Uuid      // en REVIEW_QR
  contactId         String   @db.Uuid
  branchId          String?  @db.Uuid      // de qué número sale
  dueKey            DateTime? @db.Date     // la fecha de service (o de recambio) que se recuerda
  scheduledFor      DateTime
  status            BookingMessageStatus   // reusa PENDING/SENT/FAILED/CANCELLED
  attempts          Int      @default(0)
  nextAttemptAt     DateTime?
  lastError         String?  @db.VarChar(500)
  cancelReason      String?  @db.VarChar(200)
  sentAt            DateTime?
  externalMessageId String?
  createdAt, updatedAt
  @@map("service_messages")
}
```

- **Idempotencia:** único parcial `(notice_id)` `WHERE status IN
  ('PENDING','SENT')`: un mensaje por aviso. Lo enviado no se reenvía y una
  reentrega del evento no duplica.
- **Envío:**
  - un worker propio, `serviceMessagesWorker`, dentro del horario de la
    sucursal: si está cerrada, se pospone sin gastar el intento, como el de R13;
  - reusa `sendWhatsappTemplateReal` y `findApprovedWhatsappTemplate`, sin
    copiarlos;
  - sale del número de WhatsApp de la sucursal de referencia del vehículo y, si
    no tiene, del de la organización (como los demás envíos de automotora).
- **Revalidación antes de enviar.** Se cancela, con el motivo, si:
  - el módulo está desactivado;
  - la fecha del vehículo cambió (ya no es `dueKey`);
  - el contacto del mensaje ya no es el dueño del vehículo, o el vehículo dejó
    de estar vigente (§2.2.1);
  - hay una orden abierta;
  - se marcó "no recordar";
  - el contacto está borrado o "sin interés";
  - no tiene WhatsApp.
- **Sin WhatsApp (D8):** la fila queda `CANCELLED` con "sin WhatsApp". Si la
  regla tiene la casilla "Si no tiene WhatsApp, crear tarea para llamar"
  (default activada), se crea la tarea de arriba aunque la regla no tenga esa
  acción.
- `last_error` va sin tokens y cortado a 500 caracteres, como en
  `booking_messages`.

### 6.4 La plantilla

- **Una plantilla por regla,** como hoy (`WhatsappTemplate.automationId`), con
  la sincronización con Meta de siempre (`sincronizarPlantillaDeLaRegla`).
- **La automotora usa el WABA global**, como hoy (rubros §6.3).
- **Categoría `MARKETING` (D7).** Un recordatorio de mantenimiento que el
  cliente no pidió es una invitación a volver, no la continuación de una
  transacción. Meta puede recategorizarlo, y el control de clínicas (R14) ya
  se tomó como marketing. Consecuencia: un cliente que apagó el marketing en
  WhatsApp no lo recibe. Antes del primer cliente hay que confirmar la
  categoría y la tarifa vigente para Uruguay.
- **Variables:**
  - `{nombre}`;
  - `{vehiculo}`: marca y modelo;
  - `{matricula}`: vacía si no tiene;
  - `{lugar}`: la concesionaria, o "Concesionaria (sucursal X)" si tiene más de
    una, como el `{lugar}` de R13;
  - `{fecha}`: "el 15 de noviembre".
  - Se registran en `variablesDeLaAccion` (`whatsappTemplate.service.ts:276`).
- **Borrador sugerido:** "Hola {nombre}, se acerca el service de tu
  {vehiculo}. Si querés agendarlo, respondé este mensaje y te damos un turno en
  {lugar}." Sin botones en la v1.
- **La respuesta** entra a la bandeja como cualquier mensaje.
  - Sin agente, o con un nivel que no conversa, se deriva a una persona
    (ediciones §4).
  - Con un agente AUTONOMA responde el agente, que en esta fase **no tiene
    tools del taller** (§12). Puede dar un turno con `create_booking`, pero no
    crea la orden.

### 6.5 Qué pasa si el cliente ya agendó (D6)

Regla simple, que el barrido y el worker aplican igual: **un vehículo con una
orden abierta (de AGENDADO a LISTO_PARA_RETIRAR) no recibe recordatorio.**

- Si el cliente llamó y agendó, la persona crea la orden en Agendado y el
  recordatorio no sale. Si estaba encolado, se cancela al revalidar.
- **Lo que no detecta:** un turno de la agenda sin orden. En una automotora el
  turno no sabe de qué vehículo es (`Booking` no tiene vehículo), y adivinarlo
  por contacto falla con un cliente de dos autos. Por eso "Crear orden de
  servicio" se ofrece desde el turno (§4.4), y la guía de uso dice: "agendá el
  service con una orden".
- **Al entregar,** la fecha nueva reemplaza la vieja. Los envíos encolados de la
  fecha vieja se cancelan al revalidar, porque `dueKey` ya no coincide.

### 6.6 Lo que no hace esta versión

- **Recordatorio por km:** necesita el km actual del auto, que el taller no
  sabe entre services. Queda para cuando se pida, con su columna.
- **Recordatorios por otros canales** (email, SMS).
- **Respuesta con botones** ("Quiero agendar"): el patrón existe (R13), pero se
  suma solo si la respuesta libre no alcanza.

---

## 7. Aviso de recambio

Puede ir en una fase posterior. Queda diseñado.

### 7.1 Cálculo

- **Fecha de recambio** = `purchasedOn` + `monthsAfterPurchase` (en la
  configuración del trigger; default 48 meses).
- **Sin `purchasedOn` (D12): no hay evento.** El dashboard muestra "N vehículos
  sin fecha de compra" con un link a la lista filtrada, para que el equipo la
  complete.
  - Estimarla desde el año del modelo se descarta como default. Un auto 2019
    comprado usado en 2023 dispararía el aviso cuatro años antes de tiempo, y
    un falso aviso de recambio le quema al vendedor la llamada.
- **Una vez por vehículo y por fecha de recambio** (`customer_vehicle_notices`
  con `kind = REPLACEMENT` y `dueOn` = fecha de recambio). Si cambia la fecha
  de compra, cambia la de recambio y puede volver a salir. Un cambio de dueño la
  limpia (§2.2.1), así que no sale hasta que alguien cargue la nueva.

### 7.2 El evento: `service.replacement_due`

- **Trigger nuevo**, rótulo "Cuando se acerca el recambio de un vehículo", en el
  módulo `servicios`. **De regla única**, porque es una política de la
  organización.
- **Configuración del trigger:**
  - `monthsAfterPurchase`: de 12 a 120, default 48;
  - `daysBefore`: cuántos días antes de la fecha avisar; de 0 a 180, default 60.
- **El barrido** es el mismo worker diario de §6.2. Elige vehículos con
  `purchasedOn + monthsAfterPurchase − daysBefore ∈ [hoy − 7, hoy]` que cumplen:
  - vehículo y contacto vigentes, y contacto sin "sin interés";
  - **sin una oportunidad OPEN del contacto**: si ya está comprando, no hace
    falta avisar;
  - sin un aviso previo (automático o manual) para ese vehículo y esa fecha de
    recambio.
  - Como en §6.2, inserta el aviso y emite el evento en la misma transacción.
- **Payload:** `{ customerVehicleId, contactId, branchId, purchasedOn, replacementDueOn }`.

### 7.3 Acciones

| Acción | Qué hace |
|---|---|
| `activity.create_follow_up` (suma el trigger) | Tarea "Contactar a {cliente}: se acerca el recambio de su {vehiculo} (comprado el {fecha})". |
| `service.send_replacement_message` (fase posterior, con su migración del valor `REPLACEMENT`) | Plantilla `MARKETING` al cliente, por la cola de §6.3. |

**A quién va la tarea (D13):**

1. al vendedor del contacto (`Contact.ownerId`);
2. si no tiene, al vendedor de la venta de origen (`sourceOpportunityId → ownerId`);
3. si no, al responsable por defecto de la sucursal;
4. si no, al ADMIN activo más antiguo.

Es un aviso **para ventas**, no para el taller.

Cada concesionaria decide qué hacer: solo la tarea, la tarea y la plantilla, o
nada (sin regla no pasa nada).

### 7.4 Recambios vencidos sin contactar

El barrido solo mira una ventana de 7 días (§7.2), así que hay vehículos cuyo
aviso de recambio ya pasó y que **nunca** van a entrar. Son, sobre todo:

- las ventas viejas cargadas al activar el módulo (§5);
- los vehículos a los que se les cargó la fecha de compra tarde;
- los que estaban en una organización sin regla de recambio.

Para ellos va una tarjeta del dashboard (§4.7) y una lista,
`GET /api/servicios/recambios?estado=vencidos`.

**Qué cuenta como "vencido sin contactar".** Un vehículo vigente (§2.2) con
`purchasedOn` que cumple:

1. **Fecha de aviso** = `purchasedOn + monthsAfterPurchase − daysBefore`, con
   la configuración de la regla de recambio si hay una. Si no hay regla, con los
   defaults (48 meses y 60 días), para que la lista sirva antes de armarla.
2. La fecha de aviso es **anterior a hoy − 7**: ya quedó afuera de la ventana
   del barrido.
3. No tiene ningún aviso (`customer_vehicle_notices`, automático o manual) de
   `kind = REPLACEMENT` para esa fecha de recambio.
4. El contacto está vigente, no tiene "sin interés", no tiene una oportunidad
   **OPEN** y no tiene una oportunidad **creada después de la fecha de aviso**.
   Si ya hubo una conversación comercial, no hace falta contactarlo.

**La lista** muestra cliente, vehículo, fecha de compra, fecha de recambio,
vendedor del contacto y hace cuánto venció, de la más vieja a la más nueva.
Tiene dos acciones por fila, más una para varias filas seleccionadas:

- **"Crear tarea al vendedor":** la misma tarea de §7.3, con la misma cadena de
  asignación.
- **"Marcar como contactado"** (alguien ya lo llamó).
- Las dos registran un aviso `MANUAL` con `createdById`
  (`POST /api/servicios/vehiculos/:id/avisos`) y el vehículo sale de la lista.

**Por qué no se los manda al barrido:** activar el módulo en una concesionaria
con diez años de ventas dispararía cientos de tareas o plantillas el primer día.
La lista deja que el equipo decida a quién llamar y a qué ritmo.

Va en **S13**, junto con el trigger. Lee `customer_vehicle_notices`, que entra
con la migración de S6.

---

## 8. Avisos al cliente hechos por una persona

Por la decisión 6, "listo para retirar" lo manda una persona. Hay tres ayudas,
de menor a mayor costo.

### 8.1 v1: "Avisar al cliente" con texto sugerido

En la ficha de la orden, con estado Listo para retirar, Esperando aprobación o
Recibido:

- **Botón "Avisar al cliente":** abre la conversación de WhatsApp del contacto
  con el cuadro de respuesta **ya completado** con un texto del estado. Por
  ejemplo: "Hola {nombre}, tu {vehiculo} ya está listo para retirar en
  {sucursal}. Te esperamos de {horario}."
  - La persona lo revisa, lo edita y lo manda: el envío es el de siempre
    (`responderDesdeElCrm`).
  - Requiere un parámetro de borrador inicial en `ConversationReplyCard`
    (`frontend/src/features/conversation/ConversationReplyCard.tsx`, que ya
    tiene borrador local). No hay ningún mecanismo de "texto sugerido" en la
    bandeja hoy.
  - Los textos por estado los edita el ADMIN en Configuración, con defaults.
- **Ventana de 24 h cerrada,** que es lo más común, porque el cliente dejó el
  auto y no escribió:
  - la pantalla lo dice antes de abrir ("Pasaron más de 24 h desde el último
    mensaje del cliente: WhatsApp no deja mandar texto libre") y ofrece **copiar
    el texto** y **llamar**;
  - la ventana se lee con `ventanaDeWhatsappAbierta`
    (`src/utils/ventanaDeWhatsapp.ts:27`), la misma que bloquea el envío con
    409 (`conversationReply.service.ts:217`).
- **Sin conversación:** el botón ofrece copiar y llamar.
- **Registro:** al mandarlo desde la conversación queda en la conversación. La
  orden suma una nota "Aviso enviado por {persona}".

### 8.2 Fase posterior: plantilla manual de un clic (decisión sin número de §14)

Con la ventana cerrada, el botón manda una plantilla aprobada ("Tu {vehiculo}
está listo para retirar en {lugar}"), **disparada por la persona**. Es el
mismo patrón que el cupón manual (`discountVoucherManual.service.ts`, que ya
manda una plantilla fuera de la ventana desde la ficha).

- **Hace falta** un lugar donde vivan las plantillas que no cuelgan de una regla
  automática: hoy `WhatsappTemplate` cuelga siempre de una regla.
- **Categoría `UTILITY`:** es la continuación de una transacción que el cliente
  inició.

Resuelve el caso más común, pero suma una pieza de plantillas nueva. Va
después, cuando la v1 muestre que hace falta.

### 8.3 Lo que no se hace

El envío automático al pasar a Listo para retirar está fuera por la decisión 6.
Con el evento `service_order.status_changed` (§9), cuando se decida es una
acción más, sin cambiar el modelo.

---

## 9. Eventos de la orden y reseña

| Trigger | Rótulo | Payload | Acciones |
|---|---|---|---|
| `service_order.status_changed` | "Cuando una orden de servicio cambia de estado" | `{ serviceOrderId, customerVehicleId, contactId, branchId, from, to }` | `activity.create_follow_up` |
| `service_order.delivered` | "Cuando se entrega una orden de servicio" | ídem, más `deliveredAt` | `activity.create_follow_up` (y `service_order.send_qr_review` solo si se pide, S9) |

- **Filtro de estado:** `status_changed` tiene configuración `toStatuses` (los
  estados destino que disparan). Por ejemplo, "cuando pasa a Esperando
  aprobación hace más de…" no entra: es un barrido, no un cambio, y queda para
  después.
- **La reseña (decisión de Rocco, 2026-10-13): la configura cada concesionaria
  con lo que ya existe.** El módulo solo aporta el evento "Orden entregada"
  (S8). Con él, hoy se puede enganchar una **tarea** ("Pedirle la reseña a
  {cliente}"), con la que una persona manda el link o el QR de la sucursal.
  **Lo que no se puede enganchar sin código nuevo es el envío automático del
  QR**, por lo que sigue. Si se pide, eso es S9:
- **El seguimiento de reseña de hoy** es `opportunity.send_qr_followup` y
  cuelga de `opportunity.won`.
  - Su fila (`QrFollowUp`) tiene `opportunityId` NOT NULL, y el worker cancela
    si la oportunidad ya no está WON. **No se puede enganchar a una orden sin
    tocarla**, y rubros §1.3 descartó hacer nullable esa columna.
  - Por eso el envío automático necesitaría **una acción nueva**,
    `service_order.send_qr_review` (S9, solo si se pide):
    - tiene la misma configuración que la de hoy: QR, demora y texto con
      `{nombre}`/`{link}`;
    - usa la cola de §6.3 con `kind = REVIEW_QR`, que entra con su migración;
    - reusa el envío del núcleo con el header de imagen del QR;
    - antes de enviar revalida que la orden siga ENTREGADO.
  - Es lo que hizo clínicas con `booking.send_qr_review` (rubros §7.1).
- **Tareas:** `activity.create_follow_up` delega, con un evento de orden, en
  `src/servicios/tareaDeLaOrden.ts`.
  - La tarea va al encargado de la orden y, si no hay, al responsable de la
    sucursal.
  - Lleva `activities.source_service_order_id`, con un único parcial por
    (regla, orden).
- **Catálogo y tests.** Sumar triggers y acciones rompe, a propósito, los tests
  de catálogo:
  - `automationActions.test.ts:83-110` (`TRIGGERS_CONOCIDOS`,
    `MODULO_DEL_TRIGGER`, `TRIGGERS_DE_REGLA_UNICA`);
  - `automationOpportunityWon.integration-test.ts`;
  - `frontend/src/features/automation/catalog.test.ts`;
  - los de `whatsappTemplate.service` (`ACCIONES_CON_PLANTILLA`,
    `CATEGORIA_DE_LA_ACCION`, `PREFIJO_DEL_NOMBRE`).

  Se actualizan en el mismo PR. **El catálogo de una organización sin el módulo
  es el de hoy** (test en la suite "automotora sin cambios").

---

## 10. Roles (D9)

**Alcanzan los roles actuales.** ADMIN y USER, sin rol nuevo:

| Acción | ADMIN | USER |
|---|---|---|
| Ver órdenes, vehículos y dashboard del taller | ✅ todas | ✅ todas |
| Crear órdenes y vehículos, cambiar estado, registrar aprobaciones, subir fotos | ✅ | ✅ |
| Asignar el encargado | ✅ | ✅ |
| Borrar un vehículo del cliente | ✅ | ❌ |
| Borrar una foto | ✅ | ✅ las que subió |
| Configuración (tipos, intervalos, textos de aviso) | ✅ | ❌ |
| Reglas de automatización | ✅ | ❌ (como hoy) |

- **El "encargado de taller" es un dato de la orden** (`assigneeId`), no un rol:
  cualquier usuario activo de la organización puede serlo.
- **USER ve todas las órdenes (D9).** Un USER que es vendedor solo edita los
  contactos que tiene asignados (`permisosDelVendedor.ts`). Esa regla existe
  porque el vendedor es dueño de sus clientes, y en el taller nadie es dueño de
  un auto: es un equipo, como la recepción de una clínica (rubros §11.2).
- **Datos del contacto desde el taller:** "Nueva orden" puede crear un contacto
  nuevo, porque cualquier USER puede crear contactos. **No edita** un contacto
  ajeno: para eso se usa la ficha del contacto, con sus reglas de siempre.
- **Cuándo haría falta un rol "Taller":** cuando una concesionaria quiera que
  los mecánicos o el jefe de taller entren a la plataforma **sin ver ventas**
  (oportunidades, stock con costos, conversaciones de ventas). Se modelaría como
  `RECEPCION` en clínicas (rubros §11):
  - una fila en `roles`;
  - `ROLES_POR_RUBRO` de AUTOMOTORA condicionado al módulo;
  - capacidades en `permisos.ts`.
  - Es un PR de riesgo medio-alto, porque toca permisos de todo el sistema. **No
    va hasta que haya un pedido concreto.**

---

## 11. Plan de PRs

Los PR con 🗄 llevan migración y **quedan abiertos hasta que Rocco los
autorice**. Cada PR:

- trae su sección de la guía de uso: un archivo nuevo,
  `docs/guia-de-uso/15-servicios.md`, que `MODULO_DE_SECCION` asocia al módulo
  `servicios`, así que no se ve sin el módulo;
- suma su caso a la suite "sin el módulo, sin cambios" (§13);
- corre `npm run test:integration` entero antes de abrirse (checklist de tablas
  nuevas).

| # | PR | 🗄 | Riesgo | Contenido | Depende de |
|---|---|---|---|---|---|
| S0 | `docs: diseño del módulo Servicios` | — | Nulo | Este documento. | — |
| S1 | `feat(servicios): tablas del módulo` 🗄 | **Sí** | Bajo | `organization_modules`, `workshop_settings` (con `first_service_after_months`), `customer_vehicles` (con las columnas de fin de propiedad), `customer_vehicle_owner_changes`, `service_orders` (con su enum), `service_order_status_changes`, `service_order_approvals`, `service_job_types`, `service_order_job_types` y `service_order_photos`. CHECKs, índices y únicos parciales, RLS, H-01, fila 5 del diagnóstico, `verify:schema`, FKs a `contacts` en el inventario de `contactMerge`, catálogo de slugs. **Nadie las lee todavía:** inerte para todos. | — |
| S2 | `feat(servicios): activación y gate` | — | **Medio-alto** | `MODULOS_ACTIVABLES`, `modulosDe` con activados, `modulosActivados` en `AuthContext` (subconsulta en el mismo SELECT), gate con `motivo: "NO_ACTIVADO"`, `/me`, rutas de Plataforma para activar y desactivar, columna y acción en Plataforma → Organizaciones, regla de `useModulo` para activables, guía sección 14. Toca cada request autenticado: la suite de §13 es la red. | S1 aplicado |
| S3 | `feat(servicios): vehículos de clientes` | — | Medio | CRUD, búsqueda por matrícula, ficha con historial (vacío), **"Cambiar dueño" manual** (§2.2.1), tarjeta en la ficha del contacto, unir y borrado completo, guía. | S2 |
| S4 | `feat(servicios): órdenes de servicio` | — | Medio | Alta, tablero y lista, ficha, transiciones con historial, aprobaciones, tipos y configuración, vincular turno y "Crear orden" desde la agenda, fecha del próximo service al entregar (sin envío), guía. | S3 |
| S5 | `feat(servicios): fotos de la orden` | — | Medio | Bucket, subida, límites, firma y borrado, más el borrado completo y la purga. `data-classification.md`. | S4 |
| S6 | `feat(servicios): cola de mensajes y eventos` 🗄 | **Sí** | Bajo | `customer_vehicle_notices` (§6.3), `service_messages` (enum con `NEXT_SERVICE`) y `activities.source_notice_id` / `source_service_order_id` con sus únicos parciales. RLS, H-01, diagnóstico, `contactMerge`. Inerte. | S1 |
| S7 | `feat(servicios): recordatorio del próximo service` | — | **Medio-alto** | Trigger `service.next_service_due` y barrido diario, acción de plantilla y su worker, la tarea y "sin WhatsApp → tarea", revalidaciones de §6.3, catálogo de automatizaciones y sus tests, guía de automatizaciones. **Es el PR que justifica el módulo.** | S4, S6 aplicado |
| S8 | `feat(servicios): eventos de la orden` | — | Medio | `service_order.status_changed` y `service_order.delivered`, más la tarea de la orden. | S7 |
| S9 | `feat(servicios): reseña automática al entregar` 🗄 | Sí | Medio | Valor `REVIEW_QR` del enum y acción `service_order.send_qr_review`. **Solo si se pide** (§9): la reseña la configura cada concesionaria con lo que ya existe, enganchada al evento de S8. | S8 |
| S10 | `feat(servicios): vehículos desde las ventas` | — | Medio | Barrido de §5, primer service de las ventas posteriores a la activación (§6.1), aviso al activar con el conteo, reversa, y la detección de permutas (§2.2.1). | S3 |
| S11 | `feat(servicios): dashboard del taller` | — | Bajo | Endpoint, pantalla y bloque en el inicio con el módulo. | S4 (S13 le suma las tarjetas de recambio) |
| S12 | `feat(servicios): aviso al cliente con texto sugerido` | — | Bajo | §8.1: borrador inicial en `ConversationReplyCard`, textos por estado en la configuración, aviso de la ventana. | S4 |
| S13 | `feat(servicios): aviso de recambio` | — | Medio | Trigger `service.replacement_due` en el barrido diario, tarea con la cadena de asignación de §7.3, tarjetas "Recambios próximos" y **"Recambios vencidos sin contactar"** con su lista y sus acciones (§7.4). | S7, S10, S11 |
| S14 | `feat(servicios): plantilla de recambio al cliente` 🗄 | Sí | Medio | Valor `REPLACEMENT` y la acción. **Solo si se pide.** | S13 |
| — | Fase 3: agente | — | — | §12. Con su propio diseño. | — |

**Orden:**

1. S0.
2. S1 → autorización y aplicación → S2 → S3 → S4.
3. S5, S6 y S10 en paralelo. S6 es otra migración: conviene autorizarla junto
   con S4, para que S7 no espere.
4. S7, que es lo más importante y por lo que se vende el módulo.
5. S8, S11 y S12 en cualquier orden.
6. S13.
7. Solo si se piden: S9 y S14.

**Primer cliente real posible después de S7** (más S10 para que los vendidos
entren solos). De S1 a S6 se prueban en local, con una organización automotora
de prueba y el módulo activado.

**Dos migraciones grandes en lugar de una por PR**, como el PR 2 de ediciones:
se autorizan menos veces y cada una es inerte al aplicarse. S9 y S14 (los dos,
solo si se piden) agregan un
valor de enum cada una, cuando su código existe: un valor que el backend no
sabe ejecutar es una trampa (ediciones §1.2).

Antes de cada PR se repite `gh pr list --state open`.

---

## 12. Agente de IA: después (anotado, no diseñado)

**Fuera de la primera fase** (decisión 11). Queda anotado para cuando se diseñe:

1. **"¿Está listo mi auto?"** Una tool de **solo lectura**,
   `get_service_order_status`:
   - devuelve estado, sucursal y, con Listo para retirar, el horario de la
     sucursal;
   - **candado de identidad** (el de #444): solo las órdenes de vehículos cuyo
     dueño, o cuyo contacto de la orden, es el contacto identificado de la
     conversación. Nunca por una matrícula que escribió el cliente, porque una
     matrícula se ve en la calle;
   - no devuelve el Valor sin una decisión explícita: es plata, y el agente no
     tiene autoridad comercial (`INSTRUCCION_SIN_AUTORIDAD_COMERCIAL`);
   - entra en el filtro de tools por nivel (ediciones §6.1). Al ser de lectura,
     puede ir también en PRIMER_CONTACTO.
2. **Turno de service vinculado a la orden.** `create_booking` con un tipo de
   turno de taller crea, en la misma operación, la orden en Agendado para el
   vehículo que el cliente elige entre los suyos. Así la regla de §6.5 ("ya
   agendó") también cubre lo que agenda el agente.
3. **La respuesta al recordatorio** ("sí, quiero agendar") la atiende el agente
   con la tool del punto 2, según su nivel.

---

## 13. Riesgos, y cómo COMPLETA y ESENCIAL sin el módulo quedan idénticas

### 13.1 Garantías (suite "sin el módulo, sin cambios")

Un archivo propio, `src/servicios/sinElModuloSinCambios.test.ts`, y su par de
integración. Cada PR que toca el núcleo le suma su caso:

| Qué | Cómo se prueba |
|---|---|
| Catálogo | `modulosDe(e, r)` y `modulosDe(e, r, ∅)` son iguales a la lista fija de hoy para las cuatro combinaciones. `servicios` no está en ninguna. |
| Gate | En COMPLETA y ESENCIAL sin el módulo, cada ruta de `servicios` da 403 `NO_ACTIVADO`, y **todas las demás rutas** dan lo mismo que hoy: el barrido de `ediciones.integration-test.ts` que genera los casos desde `RUTAS_POR_MODULO`. Ese test hoy afirma que "en COMPLETA ninguna ruta da MODULO_NO_INCLUIDO" y **se ajusta a propósito** para excluir los módulos activables; un caso aparte afirma el 403. Es la red: el cambio queda a la vista en el diff. |
| Gate, clínica | Una clínica con una fila de `servicios` escrita a mano no tiene el módulo (403 `RUBRO`). |
| `/me` | Sin el módulo, `modulos` es idéntico al de hoy (snapshot por combinación). |
| Automatizaciones | El catálogo de triggers y acciones sin el módulo es el de hoy. Crear una regla con un trigger de servicios da el 400 de siempre. El despachador salta una regla de servicios si se desactivó el módulo. |
| Workers | El barrido diario, el de ventas y el de mensajes no seleccionan organizaciones sin la fila activa: un test con una organización sin el módulo y datos que matchearían no crea nada. |
| Oportunidades | No se tocan (§5). Ganar una oportunidad con unidad en una organización sin el módulo no crea ningún `CustomerVehicle`. |
| Contactos | Unir y borrar dos contactos sin vehículos ni órdenes da el mismo resultado y la misma respuesta que hoy. |
| Frontend | Snapshot del menú, del inicio y de la ficha del contacto sin el módulo: idénticos. Sin el módulo, la ficha del contacto no llama a `/api/servicios/*` (test con el mock de fetch). |
| Guía | Sin el módulo, la sección 15 no aparece en el índice ni en el buscador. |

### 13.2 Riesgos

| Riesgo | Mitigación |
|---|---|
| **El gate toca cada request** (S2). Un error deja a todos sin acceso, o a todos con el módulo. | El parámetro nuevo falla cerrado. El atajo de COMPLETA + AUTOMOTORA solo agrega una condición sobre un set constante. El barrido de rutas de las dos ediciones corre en el CI. |
| `useModulo` devuelve `true` sin `modulos` (`useModulo.ts:20`): con un backend viejo, el menú mostraría Taller a todos. | Regla explícita para activables (§4) con su test. Igual el backend da 403. |
| La subconsulta de `organization_modules` en `findUserForAuth` le suma costo al login de todos. | Usa la PK `(organization_id, module)` y es parte de un SELECT que ya se cachea 5 s. Se mide en el PR con `EXPLAIN`. |
| **Categoría de la plantilla.** Meta puede tratar el recordatorio como marketing o recategorizarlo. | Se asume MARKETING desde el principio (D7). Verificar la tarifa de Uruguay antes del primer cliente. |
| **Recordatorio a alguien que ya no tiene el auto** (lo vendió). | "No recordar" en el vehículo, y la respuesta del cliente llega a una persona. El cambio de dueño se registra editando el contacto. |
| **Dos recordatorios que se pisan** (varias reglas con offsets cercanos). | Idempotencia por (regla, vehículo, fecha). La pantalla de Automatizaciones muestra las reglas del mismo trigger juntas. |
| **El barrido de ventas crea vehículos que nadie esperaba** al activar (cientos de ventas viejas). | Aviso con el conteo antes de confirmar la activación (§5). Son datos que la concesionaria ya cargó. No reciben primer service (§6.1) ni entran al barrido de recambio: van a la lista de §7.4. |
| **Permuta falsa:** una matrícula mal cargada en el stock coincide con un vehículo de cliente y lo marca "ya no es del cliente". | La fila del registro guarda la unidad que coincidió, la nota en el contacto lo hace visible, y la ficha muestra el motivo con link. Se corrige con "Cambiar dueño". |
| **Storage:** costo y datos sensibles en las fotos. | Tope de 20 por orden y 5 MB. Bucket privado y URLs firmadas. Borrado con el contacto. Retención automática como decisión abierta (D10). |
| Los tests de catálogo se rompen con cada trigger nuevo. | Esperado: se actualizan en el mismo PR (S7, S8, S9, S13). |
| **Contactos:** las FKs nuevas rompen `contactMerge` si no se suman. | En S1 y S6, con el inventario actualizado y el test que lo fija. |
| **Turno cancelado sin que la orden se entere** (§4.4). | Se lee al abrir la ficha, más la tarjeta del dashboard. No se tocan los eventos de turnos de automotora. |
| **Desactivar con órdenes abiertas.** | Los datos quedan y Plataforma avisa el conteo. Reactivar devuelve todo. |

---

## 14. Decisiones

**Aprobadas por Rocco el 2026-10-13: todas en la opción marcada, que era la
recomendada.** D6 y D16 llevan además los ajustes de §14.1.

| # | Pregunta | Opciones | Decidido |
|---|---|---|---|
| D1 | Dónde vive la marca del módulo | **A.** Tabla `organization_modules` (quién y cuándo, genérica). **B.** Columna booleana `organizations.servicios_enabled`. **C.** Columna `text[]` en `organizations`. | **A** (§1.2). B es más simple hoy, pero cada módulo activable futuro es otra migración en `organizations` y no deja rastro de quién lo activó. |
| D2 | Cómo pasa una unidad vendida a vehículo del cliente | **A.** Barrido automático sobre ventas ganadas, sin tocar oportunidades. **B.** En la transacción de ganar. **C.** Botón manual "Pasar a cliente". | **A** (§5). |
| D3 | Ventas anteriores a la activación | **A.** Se cargan todas (con aviso del conteo). **B.** Solo las de los últimos N años. **C.** Ninguna. | **A**: son la base del recambio. B si alguna concesionaria tiene un historial enorme de datos dudosos. |
| D4 | Tipos de service con su intervalo | **A.** Catálogo propio del taller (`service_job_types`). **B.** Columna nueva en el `ServiceType` de la agenda. | **A** (§2.6): el taller no tiene por qué usar la agenda. |
| D5 | Cuántos tipos por orden | **A.** Varios (manda el intervalo menor). **B.** Uno solo. | **A**: un service real suele ser "service + alineación". |
| D6 | Qué cuenta como "ya agendó", y primer service de un 0 km | **A.** Solo una orden abierta del vehículo; "Crear orden" desde el turno; primer service a los N meses de la venta. **B.** También turnos futuros del contacto con un tipo de turno marcado "taller". | **A** (§6.5), con el ajuste 1 de §14.1: el primer service va **activado por defecto** (N = 12, provisorio y editable) y solo para las ventas posteriores a la activación (§6.1). |
| D7 | Categoría de la plantilla del recordatorio | **A.** MARKETING. **B.** UTILITY. | **A**, a confirmar con Meta y la tarifa antes del primer cliente. |
| D8 | Recordatorio a un cliente sin WhatsApp | **A.** Tarea "llamar" (casilla en la regla, activada por defecto). **B.** Nada. | **A**. |
| D9 | Roles y quién ve las órdenes | **A.** ADMIN y USER; el encargado es un dato de la orden; USER ve y opera todas las órdenes. **B.** Igual, pero USER solo las que tiene asignadas. **C.** Rol nuevo "Taller". | **A** (§10). C cuando una concesionaria pida mecánicos que no vean ventas. |
| D10 | Fotos: límites y retención | **A.** 10 "Antes" + 10 "Después" por orden, 5 MB, JPEG/PNG/WebP, sin borrado automático. **B.** Lo mismo, con borrado automático a los 12 meses de entregada. | **A** para empezar. B si el costo de Storage lo pide. |
| D11 | ¿Se puede reabrir una orden entregada o cancelada? | **A.** No: son finales. Lo de "Listo → En trabajo" sí. **B.** El ADMIN puede reabrir. | **A**. |
| D12 | Recambio sin fecha de compra | **A.** Sin evento, con la lista "sin fecha de compra" en el dashboard. **B.** Estimar desde el año del modelo. | **A** (§7.1). |
| D13 | A quién va la tarea de recambio | **A.** Vendedor del contacto → vendedor de la venta → responsable de la sucursal → ADMIN más antiguo. **B.** Siempre al responsable de la sucursal. | **A**. |
| D14 | Borrado completo de datos personales de un contacto con órdenes | **A.** Borra fotos, anonimiza matrícula, chasis y notas, y conserva las órdenes sin datos. **B.** Borra vehículos y órdenes. | **A**: los números del taller no cambian. |
| D15 | Desactivar el módulo | **A.** Se puede siempre; los datos quedan y los envíos se cancelan. **B.** No se puede con órdenes abiertas. | **A**, con el aviso del conteo. |
| D16 | Matrícula y chasis | **A.** Únicos por organización entre vehículos vigentes (409 con link al existente). **B.** Sin unicidad, con aviso de posible duplicado. | **A**, con el ajuste 2 de §14.1: "Cambiar dueño" y "ya no es del cliente" (§2.2.1). |
| D17 | Moneda del Valor | **A.** Por defecto la principal de la organización, editable por orden. **B.** Fija por organización. | **A**, como las oportunidades. |
| D18 | Número de orden | **A.** Consecutivo por organización ("OS-0042"). **B.** Por sucursal. **C.** Sin número (solo el id). | **A**. |
| — | Aviso "listo para retirar" con la ventana cerrada (§8.2) | **A.** v1 con texto sugerido y copiar/llamar; plantilla manual de un clic después. **B.** La plantilla manual ya en la v1. | **A**. No numerada: no cambia el modelo de la v1. |

### 14.1 Ajustes de Rocco al aprobar (2026-10-13)

1. **D6, primer service.** Activado por defecto para las ventas que entran
   **después** de activar el módulo, con N = 12 meses (provisorio) y editable en
   la configuración del taller (`firstServiceAfterMonths`). Las ventas
   anteriores a la activación no reciben fecha de primer service. → §2.6, §4.8,
   §5 y §6.1.
2. **D16, cambio de dueño.** Matrícula y chasis únicos, más una acción "Cambiar
   dueño" en la ficha del vehículo: registra el cambio, limpia la fecha de
   compra y deja de recordarle al dueño anterior. La **permuta** (una unidad que
   entra al stock y coincide con un vehículo de cliente) marca el vehículo "ya
   no es del cliente" de forma automática. Va en S10 y no en S3, sin migración
   extra. → §2.2, §2.2.1, §4.5, §5 y §6.3.
3. **S9, reseña automática al entregar:** pasa a "solo si se pide", igual que
   S14. La reseña la configura cada concesionaria con lo que ya existe, sobre el
   evento "Orden entregada" de S8. Hoy eso alcanza para una tarea; el envío
   automático del QR es lo que necesitaría S9. → §9 y §11.
4. **Dashboard:** tarjeta "Recambios vencidos sin contactar" para los vehículos
   cuyo aviso de recambio quedó fuera de la ventana de 7 días, incluidas las
   ventas viejas cargadas al activar, con link a la lista. Va en S13. → §4.7 y
   §7.4.
