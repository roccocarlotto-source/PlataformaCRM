# Oportunidades y procesos de venta

Una **oportunidad** es una venta en curso: un cliente interesado en una unidad,
con un monto, un vendedor a cargo y una etapa dentro del proceso de venta.
Todo lo que pasa con esa venta cuelga de su ficha: la cotización, los pagos,
el auto que el cliente entrega en permuta y la entrega del vehículo vendido.

El **proceso de venta** son las etapas por las que pasa una oportunidad (por
ejemplo: Contacto inicial → Test drive → Negociación → Ganada / Perdida). Lo
configura un administrador en **Procesos de venta**.

Las dos pantallas están en el menú **CRM**.

## Oportunidades en la edición Esencial {#oportunidades-esencial}

En la edición **Esencial**, una oportunidad es simple: un contacto, un título,
la unidad que le interesa, un monto y en qué está la venta. No hay embudo,
etapas, procesos de venta ni empresas: el estado de la venta se elige a mano.

| Estado | Qué significa |
|---|---|
| **En curso** | La venta está abierta. Es el estado con que nace. |
| **Vendida** | La venta se registró. |
| **Perdida** | No se dio. Se puede anotar por qué. |

### La lista {#lista-esencial}

En **CRM → Oportunidades** se ven todas las oportunidades de la organización,
en una tabla. Se puede **Buscar por título**, filtrar por **Estado** y elegir
el orden (fecha de creación, última actualización, monto o título).

Las columnas son **Título** (tocarlo abre la oportunidad), **Asociado** (el
contacto), **Monto**, **Cierre**, **Asignado** (solo la ven los
administradores) y **Estado**. En los tres puntos de cada fila están **Ver
detalle**, **Editar** y **Eliminar**.

Cualquier usuario puede crear oportunidades, y las que crea quedan a su nombre.
Una oportunidad la edita quien la tiene asignada o un administrador; la de otra
persona se ve en solo lectura. Eliminar y reasignar: solo un administrador.

> Eliminar una oportunidad no se deshace desde la app. Si tenía una unidad de
> stock vinculada, la unidad vuelve a quedar disponible.

### Nueva oportunidad {#nueva-oportunidad-esencial}

1. En la lista, tocá **Nueva oportunidad**.
2. Escribí el **Título** (por ejemplo, *Hilux para Ana Pérez*).
3. En **Contacto**, escribí parte del nombre o del email y elegilo de la lista.
   Es obligatorio.
4. Si ya hay una unidad, elegila en **Unidad de stock**. Si dejás el **Monto**
   vacío, la oportunidad toma el precio de la unidad.
5. Si hace falta, cargá **Monto** y **Moneda**, y un administrador puede
   elegir a quién queda **Asignado**.
6. Tocá **Guardar**. La oportunidad nace **En curso**.

Al abrir una oportunidad que tiene contacto, arriba a la derecha está el botón
**Crear cupón**, para mandarle por WhatsApp un cupón de descuento (ver
[Cupones y QR](/ayuda/cupones-y-qr)).

### Vendida o perdida {#cerrar-esencial}

Para cerrar una venta, abrí la oportunidad, elegí el **Estado** y tocá
**Guardar**:

- **Vendida**: la fecha de cierre se completa sola con la de hoy. Si la
  oportunidad tiene una unidad vinculada, la unidad queda **Vendida** en el
  stock. Si hay una automatización de **Venta registrada**, se dispara (por
  ejemplo, el QR o el cupón al cliente, ver
  [Automatizaciones](/ayuda/automatizaciones)).
- **Perdida**: aparece **Motivo de pérdida**, para anotar por qué no se dio.
  Si tenía una unidad vinculada, la unidad vuelve a quedar disponible.
- Volver a **En curso** reabre la venta: se borran la fecha de cierre y el
  motivo de pérdida.

## Oportunidades {#oportunidades}

En **CRM → Oportunidades** se ven todas las oportunidades de la organización.
Arriba a la derecha hay dos botones para elegir la vista:

- **Vista de tabla**: una lista con filtros, para buscar y ordenar.
- **Vista de embudo**: un tablero con una columna por etapa, para ver en qué
  punto está cada venta y moverla arrastrando.

El botón **Nueva oportunidad** está en las dos vistas.

### Quién puede hacer qué

- Cualquier usuario puede **crear** una oportunidad. Si la crea un usuario
  (no administrador), queda asignada a él.
- Una oportunidad la puede **editar** quien la tiene asignada o un
  administrador. Si abrís la de otra persona, la ves completa pero en solo
  lectura: aparece el aviso "Está asignado a otra persona" y el botón
  **Guardar** queda deshabilitado.
- **Eliminar** y **reasignar** a otro vendedor: solo un administrador.
- Solo un administrador ve la columna **Asignado** y los avatares del
  vendedor en el embudo.

### La vista de tabla

Filtros disponibles:

- **Buscar por título**.
- **Estado**: Abierta, Ganada o Perdida.
- **Empresa**.
- **Proceso de venta**.
- **Ordenar por**: fecha de creación, última actualización, monto o título,
  ascendente o descendente.

Columnas:

| Columna | Qué muestra |
|---|---|
| Título | El nombre de la oportunidad. Tocarlo abre la ficha. |
| Asociado | La empresa y/o el contacto de la venta. |
| Embudo · Etapa | El proceso de venta y la etapa actual. |
| Monto | El monto con su moneda. |
| Cierre | Si está abierta, la fecha **estimada**; si está cerrada, la fecha **real** de cierre. |
| Asignado | El vendedor a cargo (solo administradores). |
| Estado | Abierta, Ganada o Perdida. |

En el menú de acciones de cada fila (los tres puntos):

- **Ver detalle**: abre una ventana con todos los datos sin salir de la lista.
- **Editar**: solo si es tuya o sos administrador.
- **Eliminar**: solo administradores. Pide confirmación.

> Eliminar una oportunidad no se deshace desde la app. Si tenía una unidad de
> stock vinculada, la unidad vuelve a quedar disponible.

## El embudo {#embudo}

La **Vista de embudo** muestra el proceso de venta elegido como un tablero:
una columna por etapa, en el orden configurado, y cada oportunidad como una
tarjeta dentro de su etapa.

- Arriba podés cambiar el **Proceso de venta** (si la organización tiene
  más de uno; si no, se elige solo) y **buscar** una oportunidad por título.
- Al lado se lee el resumen: cuántas oportunidades hay en el proceso y
  cuánto suman las que siguen **en curso** (solo las abiertas; las ganadas y
  perdidas no suman ahí).
- Cada columna muestra la cantidad de oportunidades y el **Total** de sus
  montos. Las columnas de las etapas marcadas como ganada se ven en verde y
  las de perdida en rojo.
- Cada tarjeta muestra el título, la empresa o contacto, el monto, la fecha
  de cierre (estimada o real) y, para administradores, el vendedor.

### Crear desde una columna

Al pie de cada columna de etapa normal hay un botón **+ Añadir**: abre el
formulario de nueva oportunidad con el proceso y la etapa ya elegidos. Las
columnas de ganada y perdida no lo tienen, porque una oportunidad nueva
siempre nace abierta.

### Mover una oportunidad de etapa

1. Tomá la tarjeta y arrastrala hasta la columna de la etapa nueva.
2. Soltala. El cambio se guarda al instante; si falla, la tarjeta vuelve a
   donde estaba y aparece el motivo.

Con el teclado: con el foco en la tarjeta, presioná **Espacio** o **Enter**,
movela con las flechas y volvé a presionar **Espacio** para soltarla.
**Escape** cancela.

Solo podés arrastrar las oportunidades que podés editar (las tuyas, o todas
si sos administrador). Las demás se ven pero no se mueven.

> Mover una tarjeta a una columna de **ganada** o **perdida** la cierra con
> ese resultado y pone la fecha de hoy como fecha real de cierre (si no tenía
> una cargada). Mover una tarjeta cerrada a una etapa normal la **reabre** y
> borra la fecha real de cierre. Ver [Cerrar una oportunidad](#cerrar).

## Nueva oportunidad {#nueva-oportunidad}

1. En **Oportunidades**, tocá **Nueva oportunidad** (o **+ Añadir** en una
   columna del embudo).
2. Completá los datos. Los campos con asterisco son obligatorios.
3. Tocá **Guardar**. La oportunidad se crea **abierta**, en la etapa que
   elegiste, y volvés a la lista.

Los campos están agrupados en tarjetas:

**Oportunidad**

- **Título** (obligatorio): cómo vas a reconocerla, por ejemplo "Hilux SRV
  2021 – Ana Pérez".
- **Empresa** y **Contacto**: a quién se le vende. Tenés que indicar al menos
  uno de los dos; pueden ir los dos. El contacto se busca por nombre o email.
  Son independientes: elegir una empresa no cambia el contacto ni al revés.

**Embudo y valor**

- **Proceso de venta** (obligatorio) y **Etapa** (obligatorio): la etapa
  depende del proceso elegido; si cambiás el proceso, hay que volver a elegir
  la etapa.
- **Monto** y **Moneda**: el valor de la venta. Si vinculás una unidad de
  stock, se completan solos con el precio de la unidad (ver más abajo).
- **Fecha estimada de cierre**: cuándo creés que se va a cerrar. Si no la
  sabés, tildá **Fecha desconocida**.
- **Asignado**: el vendedor a cargo. Solo lo ve un administrador; para un
  usuario la oportunidad queda a su nombre.

**Vehículo vinculado**

- **Unidad de stock**: buscá por marca, modelo, patente, VIN o código interno.
  Solo aparecen las unidades **Disponibles** y las marcadas como **No
  disponible** (estas últimas con su estado al lado). Cada resultado muestra
  el precio. Para sacar la unidad, tocá **Quitar vínculo**.
- **Financiación**: Sin financiación, Crédito prendario 24 meses, Crédito
  prendario 36 meses o Financiación propia. Si elegís una financiación,
  aparecen los campos del plan: **Entidad financiera**, **Entrega inicial**,
  **Cantidad de cuotas** y **Monto de cuota**. Para financiación propia dejá
  la entidad vacía. Los importes van en la moneda de la oportunidad y no se
  calculan entre sí: se cargan los números que da el banco. Si volvés a "Sin
  financiación", el detalle se oculta pero no se borra.
- **Origen del cliente**: por dónde llegó (Portal · MercadoLibre, Sitio web,
  Showroom, Referido, WhatsApp, Messenger, Instagram).

> Al vincular una unidad, **Monto** y **Moneda** se vacían y, al guardar, se
> completan con el precio de lista de la unidad. Si querés otro monto (por
> ejemplo, un precio negociado), escribilo antes de guardar y ese manda.

> Vincular una unidad a una oportunidad abierta la deja **Reservada** en el
> stock: nadie más puede vincularla hasta que esta oportunidad se cierre o
> se le quite el vínculo. Ver [Estados de una unidad](/ayuda/stock#estados).

## La ficha de la oportunidad {#ficha-de-oportunidad}

Al abrir una oportunidad existente (tocando el título en la tabla o en el
embudo, o con **Editar**), se ve el mismo formulario del alta, con los datos
cargados, y debajo las secciones de la venta:

- [Cotización](#cotizaciones) e historial de cotizaciones.
- [Entrega](#entrega) (solo cuando la oportunidad está ganada con una unidad).
- [Permuta](#permuta).
- [Pagos](#pagos).

Si la oportunidad tiene contacto, arriba a la derecha está el botón **Crear
cupón**, para mandarle por WhatsApp un cupón de descuento. Cómo funciona está
en [Cupones y QR](/ayuda/cupones-y-qr).

Mientras la oportunidad está abierta, debajo del formulario se lee cómo
cerrarla: eligiendo una etapa marcada como ganada o perdida, o moviéndola en
el embudo. Cuando está cerrada aparece la tarjeta **Estado y cierre** (ver
[Cerrar una oportunidad](#cerrar)).

> Las secciones de cotización, entrega, permuta y pagos las puede **modificar
> solo un administrador**. Un usuario que tiene la oportunidad asignada las ve
> y edita el resto de la ficha, pero si intenta crear una cotización, registrar
> un pago o confirmar una entrega, el sistema lo rechaza.

## Cotizaciones {#cotizaciones}

La tarjeta **Cotización** muestra la cotización vigente de la oportunidad y,
abajo, el **Historial de cotizaciones** con las anteriores.

Cada cotización tiene un estado:

| Estado | Qué significa |
|---|---|
| Borrador | Se está armando; todavía se puede editar. |
| Enviada | Se le presentó al cliente. |
| Aceptada | El cliente la aceptó. No se puede deshacer. |
| Rechazada | El cliente la rechazó. No se puede deshacer. |
| Vencida | Estaba enviada y pasó su fecha de validez. |
| Reemplazada | Se creó una más nueva y esta pasó al historial. |

### Crear una cotización

1. En la ficha de la oportunidad, tocá **Nueva cotización**.
2. Cargá el **Precio ofertado** (obligatorio) y la **Moneda**. Si ya había una
   cotización vigente, el formulario arranca con sus valores (el caso típico
   es "le bajo el precio"); si no, con el monto de la oportunidad.
3. Si corresponde, poné **Válida hasta**: la fecha límite de la oferta.
4. En **Accesorios y descuentos** podés agregar líneas con **Agregar línea**:
   cada una tiene **Descripción**, **Tipo** (Accesorio suma, Descuento resta)
   e **Importe**, siempre en positivo. **Quitar** la saca.
5. Tocá **Guardar**. La cotización nace en **Borrador**.

El total es el precio ofertado más los accesorios menos los descuentos. La
cotización guarda una foto de la unidad vinculada en ese momento: si después
le cambian la unidad a la oportunidad, la cotización no cambia.

> Si había una cotización en Borrador o Enviada, al guardar la nueva, la
> anterior pasa al historial como **Reemplazada**.

### Qué se puede hacer con la cotización vigente

- En **Borrador**: **Editar** (mismo formulario), **Enviar** (pasa a Enviada)
  o crear una **Nueva cotización**. No se puede enviar una cotización cuya
  fecha de validez ya pasó.
- En **Enviada**: **Marcar aceptada** o **Marcar rechazada**. Las dos piden
  confirmación porque no tienen vuelta atrás.
- En **Rechazada** o **Vencida**: solo crear una **Nueva cotización**.
- En **Aceptada**: no se pueden crear cotizaciones nuevas para esta
  oportunidad. Es la cotización con la que se cierra la venta.
- **Imprimir**: siempre que haya una vigente. Imprime solo la cotización
  (título de la oportunidad, estado, unidad, desglose, total y validez).

> **Marcar aceptada** bloquea para siempre la creación de cotizaciones nuevas
> en esta oportunidad. Marcala solo cuando el cliente la aceptó de verdad.

En el historial, cada cotización anterior se abre tocándola para ver su
desglose completo.

## Pagos {#pagos}

La tarjeta **Pagos** registra lo que el cliente fue pagando: una seña con la
oportunidad abierta, cuotas con la venta ganada, lo que sea. Es informativa:
nada de lo que se carga acá bloquea la entrega ni el cierre.

### Registrar un pago

1. Tocá **Agregar pago**.
2. Cargá el **Monto**, el **Método** (Efectivo, Transferencia, Tarjeta, Cheque
   u Otro) y la **Fecha**. Los tres son obligatorios.
3. Tocá **Agregar**.

La moneda del pago es la de la oportunidad en ese momento. Cada pago se puede
**Editar** o **Eliminar** (pide confirmación).

Debajo de la lista se lee **Pagado: X de Y · Saldo: Z**, donde Y es el monto
de la oportunidad. Tené en cuenta:

- Solo suman los pagos en la **moneda actual** de la oportunidad. Si la
  oportunidad cambió de moneda después de cobrar, los pagos en la otra moneda
  quedan afuera del total y la tarjeta lo avisa. No se hace conversión.
- Si hay muchos pagos, se muestran los más recientes y el total suma solo esos
  (la tarjeta también lo avisa).
- El saldo puede dar negativo si se cobró de más o el monto bajó: se muestra
  tal cual.

## Permuta {#permuta}

La tarjeta **Permuta** lista los autos que el cliente entregó como parte de
pago en esta venta, con un link a la ficha de cada uno en el stock. Se puede
cargar en cualquier momento de la negociación, con la oportunidad abierta,
ganada o perdida.

Para cargar uno:

1. Tocá **Agregar auto en permuta**.
2. Se abre el formulario de [nueva unidad](/ayuda/stock#nueva-unidad) con el
   **Origen** ya en Permuta y un aviso de que se va a vincular a esta
   oportunidad. Elegí la **Sucursal** y completá el resto de la ficha.
3. Al guardar, volvés a la oportunidad y el auto aparece en la lista.

> El **valor de la permuta no se descuenta solo** del monto de la oportunidad
> ni de la cotización. El valor acordado se carga en la ficha de la unidad y,
> si querés reflejarlo en la venta, ajustá el monto o cargá un descuento en
> la cotización a mano.

## Entrega {#entrega}

Cuando una oportunidad con unidad vinculada pasa a **Ganada**, el sistema
crea sola la **Entrega** y la tarjeta aparece en la ficha. Mientras no esté
ganada (o no tenga unidad), la tarjeta no existe.

La entrega tiene dos estados: **Pendiente de entrega** y **Entregada**.
Mientras está pendiente:

- **Fecha programada**: cuándo se va a entregar. Se guarda al salir del campo.
- **Qué se entrega**: una lista de control que arranca con cinco ítems
  (Documentación de transferencia, Manual del vehículo, Llave de repuesto, Kit
  de herramientas / gato, Service al día). Cada tilde se guarda al instante,
  sin botón de guardar: la idea es ir completándola en el mostrador.
- **Agregar ítem**: suma un ítem propio a la lista. **Quitar** lo saca.

Para cerrar el ciclo:

1. Tocá **Confirmar entrega**.
2. Confirmá en la ventana. Si quedan ítems sin tildar, el aviso lo dice; no
   bloquea (a veces se entrega sin el manual), pero conviene revisarlo.

Al confirmar, la unidad pasa a **Entregado** en el stock y la tarjeta queda en
solo lectura con quién y cuándo la confirmó.

> **Confirmar entrega no se deshace.** La entrega ya no se puede modificar y la
> unidad queda como Entregado. Confirmá cuando el cliente se llevó el auto.

Si la oportunidad se reabre o se marca como perdida antes de confirmar, la
unidad vuelve a Reservada o Disponible y la entrega no se puede confirmar
hasta que la venta vuelva a estar ganada.

## Cerrar una oportunidad {#cerrar}

El estado (Abierta, Ganada, Perdida) **no se elige a mano**: lo define la
etapa. Hay dos formas de cerrar una oportunidad:

- En la ficha, en **Etapa**, elegí una etapa marcada como ganada o perdida en
  el proceso de venta y tocá **Guardar**.
- En el embudo, arrastrá la tarjeta a la columna de esa etapa.

En los dos casos pasa lo mismo:

- La oportunidad queda **Ganada** o **Perdida** según la etapa.
- La **Fecha real de cierre** se completa con hoy, salvo que ya tuviera una.
- Aparece la tarjeta **Estado y cierre** con el estado y la fecha real, y, si
  es perdida, el campo **Motivo de pérdida** para anotar por qué no se dio.
  El motivo se escribe solo desde la ficha; el embudo no lo toca.
- Si la oportunidad tiene unidad vinculada: ganada la deja **Vendida** (y
  crea la [entrega](#entrega)); perdida la devuelve a **Disponible**.

Para **reabrir** una oportunidad cerrada, elegí una etapa normal (o arrastrala
a su columna): vuelve a Abierta, se borran la fecha real de cierre y el motivo
de pérdida, y la unidad vinculada vuelve a quedar Reservada. Cambiar de
proceso de venta también la reabre, porque las etapas del proceso nuevo son
otras.

> Si en el proceso de venta ninguna etapa está marcada como ganada o perdida,
> no hay forma de cerrar las oportunidades. Un administrador tiene que
> marcarlas en [Etapas](#etapas).

## Procesos de venta {#procesos-de-venta}

En **CRM → Procesos de venta** están los procesos (embudos) de la
organización. Todos pueden verlos; crear, editar y eliminar es de
administradores.

La lista muestra el **Nombre**, si es el **Predeterminado** y un link **Ver
etapas**. Se puede buscar por nombre y ordenar por fecha de creación o nombre.
En el menú de acciones: **Ver detalle**, **Editar** y **Eliminar** (pide
confirmación).

### Crear un proceso de venta

1. Tocá **Nuevo proceso de venta**.
2. Poné el **Nombre** (obligatorio), por ejemplo "Venta de usados".
3. Si querés que sea el que se ofrece primero, tildá **Predeterminado**. Puede
   haber uno solo: al marcar este, el anterior deja de serlo. También puede
   no haber ninguno.
4. Tocá **Guardar**. La pantalla queda en modo edición, con la tarjeta
   **Etapas** debajo, para que cargues las etapas sin salir: un proceso sin
   etapas no sirve para nada.

En edición, **Guardar** solo guarda el nombre y la marca de predeterminado y
vuelve a la lista; las etapas se guardan por su cuenta (ver abajo).

> Eliminar un proceso de venta no se deshace. Las oportunidades que estaban
> en él siguen existiendo, pero sin un proceso válido: conviene moverlas antes.

## Etapas {#etapas}

Las etapas se administran desde dos lugares equivalentes:

- La tarjeta **Etapas** dentro de **Editar proceso de venta** (lo más cómodo).
- La pantalla **Ver etapas** de la lista de procesos, que además permite
  buscar por nombre y ver el detalle de cada etapa.

Solo un administrador puede crear, editar, reordenar o eliminar etapas.

Cada etapa tiene:

- **Nombre** (obligatorio): único dentro del proceso.
- **Orden**: la posición en el embudo. En la tarjeta de etapas se cambia con
  **Subir** y **Bajar**; en **Nueva etapa** de la pantalla completa hay un
  campo **Orden**, y si se deja vacío la etapa va al final.
- **Probabilidad (%)**: cuán probable es cerrar una venta que está en esta
  etapa. Es opcional: aparece al tocar **+ Agregar probabilidad**. Admite
  decimales. Una etapa sin probabilidad se muestra con un guión.
- **Ganada** y **Perdida**: marcan la etapa como un cierre. Son excluyentes
  (tildar una destilda la otra). Puede haber más de una etapa ganada o
  perdida en el mismo proceso. En la lista se ven como **Cierre ganado** y
  **Cierre perdido**.

### Agregar una etapa

1. En **Editar proceso de venta**, bajo **Nueva etapa**, escribí el **Nombre
   de la etapa**.
2. Si querés, tocá **+ Agregar probabilidad** y cargá el porcentaje.
3. Tildá **Ganada** o **Perdida** si es una etapa de cierre.
4. Tocá **Agregar etapa** (o Enter). Se guarda al instante y el formulario
   queda vacío, con el cursor en el nombre, para cargar la siguiente. La nueva
   etapa va al final; después la podés subir.

### Editar, reordenar y eliminar

- **Subir** y **Bajar**: mueven la etapa un lugar. Cada movimiento se guarda
  al instante; mientras se guarda uno, los botones se deshabilitan.
- **Editar** (en el menú de la fila): la fila se vuelve editable ahí mismo.
  **Guardar etapa** confirma, **Cancelar** o Escape descarta.
- **Eliminar**: pide confirmación. No se puede eliminar una etapa que tiene
  oportunidades abiertas: el sistema lo rechaza y muestra el motivo; movelas
  primero a otra etapa.

Si un proceso tiene más de 100 etapas (no es un caso normal), la tarjeta
muestra las primeras 100 y avisa; para ver todas se usa **Ver etapas**.
