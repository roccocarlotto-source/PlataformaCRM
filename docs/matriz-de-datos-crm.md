# Matriz de estados de datos del CRM

Línea de trabajo paralela a la del agente. Los ítems de este documento se numeran **del 150 en adelante** para no chocar con los de `docs/frontend-cambios-pendientes.md`.

**Por qué existe.** Los seis bugs del agente que se arreglaron el 23/09 (ítems 108 a 113) no eran huecos de cobertura: la suite estaba verde con más de 2.000 tests. Eran huecos de **especificación**: nadie había escrito qué tenía que pasar en ese caso, así que ningún test podía fallar. La matriz obliga a declarar qué combinación de estados es legal, y ahí es donde aparecen los agujeros.

**Alcance:** solo el CRM (stock, contactos, empresas, pipelines, etapas, oportunidades). Nada de agentes, tools ni prompts. La agenda (Resource, ServiceType, WorkingHours, Booking) queda para una segunda vuelta.

---

## 150. Paso 1: qué combinaciones contradictorias entran hoy

**Estado:** relevado. **No se arregló nada**: la tabla es para que Rocco decida cuáles son bugs y cuáles son estados que el negocio acepta a propósito.

### Cómo se midió

Cada combinación se sembró por los dos caminos y se miró qué pasa después:

- **Base:** SQL directo (`$executeRawUnsafe`) sobre una fila real. Dice si hay un CHECK, un índice o una FK que la frene.
- **API:** HTTP contra la app real (`app.listen`), con un JWT ES256 emitido por el GoTrue local para un ADMIN de verdad. Pasa por el mismo recorrido que un request de producción: Zod del controller, service y transacción.
- **Después:** lo que devuelven el listado y el detalle, el embudo (`GET /opportunities?stageId=`), el dashboard (`dashboard-summary`, `revenue-series`), la base de conocimiento (`POST /knowledge-base/sync-vehicles`) y **lo que el modelo recibe de `search_vehicles`**, invocando la tool tal cual. Esa tool es de solo lectura; no se modificó nada de la capa del agente.

La sonda está en `scripts/sonda-matriz-crm.ts` y la tabla de abajo es su salida, no una lectura del código:

```
npm run supabase:start
npm run migrate:deploy && npm run prisma:seed
npx tsx scripts/sonda-matriz-crm.ts          # tabla en markdown
npx tsx scripts/sonda-matriz-crm.ts --json   # las 29 celdas en JSON
```

No es un test y no afirma nada: anota. Se niega a correr si `DATABASE_URL` no es `127.0.0.1`/`localhost`, crea una organización por grupo de celdas (con su usuario real de Auth) y borra todo al terminar. Corrida del 23/09/2026 sobre `master` en `521ae6b`, Supabase local (Postgres 17): **29 celdas**, dos corridas con los mismos códigos en todas las celdas y cero filas residuales (`organizations` y `auth.users` sin nada de la sonda después).

### Cuatro correcciones al punto de partida del handoff

1. **No existe un sitio público.** La página sin login es de la Fase 3 (lo dice la cabecera de `vehicle.service.ts`). Hoy lo que sale hacia afuera de una unidad son dos canales: `search_vehicles` del agente y la entrada que genera en la base de conocimiento, que el agente lee en su prompt. "¿El sitio la sigue mostrando?" se contestó mirando esos dos.
2. **`visibleInListing` es una dimensión que faltaba, y no tiene efecto.** El schema dice que sirve "para sacar de la vista diaria una unidad que sigue en stock". Ningún filtro la lee, ni en el backend ni en el frontend (V5).
3. **Cero pipelines por defecto no es un caso raro: es el estado inicial.** El onboarding no crea ningún pipeline. Toda organización arranca sin default hasta que alguien crea el primero, y si lo crea sin marcarlo se queda así (P3).
4. **La reserva de una unidad no está en ninguna columna.** Se infiere de "qué oportunidad abierta tiene este `vehicleId`", mientras que `Vehicle.status` se puede escribir a mano por el `PATCH /vehicles/:id`. Las dos fuentes se desincronizan en los dos sentidos (V4, V4b).

### A. Entran por la API: esto es lo que hay que decidir

Ordenadas por lo que cuestan si pasan en producción.

| # | Combinación | Base | API | Qué pasa después | Para decidir |
|---|---|---|---|---|---|
| **R2** | Entrega confirmada (unidad `DELIVERED`) y después la oportunidad pasa a `LOST` u `OPEN` | acepta | confirmar entrega: 200 · pasar a LOST: 200 · reabrir: 200 | La unidad pasa de `DELIVERED` a `AVAILABLE` con la entrega todavía `DELIVERED`. **`search_vehicles` la vuelve a ofrecer**, porque sigue con `publishOnWebsite=true`. Si en cambio se reabre, queda `RESERVED`. | ¿Una unidad entregada puede volver al stock porque cambió la oportunidad? Si no, ¿se bloquea el cambio de estado de una oportunidad con entrega confirmada, o se deja la unidad donde está? |
| **V3** | `status` SOLD o DELIVERED con `publishOnWebsite=true` | acepta | PATCH status=SOLD: 200 · status=DELIVERED: 200 | `publishOnWebsite` sigue en `true`. `search_vehicles` no la devuelve (filtra `AVAILABLE`). **La entrada de la base de conocimiento sigue viva** hasta que alguien aprieta "Sincronizar": antes de vender, "entrada viva"; vendida y sin sincronizar, "entrada viva (isActive=true)"; después de sincronizar, "dada de baja". Mientras tanto el agente tiene el auto vendido en su prompt (`findActiveKnowledgeBaseEntriesByBranch`). | ¿La sincronización se dispara sola cuando cambia el status, o alcanza con que sea manual? ¿Vender despublica? |
| **V1** | `priceOnRequest=true` con `priceListUsd` cargado, publicada | acepta | 201 + PATCH 200 | La KB lo hace bien: "Precio: a consultar", sin número. **`search_vehicles` le pasa al modelo `priceListUsd=25000` junto con `priceOnRequest=true`**. Además, con `priceMaxUsd=24000` no la devuelve y con `26000` sí: el filtro de precio acota el número que el negocio decidió no mostrar. El orden "más barato primero" también la ubica por ese precio. | La combinación es legal: el schema dice explícitamente que la agencia puede tener el precio y no querer exhibirlo. **El problema es de la tool, no del dato.** Queda anotado para el chat del agente, abajo. |
| **V4b** | Oportunidad OPEN vinculada y la unidad pasada a mano a `AVAILABLE` | acepta | Al vincular quedó `RESERVED`; PATCH status=AVAILABLE: 200 | Una segunda oportunidad sobre la misma unidad: **201 → 2 oportunidades OPEN sobre una unidad**. Ganar la primera: 200, la unidad queda `SOLD` y la segunda sigue `OPEN`, esperando un auto que ya se vendió. | ¿El PATCH de `/vehicles/:id` puede mover `status` si hay una oportunidad abierta que la tiene? ¿`status` debería ser escribible a mano en algún estado? |
| **R1** | Ganada con unidad → reabierta (arrastrarla a una etapa normal) → ganada de nuevo | acepta | reabrir: 200 · volver a ganar: **409** (La oportunidad ya tiene una entrega registrada) | Al ganar, la unidad quedó `SOLD`; al reabrir, `RESERVED`, con 1 entrega `PENDING` colgando de una oportunidad abierta. **Volver a ganarla falla**: queda `OPEN` en la etapa Nuevo, y como ganada no se puede cerrar más (ni por la API ni arrastrándola en el embudo). | El §40 dejó la reversión fuera de alcance, pero el embudo hace este recorrido con dos arrastres. ¿Reabrir cancela la entrega pendiente, o volver a ganar la reusa? |
| **O2** | `status` WON con `actualCloseDate` null | acepta | 201 | **No existe para el dashboard**: `wonThisPeriod.count` 1 → 1, ingresos del mes 1000.00 → 1000.00. Tampoco entra en `openCount` porque no es OPEN. La fecha la completa solo el frontend (`stageStatus.ts`); la API y cualquier otro cliente, no. | ¿La API pone `actualCloseDate = hoy` al pasar a WON/LOST si viene vacía, igual que el frontend? |
| **O1** | `status` WON parada en una etapa normal | acepta (la base no relaciona status con stage) | 201 | El embudo la muestra en la columna "Nuevo"; el dashboard la cuenta como ganada (`wonThisPeriod.count` 0 → 1). Es el caso que el §51 cerró en el formulario, que sigue abierto en el contrato ("este ítem cierra el camino de la UI, no el del contrato"). | Desde el §51 la etapa es la única fuente de verdad del cierre. ¿El backend lo hace cumplir (deriva `status` de la etapa, o rechaza la combinación)? |
| **O3** | `status` OPEN parada en una etapa `isWon` (o `isLost`) | acepta | en isWon: 201 · en isLost: 201 | El embudo la muestra en la columna de cierre; el dashboard la suma como abierta (`openCount=2`). | Misma decisión que O1. |
| **O9** | Una etapa pasa a `isWon` con oportunidades OPEN adentro | acepta | 200 | Oportunidades de esa etapa que siguen OPEN después del cambio: 1. **Produce O3 en masa, sin aviso.** | Si la etapa manda: ¿cambiar la marca de una etapa con oportunidades se rechaza, o las arrastra? |
| **V6** | Unidad dada de baja con una oportunidad OPEN que la reserva | acepta (el borrado es lógico, la FK no lo ve) | DELETE /vehicles/:id: 204 | La oportunidad sigue OPEN con `vehicleId` apuntando a la unidad borrada; el GET de la unidad da 404. **Ganar esa oportunidad: 400** (El vehicleId indicado no existe…). Queda sin poder cerrarse como ganada. | ¿Dar de baja una unidad reservada se rechaza (como `deleteStage` con oportunidades activas), o desvincula? |
| **O7** | Oportunidad OPEN cuyo contacto y empresa están dados de baja | acepta (borrado lógico) | DELETE /contacts/:id: 204 · DELETE /companies/:id: 204 | La oportunidad sigue OPEN apuntando a los dos; el GET del contacto da 404; filtrar oportunidades por ese contactId devuelve 1; editarla: 200. En pantalla es una oportunidad sin cliente. | ¿Mismo RESTRICT que Stage, o se permite y la oportunidad muestra "contacto dado de baja"? |
| **V4** | `status` RESERVED sin ninguna oportunidad abierta que la tenga | acepta | PATCH status=RESERVED: 200 | Oportunidades que la reservan: 0. Vincularla a una oportunidad nueva: **409** (La unidad indicada no está disponible…). `search_vehicles` no la ofrece. Queda fuera de venta hasta que alguien la pase a `AVAILABLE` a mano, y nada lo avisa. | Puede ser legítimo (una seña fuera del CRM). Si lo es, ¿hace falta algo que muestre "reservada sin oportunidad"? |
| **P3** | Organización con pipelines pero ninguno `isDefault` | acepta (el índice impide dos, no cero) | Organización nueva: 0 pipelines. POST /pipelines sin isDefault: 201 → 0 default. PATCH isDefault=false sobre el default: 400 | Se llega creando el primer pipeline sin marcarlo; quitarle la marca al default existente sí está cerrado. `create_opportunity` del agente responde `MENSAJE_SIN_PIPELINE_POR_DEFECTO`. | ¿El primer pipeline de la organización nace default siempre? ¿El onboarding crea uno? |
| **P4** | El pipeline por defecto sin etapas activas | acepta | crear un default vacío: 201 · borrar la última etapa del default: 204 | El default queda con 0 etapas. `create_opportunity` del agente responde `MENSAJE_PIPELINE_SIN_ETAPAS`; en la UI no se puede crear ninguna oportunidad en ese pipeline. | ¿`deleteStage` rechaza borrar la última etapa del default? ¿Un default nuevo necesita al menos una etapa? |
| **P6** | La etapa de `order=1` es `isWon` (o `isLost`) | acepta | 201; primera etapa por order: "Vendido" | Si ese pipeline es el default, toda oportunidad que crea el agente nace OPEN en una etapa de cierre (produce O3). | Depende de O1: si la etapa manda, esto es una mala configuración que conviene rechazar. |
| **O4** | LOST sin `lostReason` · OPEN con `lostReason` y `actualCloseDate` · WON con `lostReason` | acepta | 201 · 201 · 201 | Se guardan tal cual. El formulario limpia `lostReason` y la fecha al reabrir (§48/§50); la API no. | ¿Motivo obligatorio en LOST? ¿La API limpia los campos de cierre al reabrir? |
| **O8** | `financingType` NONE con cuotas y prestamista · `INSTALLMENT_24M` con 36 cuotas | acepta | 201 · 201 | Se guardan tal cual (el §42 dice "pasan tal cual, sin regla de negocio"). | Decidido en el §42. Anotado porque la cotización y la entrega los leen. |
| **K1** | `lifecycleStage` CUSTOMER sin ninguna ganada · LEAD con una ganada | acepta | 201 · ganar la oportunidad de un LEAD: 201 | El LEAD sigue LEAD después de ganar: nada deriva `lifecycleStage` de las oportunidades (`promotion.service.ts` lo deja fuera a propósito). | ¿Ganar la primera oportunidad pasa el contacto a CUSTOMER? |
| **V5** | `visibleInListing=false` | acepta | 201 | `GET /vehicles` **la devuelve igual**: ningún filtro lee el campo. | ¿Se implementa el filtro o se saca el campo? |

### B. Solo entran por la base: la API los cierra

| # | Combinación | Base | API | Qué pasa si entran igual |
|---|---|---|---|---|
| **V2** | `publicationCurrency=USD_ONLY` con `priceListUsd` null, publicada | acepta | 422 (faltan priceListUsd) | La KB genera la entrada **sin ninguna línea de precio**; `search_vehicles` la devuelve con `priceListUsd=null`, `priceListLocal=null`, `priceOnRequest=false`: un auto publicado sin precio y sin "a consultar". |
| **O5** | `pipelineId` = A con `stageId` de una etapa del pipeline B | **acepta**: la FK es `(organization_id, stage_id)` y no mira el pipeline | 400 (El stageId indicado no pertenece al pipeline especificado) | El listado por pipeline A la incluye, pero ninguna columna de A la tiene: queda invisible en el embudo de A y fuera del de B. Solo la API defiende esta regla; una importación o un script que escriba directo la rompe. |

### C. Cerradas en las dos capas

| # | Combinación | Base | API |
|---|---|---|---|
| **P1** | Etapa con `isWon` e `isLost` en true | rechaza (`stages_won_lost_exclusive_check`) | 400 (Una etapa no puede estar ganada y perdida a la vez) |
| **P2** | Dos pipelines `isDefault` en la misma organización | rechaza (UNIQUE parcial `pipelines_org_default_unique`) | 200 al marcar otro, que desmarca al anterior; queda 1 default |
| **O6** | Oportunidad sin empresa ni contacto | rechaza (`opportunities_company_or_contact_check`) | 400 (Debe indicar companyId, contactId, o ambos) |

### D. Legales, pero la API las rechaza

| # | Combinación | API | Por qué |
|---|---|---|---|
| **V2b** | USD_ONLY con solo `priceListUsd`, o LOCAL_ONLY con solo `priceListLocal`, y publicar | USD_ONLY: 422 (faltan priceListLocal) · LOCAL_ONLY: 422 (faltan priceListUsd) | `PUBLISH_REQUIRED_FIELDS` exige los dos precios sin mirar `publicationCurrency`. Para publicar en una sola moneda hay que cargar un precio que después no se muestra. |
| **O6′** | Desvincular el contacto de una oportunidad que tiene empresa | PATCH contactId=null: 400 (Expected string, received null) | `contactId` y `companyId` no son nullable en el PATCH, aunque la base aceptaría dejar uno de los dos. |

### E. Aceptadas a propósito (ya documentadas)

| # | Combinación | Dónde se decidió |
|---|---|---|
| **P7** | Varias etapas `isWon` en un mismo pipeline | §13 (se retiró la exclusividad) |
| **P5** | Pipeline sin ninguna etapa de cierre | §51, anotado como deuda: sus oportunidades no se pueden cerrar desde la UI; por la API sí |
| **K2** | Contacto sin email ni teléfono | Legítimo (carga de mostrador) |
| **K3** | Email de un contacto dado de baja reusado por uno vivo | `contacts_org_email_unique` es parcial sobre los vivos, a propósito |

### Para el chat del agente (no se tocó nada)

Tres cosas de `search_vehicles` (`agentTools.service.ts`) que salieron de V1. Las anoto acá porque esa capa no es de esta línea de trabajo:

1. Con `priceOnRequest=true`, el resultado igual trae `priceListUsd` y `priceListLocal` con el número (líneas ~1539-1543). `resolverVehiculo` sí lo anula (línea ~296); `search_vehicles` no. Queda en manos del modelo no decirlo.
2. `priceMinUsd`/`priceMaxUsd` filtran sobre `priceListUsd` aunque la unidad sea "a consultar" o `LOCAL_ONLY`: preguntando por rangos se acota el precio oculto.
3. El orden `priceListUsd asc` ubica a esas unidades por su precio real, mientras que la descripción de la tool dice que "los de precio a consultar, sin precio de lista, van al final".

### Qué sigue

- **Rocco** marca cada fila de la sección A como bug o como aceptada.
- Con esa poda, el **paso 2**: el cartesiano completo por entidad sobre las celdas legales, con asserts sobre el listado, los canales hacia afuera y las transiciones. La sonda ya tiene los fixtures y los dos caminos para eso.
- Cada bug confirmado va como su propio ítem (151 en adelante), con su rama y su PR.
- Segunda vuelta: Resource, ServiceType, WorkingHours y Booking.

---

## 151. Una venta con la unidad entregada se podía deshacer, y una venta reabierta no se podía volver a ganar

**Estado:** hecho. Filas R1 y R2 del ítem 150.

**Qué pasaba.** Dos caminos, los dos con el embudo y dos arrastres:

- **R2.** Venta ganada, entrega confirmada (unidad `DELIVERED`), y después la oportunidad pasa a Perdida: la unidad volvía a `AVAILABLE`, con la entrega todavía `DELIVERED`, y `search_vehicles` la ofrecía otra vez porque seguía publicada. Reabrirla la dejaba `RESERVED`.
- **R1.** Venta ganada con unidad (nace la entrega `PENDING`), reabierta, y ganada de nuevo: `409 La oportunidad ya tiene una entrega registrada`. La oportunidad quedaba abierta y **no había forma de volver a ganarla**.

**Por qué pasa.** El §40 dejó la reversión explícitamente fuera de alcance. `updateOpportunity` sincroniza la unidad con el estado de la oportunidad sin mirar si ya se entregó, y al ganar siempre intentaba **crear** la entrega, que choca con el UNIQUE `(organization_id, opportunity_id)` cuando ya existe una de la ganancia anterior.

**Qué se hizo.**

- **Entrega confirmada = venta cerrada.** Con la entrega `DELIVERED`, cambiar el estado de la oportunidad o su unidad da `409 La unidad de esta oportunidad ya se entregó…`. Se lee bajo el lock de organización, el mismo que toma "Confirmar entrega", así que no hay carrera entre confirmar y revertir. Todo lo demás de la oportunidad (título, notas, montos) sigue editable.
- **Volver a ganar reusa la entrega pendiente** (`ensureDeliveryForSoldVehicle`) en vez de crear otra: conserva el checklist y la fecha que ya se habían cargado, y si la venta se gana con otra unidad, la entrega se reasigna a esa unidad.
- Revertir una venta con la entrega **pendiente** sigue permitido, igual que antes: la entrega queda como está y "Confirmar entrega" sigue dando 409 mientras la unidad no esté vendida.

**Tests.** `delivery.service.integration-test.ts`: el test que fijaba el 409 al volver a ganar se reemplazó por tres — reusar la entrega con lo cargado (y poder confirmarla después), reasignarla a otra unidad, y el 409 en los cuatro cambios bloqueados (LOST, OPEN, otra unidad, desvincular) sin que se mueva nada. Con `opportunityVehicle.integration-test.ts`: 31/31.

---

## 152. El agente seguía teniendo en su prompt un auto vendido hasta que alguien apretaba "Sincronizar"

**Estado:** hecho. Fila V3 del ítem 150.

**Qué pasaba.** La base de conocimiento solo se actualiza con el botón "Sincronizar stock". La sonda lo midió: con la unidad publicada y sincronizada, pasarla a `SOLD` dejaba su entrada **viva (isActive=true)** hasta la sincronización siguiente. El agente lee esas entradas en su prompt (`findActiveKnowledgeBaseEntriesByBranch`), así que durante ese tiempo tenía como disponible un auto que ya se había vendido. `search_vehicles` no la ofrecía (filtra `AVAILABLE`), pero el prompt sí.

**Por qué pasa.** El §70 diseñó la sincronización como una foto manual, y ninguna escritura de Vehicle la miraba.

**Qué se hizo.** Las **bajas** dejan de esperar al botón; las **altas** siguen siendo solo suyas (publicar algo en la base es una decisión que se toma a propósito). `retirarDeLaBaseSiDejoDeCalificar` (en `vehicleKnowledgeBaseSync.service.ts`) da de baja la entrada de la unidad cuando deja de cumplir lo que la sincronización exige (publicada, `AVAILABLE`, no borrada), y la llaman, en su misma transacción:

- `updateVehicle`: cambiar el estado a mano, o despublicarla;
- `setVehicleStatusForOpportunityLink`: reservarla, venderla o entregarla desde una oportunidad o una entrega;
- `deleteVehicle`: darla de baja (que ahora corre en una transacción para eso).

**Tests.** `vehicleKnowledgeBaseSync.integration-test.ts`, cuatro casos nuevos: PATCH a `SOLD`, a `RESERVED` y despublicar dan de baja la entrada en el momento; un PATCH que no cambia si califica no la toca; dar de baja la unidad la da de baja; vincularla a una oportunidad la saca y la sincronización siguiente no la revive. 13/13; con los de vehículos, fotos, entregas y vínculo con oportunidad, 64/64.

---

## 153. Un auto reservado se podía volver "Disponible" a mano, o dar de baja, con una oportunidad abierta encima

**Estado:** hecho. Filas V4b y V6 del ítem 150. La V4 (reservada a mano sin ninguna oportunidad) queda permitida: una seña que no pasa por el CRM es un caso real.

**Qué pasaba.**

- **V4b.** Una oportunidad abierta reserva la unidad (`RESERVED`); alguien la pasa a mano a `AVAILABLE` desde la ficha (200) y se le crea una segunda oportunidad a otro cliente (201): **2 oportunidades abiertas sobre un mismo auto**. Al ganar la primera, la unidad queda `SOLD` y la segunda sigue abierta, esperando un auto que ya se vendió.
- **V6.** Dar de baja una unidad reservada: 204. La oportunidad quedaba apuntando a una unidad borrada, y **ganarla daba 400** (`El vehicleId indicado no existe…`).

**Por qué pasa.** La reserva no vive en ninguna columna: se deduce de "qué oportunidad tiene este `vehicleId`", y el PATCH de `/vehicles/:id` y el DELETE no lo miraban.

**Qué se hizo.** `countOpportunitiesHoldingVehicle` (en `opportunity.repository.ts`) cuenta las oportunidades que **retienen** la unidad: una abierta, o una ganada cuya entrega todavía no se confirmó. Con al menos una, y bajo el lock de organización:

- pasar la unidad a `AVAILABLE` a mano es `409 La unidad está reservada o vendida por una oportunidad: liberala desde la oportunidad…`;
- darla de baja es el mismo 409 (antes de ese chequeo, una unidad ajena o ya borrada sigue siendo 404).

Los otros cambios a mano (`IN_PREPARATION`, `IN_TRANSIT`) siguen permitidos: son operativos y `opportunity.service.ts` ya los respeta. Una unidad con la entrega confirmada se puede dar de baja del stock.

**Tests.** `opportunityVehicle.integration-test.ts`, tres casos nuevos: 409 al volver a `AVAILABLE` una reservada o una vendida (y la segunda oportunidad sigue siendo imposible); `IN_PREPARATION` permitido y, una vez perdida la oportunidad, `AVAILABLE` vuelve a valer; baja con 409 mientras está retenida y permitida después de desvincular o con la entrega confirmada. Con vehículos, base de conocimiento y entregas: 60/60.

---

## 154. El backend aceptaba cualquier combinación de estado y etapa, y cierres sin fecha

**Estado:** hecho. Filas O1, O2, O3, O4 y O9 del ítem 150.

**Qué pasaba.**

- **O1/O3.** Una oportunidad `WON` parada en "Nuevo" (201) o una `OPEN` en "Ganado" (201). El embudo la agrupa por etapa y el dashboard por estado, así que la misma fila estaba ganada según uno y abierta según el otro.
- **O2.** Una `WON` sin `actualCloseDate` (201) no existía para el dashboard: `wonThisPeriod.count` 1 → 1 e ingresos 1000.00 → 1000.00, porque los dos agrupan por fecha de cierre.
- **O4.** `LOST` sin motivo, `OPEN` con motivo y fecha de cierre, `WON` con motivo de pérdida: todo 201.
- **O9.** Marcar como ganada una etapa con oportunidades abiertas (200) dejaba a todas en O3 de un saque.

**Por qué pasa.** El §51 decidió que la etapa es la única fuente de verdad del cierre, pero lo hizo cumplir solo en el formulario y el embudo (`stageStatus.ts`). El §51 mismo lo dejó escrito: "este ítem cierra el camino de la UI, no el del contrato". Todo lo que escribe sin pasar por la pantalla —el agente, la API, un script— seguía libre.

**Qué se hizo.** La regla de `stageStatus.ts`, ahora también en el backend (`src/services/opportunityClosing.ts`, puro, y aplicado en `opportunity.service.ts`):

- **Cambiar de etapa:** el estado sale de la etapa (ganada → `WON`, perdida → `LOST`, cualquier otra → `OPEN`). Si el body trae además un estado que la contradice: `400 El estado no coincide con la etapa…`.
- **Cambiar solo el estado** (lo que hace el agente con `update_opportunity`): la oportunidad **se mueve** a la primera etapa, por orden, que significa ese estado. Es lo mismo que arrastrarla en el embudo.
- **Crear en una etapa de cierre sin decir el estado:** `400`. Derivarlo crearía una venta ganada que nadie pidió y dispararía la automatización de `opportunity.won`.
- **Vía de escape del §51:** en un pipeline **sin ninguna** etapa de ese cierre (P5), se sigue pudiendo cerrar por estado desde una etapa abierta. Así ningún pipeline existente queda con oportunidades imposibles de cerrar.
- **Datos viejos:** un guardado que no cambia ni estado ni etapa se acepta tal cual, aunque la fila venga contradictoria de antes (mismo criterio que el §50: no se corrigen datos que nadie pidió tocar).
- **Campos de cierre:** al cerrar sin fecha, la fecha es **hoy en la zona horaria de la organización** (a las 22:30 en Montevideo sigue siendo hoy, no mañana UTC); una fecha cargada nunca se pisa. Al reabrir se vacían fecha y motivo; mandarlos con `OPEN` es 400. Al ganar se vacía el motivo de pérdida; mandarlo con `WON` es 400. El motivo sigue siendo **opcional** en `LOST`: exigirlo rompería al agente, que puede perder una oportunidad sin motivo.
- **O9:** cambiar si una etapa cierra (ganada / perdida / ninguna) con oportunidades adentro: `409 Esta etapa tiene oportunidades: movelas a otra etapa antes…`. Renombrarla o reordenarla sigue libre.

La UI no nota el cambio: ya manda etapa y estado coherentes.

**Tests.** `opportunityClosing.test.ts`, 12 unitarios de la regla pura (incluido el día de Montevideo contra el día UTC). `opportunityClosing.integration-test.ts`, 6 contra la base: las tres contradicciones rechazadas sin escribir nada; mover a "Ganado" sin estado gana, fecha de hoy y evento `opportunity.won`; el camino del agente (solo `LOST` → etapa Perdido; `OPEN` → vuelve a Nuevo con fecha y motivo vacíos); una ganada sin fecha que ahora sí suma en el dashboard; una fila vieja contradictoria que se guarda igual; y el 409 de O9. La suite de integración completa (incluidos los tests del agente): 1037/1037 antes de agregar estos.
