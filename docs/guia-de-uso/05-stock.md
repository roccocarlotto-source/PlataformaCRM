# Stock

El **Stock** es el listado de vehículos de la organización: lo que está a la
venta, lo reservado, lo vendido y lo que todavía no está listo para ofrecerse.
Cada vehículo es una **unidad** con su ficha completa: datos, precios, fotos,
documentación y estado.

Está en el menú **CRM → Stock**.

- Todos los usuarios ven el listado y la ficha completa de cada unidad
  (incluidos el precio mínimo aceptable y el costo de adquisición).
- Crear, editar y eliminar unidades, y subir fotos: solo un administrador.
- El agente de IA ofrece a los clientes solo las unidades **publicadas y
  disponibles**, y nunca ve el precio mínimo ni el costo.

## El listado de stock {#stock}

Arriba hay dos tarjetas con el total de **Unidades en stock** y cuántas están
**Disponibles**. Debajo, los filtros y la tabla.

Filtros:

- **Sucursal**.
- **Estado**: se pueden elegir varios a la vez (ver [Estados](#estados)).
- **Condición**: Nuevo o Usado.
- **Marca** y **Modelo**: texto libre.
- **Precio mín. (USD)** y **Precio máx. (USD)**.
- **Solo consignación**: las unidades que el negocio vende por cuenta de un
  tercero.
- **Mostrar ocultas**: por defecto, las unidades con **Visible en el listado**
  destildado (un auto en el taller, uno prestado) no aparecen; con este tilde
  se muestran.
- **Ordenar por**: fecha de alta, precio en USD o ingreso al stock.

Columnas:

| Columna | Qué muestra |
|---|---|
| Foto | La foto de portada, o un ícono si no tiene fotos. |
| Unidad | Marca, modelo, año y versión, y debajo el **código interno** (por ejemplo STK-000012), que el sistema asigna solo y es correlativo. |
| Precio | El precio de lista en USD. Si la unidad está marcada **Precio a consultar**, dice "Consultar precio". |
| Estado | Disponible, Reservado, etc. |
| Vendedor | El vendedor asignado a la unidad (solo administradores). |

En el menú de acciones de cada fila:

- **Ver detalle**: abre la ficha completa en solo lectura, sin salir de la
  lista. Está para todos.
- **Editar** y **Eliminar**: solo administradores. Eliminar pide
  confirmación.

> Eliminar una unidad la saca del stock y la despublica. No se deshace desde
> la app.

## Nueva unidad {#nueva-unidad}

Solo un administrador puede dar de alta una unidad.

1. En **Stock**, tocá **Nueva unidad**.
2. Completá al menos los obligatorios: **Año**, **Marca**, **Modelo** y
   **Sucursal**. El resto se puede cargar después; una ficha incompleta es
   válida mientras no se publique.
3. Tocá **Guardar**. Volvés al listado.

Las fotos y la publicación se cargan **después de guardar**, desde la ficha
(ver [Fotos](#fotos) y [Publicar una unidad](#publicar)).

Si llegaste a esta pantalla desde **Agregar auto en permuta** en una
oportunidad, el **Origen** viene en Permuta, arriba se lee a qué oportunidad
se va a vincular y, al guardar, volvés a esa oportunidad. Ver
[Permuta](/ayuda/oportunidades-y-procesos-de-venta#permuta).

## La ficha de la unidad {#ficha-de-unidad}

La ficha (alta y edición) está dividida en tarjetas. Esto es lo que va en cada
una y lo que conviene saber.

**Identificación**

- **Condición**: Nuevo o Usado. Para un usado, publicar exige además patente,
  kilometraje y titular.
- **Año**, **Marca**, **Modelo** (obligatorios) y **Versión** (por ejemplo
  "SRV 4x4").
- **Carrocería**: Sedán, Hatchback, SUV, Pickup, Coupé, Rural, Van,
  Utilitario o Minivan.
- **Patente**, **VIN** y **Número de motor**.

**Comercial**

- **Estado**: ver [Estados de una unidad](#estados). Se puede cambiar a mano,
  pero si la unidad está vinculada a una oportunidad, manda la oportunidad.
- **Origen**: Compra directa, Permuta, Consignación, Importación o Traslado
  entre sucursales. Con **Consignación** aparece la tarjeta del mismo nombre.
- Los cuatro precios: ver [Precios](#precios).
- **Moneda de publicación**: en qué moneda se muestra el precio al público
  (USD y moneda local, Solo USD o Solo moneda local).
- **Ingreso al stock**: la fecha en que entró.
- **Precio a consultar**: en el listado y para el público se muestra
  "Consultar precio" en vez del número.
- **Visible en el listado**: destildalo para que no aparezca en el listado de
  stock del día a día (se vuelve a ver con **Mostrar ocultas**).
- **Acepta permuta** y **Financiación disponible**: marcas comerciales de la
  unidad.
- **Notas internas**: texto libre para el equipo. No se publica.

**Sucursal y asignación**

- **Sucursal** (obligatoria): dónde está la unidad.
- **Vendedor asignado**: quién la vende. Puede quedar sin asignar.
- **Ubicación física**: por ejemplo "Playa trasera, fila 2".
- **Disponible desde**: a partir de qué fecha se puede entregar.

**Consignación** (solo con origen Consignación)

Los datos del dueño y del acuerdo: **Consignante**, **Documento**,
**Teléfono** y **Email del consignante**, **Precio acordado (USD)**,
**Comisión (%)**, **Vencimiento del acuerdo** y **Número de contrato**.

> Si cambiás el origen a otro que no sea Consignación, estos datos **se
> pierden al guardar**. La ficha lo avisa antes.

**Características**

**Kilometraje**, **Transmisión** (Manual, Automática, Automática secuencial,
CVT), **Combustible** (Nafta, Diésel, Híbrido, Eléctrico, GNC, Nafta / GNC),
**Color exterior**, **Terminación del color** (Sólido, Metalizado, Perlado,
Mate), **Cilindrada (L)**, **Tracción** (Delantera, Trasera, 4x4, Integral),
**Puertas**, **Asientos**, **Potencia (HP)**, **Consumo declarado (km/L)**,
**Tapizado** y **Equipamiento**.

El **Equipamiento** es una lista de ítems, uno por etiqueta:

1. Escribí el ítem en el campo (por ejemplo "Aire acondicionado"). Mientras
   tipeás, el texto se convierte a mayúsculas sin acentos ni espacios
   (AIRE_ACONDICIONADO): es el formato en que se guarda.
2. Tocá **+ Agregar equipamiento** o Enter. La etiqueta aparece arriba.
3. Para sacar una, tocá la **×** de la etiqueta.

No se puede repetir un ítem y hay un máximo de 100. Lo que quede escrito en el
campo sin agregar no se guarda.

**Documentación y garantía**

- **Garantía**: Sin garantía, De fábrica, Del concesionario (6 o 12 meses) u
  Otra. Con **Otra** aparece **Detalle de la garantía** para describirla; si
  después elegís otra opción, el detalle se borra.
- **Titular registral**, **Deuda de patente (moneda local)**, **Última
  inspección técnica**.
- Casillas: **Único dueño**, **Service oficial al día**, **Manual y llave de
  repuesto**, **Informe de dominio solicitado**.

**Multimedia**

**Video (URL)**, **Tour 360 (URL)** y la galería de [fotos](#fotos).

**Publicación**

Ver [Publicar una unidad](#publicar).

**Registro** (solo en edición)

El **Código interno**, la fecha de **Alta** y la **Última modificación**, y el
botón **Ver historial de cambios**, que abre la lista de todo lo que se
modificó en la ficha: qué campo, el valor anterior y el nuevo, cuándo y quién
lo cambió.

## Precios {#precios}

La ficha tiene cuatro precios, todos opcionales:

- **Precio de lista (USD)** y **Precio de lista (moneda local)**: el precio
  de venta al público, en las dos monedas. Es el que se muestra en el listado,
  el que ve el agente de IA y el que toma una oportunidad al vincular la
  unidad.
- **Precio mínimo aceptable (USD)**: hasta dónde se puede bajar. Lo ve el
  equipo, nunca el agente ni el público.
- **Costo de adquisición (USD)**: lo que costó la unidad. Igual que el
  anterior, solo para el equipo.

Cuando la organización tiene cargada una cotización (ver
[Organización](/ayuda/organizacion-y-sucursales)), al completar uno de los
dos precios de lista el otro se calcula solo con la cotización vigente. La
ficha muestra qué cotización usó y de qué fecha. El valor calculado se puede
corregir a mano: apenas lo tocás, deja de recalcularse. En edición, los dos
precios guardados se tratan como cargados a mano y no se recalculan.

Si no hay cotización cargada, los dos campos se completan a mano y no pasa
nada más.

## Fotos {#fotos}

Las fotos se cargan desde la ficha, en la tarjeta **Multimedia**, y solo
después de guardar la unidad por primera vez.

- **Subir foto**: elegí un archivo JPEG, PNG o WebP; se sube apenas lo elegís.
  De a una por vez.
- La **primera foto que se sube queda como portada**. Para cambiarla, tocá
  **Marcar portada** en otra.
- **Subir** y **Bajar** cambian el orden en que se muestran.
- **Eliminar** borra una foto (pide confirmación). Para borrar varias, tildá
  la casilla de cada miniatura y usá la barra que aparece.
- Si una foto muestra "Sin vista previa", el archivo no se pudo leer; se
  puede eliminar igual.

Para publicar hace falta al menos una foto.

## Publicar una unidad {#publicar}

Publicar es tildar **Publicar en el sitio web** en la tarjeta
**Publicación**. Es la única puerta por la que una unidad sale al público y
al agente de IA: el agente ofrece solo las unidades publicadas **y** en estado
Disponible.

Para poder publicar, la ficha tiene que estar completa. La tarjeta muestra
una barra de **Completitud para publicar** con el porcentaje y, debajo, la
lista **Falta completar** con lo que falta. Se actualiza mientras escribís.
Lo que se exige:

- Carrocería, Marca, Modelo, Año, Precio de lista en USD y en moneda local,
  Transmisión, Combustible, Color exterior y VIN.
- Si es un **usado**: además Patente, Kilometraje y Titular registral.
- **Al menos una foto**.

Pasos:

1. Completá la ficha hasta que diga "La ficha tiene todo lo necesario para
   publicarse".
2. Subí al menos una foto.
3. Tildá **Publicar en el sitio web** y tocá **Guardar**.

En una unidad **nueva** la casilla está deshabilitada: primero hay que guardar
y subir fotos. Si al guardar el sistema rechaza la publicación, muestra su
propia lista de lo que falta; esa es la que manda.

Los demás campos de la tarjeta:

- **Publicar en portales** y **Destacar en la portada**: marcas de la ficha
  para el equipo; no cambian lo que ve el agente.
- **Descripción pública**: el texto que se muestra al público y que lee el
  agente de IA. Escribila pensando en el cliente.

Para **despublicar**, destildá **Publicar en el sitio web** y guardá. Una
unidad vendida o reservada puede seguir marcada como publicada: no pasa nada,
porque el agente solo ofrece las disponibles.

> Lo que cargás en la ficha de una unidad publicada puede llegar también a la
> base de conocimiento del agente: ver
> [Base de conocimiento](/ayuda/base-de-conocimiento).

## Estados de una unidad {#estados}

| Estado | Qué significa |
|---|---|
| Disponible | Está a la venta. Es el único estado en que el agente la ofrece. |
| Reservado | Una oportunidad abierta la tiene vinculada. Nadie más puede vincularla. |
| En preparación | Entró pero todavía no está lista (limpieza, arreglos). |
| En tránsito | Viene en camino (una importación, un traslado). |
| Vendido | La oportunidad que la tenía se ganó; falta entregarla. |
| Entregado | El cliente se la llevó. Cierre del ciclo. |
| No disponible | Sigue en el stock pero no se ofrece. Igual se puede vincular a una oportunidad. |

El estado se puede elegir a mano en la tarjeta **Comercial**, pero los cambios
importantes los hace el sistema a partir de las oportunidades:

- Vincular la unidad a una oportunidad **abierta** → **Reservado**.
- La oportunidad se **gana** → **Vendido**, y se crea la entrega.
- Se **confirma la entrega** → **Entregado**.
- La oportunidad se **pierde**, se **elimina** o se le **quita el vínculo** →
  vuelve a **Disponible** (o a No disponible si estaba así).
- La oportunidad se **reabre** → vuelve a **Reservado**.

Todo esto está explicado desde el lado de la venta en
[Oportunidades](/ayuda/oportunidades-y-procesos-de-venta#cerrar).

### Qué pasa cuando el agente reserva una unidad

El agente de IA **no reserva unidades por su cuenta**: cuando un cliente dice
"me interesa la Hilux", el agente puede anotar ese interés en la ficha del
contacto, pero eso no toca el stock.

Reservar desde el chat es una acción aparte, que viene **apagada** y que un
administrador tiene que habilitar en la configuración del agente (ver
[Agentes de IA](/ayuda/agentes-de-ia)). Con esa acción habilitada, y solo
cuando el cliente confirmó que quiere avanzar con una unidad concreta, el
agente crea la oportunidad con la unidad vinculada: la unidad pasa a
**Reservado** y deja de ofrecerse a los demás, exactamente igual que si un
vendedor la hubiera vinculado desde el panel.

> Una unidad reservada por el agente queda reservada para todos hasta que
> alguien del equipo cierre esa oportunidad (ganada o perdida) o le quite el
> vínculo. Conviene revisar las oportunidades nuevas que crea el agente.
