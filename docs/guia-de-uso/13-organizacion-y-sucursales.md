# Configuración de la organización y sucursales

Todo lo que está en esta sección es **solo para administradores**: las
pantallas **Organización**, **Sucursales**, **Fuentes de ingesta**,
**Claves de ingesta** y **Eventos de ingesta** viven en el menú
**Administración** y un usuario no las ve. Lo que se configura acá lo usan
después todas las demás pantallas: las monedas del stock y las
oportunidades, los horarios de los turnos, los mensajes automáticos y los
agentes de IA.

## Organización {#organizacion}

En el menú: **Administración → Organización**. Es una sola pantalla con los
datos generales de la organización, agrupados en tarjetas. Los cambios de
las primeras tres tarjetas se guardan con el botón **Guardar** del final;
las otras dos son informativas.

### Moneda

- **Moneda de preferencia**: la moneda principal de la operación. Es en la
  que se muestran los totales del dashboard (lo ganado, las mayores
  oportunidades abiertas) y la que se propone al cargar precios.
- **Moneda alternativa**: la segunda moneda en la que se muestran los
  precios. En el stock, cada unidad tiene un precio de lista en cada una de
  las dos, y al completar uno el otro se calcula con la cotización vigente.

Las opciones son **USD** y **UYU**, o **Sin configurar**. No pueden ser la
misma: si elegís la misma en las dos, el sistema lo rechaza al guardar.

### Teléfonos

**Código de país por defecto**: el código con el que el sistema completa los
teléfonos que se cargan sin código de país, en formato local. Por ejemplo,
con **598** cargado, un contacto con el teléfono "099 123 456" se guarda como
un número de Uruguay. Va sin el signo "+", de 1 a 3 dígitos.

> Sin un código de país configurado, un teléfono cargado en formato local
> (sin el código adelante) se rechaza. Si ves que a los contactos que entran
> por una landing les falta el teléfono, lo más probable es que falte esto.

### Zona horaria

La zona con la que el dashboard calcula "hoy", "esta semana" y "este mes".
Elegí tu ciudad (Montevideo, Buenos Aires, Santiago, São Paulo, etc.). No
confundir con la zona horaria de cada sucursal (ver
[Crear o editar una sucursal](#nueva-sucursal)): esa define los horarios de
los turnos y del horario de atención.

### Cotización vigente

Solo lectura. Muestra la cotización del dólar que usa el sistema (por
ejemplo, "1 USD = 40,50 UYU") y de qué fecha es. Se actualiza sola una vez
por día, siempre que haya una moneda distinta de USD configurada; hasta que
eso pase, la tarjeta dice que todavía no hay cotización cargada. Con esta
cotización se calculan los precios del stock en la otra moneda.

### Facebook e Instagram

Solo informativa. Con la página de Facebook de la organización conectada,
los agentes de IA que la tengan asignada contestan por Messenger y, si la
página tiene una cuenta de Instagram vinculada, también por Instagram.

- **Conectada**: muestra el nombre de la página y la cuenta de Instagram
  (o "sin Instagram vinculado"), y debajo sus números de identificación,
  por si tenés que cruzarlos con el panel de Meta.
- **Sin conectar**: todavía no se conectó ninguna página.
- Si la conexión dejó de funcionar (por ejemplo, Facebook retiró el
  permiso), la tarjeta lo avisa con el motivo.

> La conexión con Facebook e Instagram **la configura el equipo de la
> plataforma**, no se hace desde esta pantalla. Si está sin conectar o dejó
> de funcionar, avisales. Qué agente atiende por esa página se elige en
> [Agentes de IA](/ayuda/agentes-de-ia).

## Sucursales {#sucursales}

En el menú: **Administración → Sucursales**. Una sucursal es cada local o
punto de atención de la organización ("Sucursal Centro", "Sucursal Norte").
Casi todo cuelga de una sucursal: los agentes de IA y su base de
conocimiento, los QR, el stock, los recursos y turnos de la agenda, el
horario de atención, los medios de pago y el calendario de Google.

**El listado.** Muestra **Nombre** y **Zona horaria** de cada sucursal.
Podés buscar por nombre y ordenar por fecha de creación o por nombre. El
menú de acciones de cada fila tiene **Editar** y **Eliminar**.

**Nueva sucursal**, arriba a la derecha, abre el formulario (ver
[Crear o editar una sucursal](#nueva-sucursal)).

> Una sucursal no se puede eliminar mientras tenga recursos activos, tipos
> de servicio, QR activos o Google Calendar conectado. Al intentarlo, el
> sistema te dice qué hay que sacar primero.

## Crear o editar una sucursal {#nueva-sucursal}

1. En **Sucursales**, tocá **Nueva sucursal** (o **Editar** en una
   existente).
2. Completá los datos de abajo.
3. Tocá **Guardar**. Volvés al listado.

Los campos con asterisco son obligatorios.

### Datos de la sucursal

- **Nombre** (obligatorio): como la va a ver el equipo en los selectores.
- **Zona horaria** (obligatorio): viene preseleccionada Montevideo; también
  hay Santiago y Asunción. Define en qué hora se interpretan los turnos de
  los recursos de esta sucursal y su horario de atención. Si tu ciudad no
  está, elegí la que tenga el mismo horario (Buenos Aires y Montevideo, por
  ejemplo, funcionan igual).
- **Vendedor por defecto**: la persona a la que el agente de IA le asigna un
  contacto que todavía no tiene vendedor (por ejemplo, alguien que escribe
  por primera vez por WhatsApp). El contacto queda asignado a esa persona y
  después se puede cambiar desde su ficha, como cualquier otro. Podés dejar
  **Sin vendedor por defecto**.

### Cobro

Los medios de pago que el agente de IA le comparte al cliente cuando quiere
pagar (una seña, por ejemplo). Si el cliente solo pregunta qué medios de
pago aceptan, el agente nombra los que estén cargados. Los dos campos son
opcionales e independientes:

- **Link de pago**: una dirección web completa, que empiece con
  `https://`.
- **Datos para transferencia**: texto libre, hasta 2000 caracteres (banco,
  tipo y número de cuenta, titular).

> Lo que escribas acá se lo manda el agente al cliente tal cual. Revisá que
> los datos de la cuenta estén bien antes de guardar.

### Después de crearla

Las tarjetas **Horario de atención** y **Google Calendar** aparecen solo al
editar una sucursal ya creada, porque dependen de ella. Cada una se guarda
con sus propios botones, aparte del **Guardar** del formulario.

## Horario de atención {#horario}

Está en el formulario de la sucursal, al editarla. Es la franja en la que
el negocio atiende, y el sistema la usa para:

- mandar los mensajes automáticos (pedidos de reseña, cupones, seguimientos
  por WhatsApp) solo dentro de ese horario;
- decirle al cliente cuándo le van a escribir, cuando un agente de IA
  deriva la conversación a una persona y nadie del equipo responde fuera de
  hora (ver [Agentes de IA](/ayuda/agentes-de-ia)).

El agente de IA responde a los clientes a cualquier hora: este horario no
lo limita.

**El horario por defecto.** Si nunca cargaste uno, la sucursal usa lunes a
sábado de 9:00 a 20:00 y la tarjeta lo avisa. Cargar uno propio es
opcional.

**Cargar un horario propio.**

1. En la tarjeta, cada día de la semana tiene sus franjas. Un día sin
   franjas dice **"No atiende"**.
2. Tocá **Agregar franja** en el día que quieras. La primera franja se
   propone de 09:00 a 18:00; las siguientes arrancan donde terminó la
   anterior. Corregí **Desde** y **Hasta** escribiendo la hora como `HH:MM`
   (por ejemplo, `09:00`; `24:00` vale como fin del día).
3. Un día puede tener varias franjas (mañana y tarde, por ejemplo). Para
   sacar una, tocá **Quitar**.
4. Tocá **Guardar horario**.

El sistema revisa que cada hora tenga el formato correcto, que cada franja
empiece antes de terminar, que las franjas de un mismo día no se pisen y
que no haya más de 50 en total; si algo no cierra, te dice qué día y qué
franja.

**Volver al horario por defecto.** Si la sucursal tiene horario propio,
aparece el botón **Volver al horario por defecto**: borra el horario cargado
(previa confirmación) y vuelve a lunes a sábado de 9:00 a 20:00. Guardar la
semana con todos los días vacíos tiene el mismo efecto.

> El horario se guarda con **Guardar horario**, no con el **Guardar** del
> final del formulario. Si cambiás franjas y te vas con el otro botón, el
> horario queda como estaba.

## Google Calendar {#google-calendar}

Está en el formulario de la sucursal, al editarla. Con Google Calendar
conectado:

- cada reserva que se toma en la agenda de esta sucursal aparece también en
  ese calendario de Google;
- los eventos que ese calendario ya tenga ocupan esos horarios, así que no
  se ofrecen turnos encima de ellos.

Los botones de esta tarjeta actúan al momento, sin pasar por el **Guardar**
del formulario.

**Conectar.**

1. Tocá **Conectar con Google Calendar**. Se abre una pestaña nueva con la
   pantalla de autorización de Google.
2. En esa pestaña, ingresá con la cuenta de Google cuyo calendario quieras
   usar para la sucursal y aceptá los permisos. Al terminar, Google te
   devuelve al formulario de la sucursal con el aviso **"Google Calendar
   quedó conectado"**.
3. En la pestaña original, tocá **Volver a consultar** para ver el estado
   actualizado. Si la pestaña de Google no se abrió (algunos navegadores
   bloquean las ventanas nuevas), usá el link **"Si no se abrió, abrila
   acá"**.

**Los estados.**

- **Sin conectar**: no hay calendario.
- **Conectado**: muestra qué calendario está vinculado y el botón
  **Desconectar**.
- **"La conexión dejó de funcionar"**: Google dejó de aceptar la
  autorización (por ejemplo, se cambió la contraseña o se retiró el
  permiso). Se muestra el motivo; volvé a conectarla con el botón.
- Si al volver de Google ves **"No pudimos conectar Google Calendar"** con
  un motivo, repetí el proceso desde el paso 1.

**Desconectar.** Tocá **Desconectar** y confirmá. Las reservas nuevas de la
sucursal dejan de aparecer en el calendario; lo que ya estaba cargado en
Google no se borra.

> No se puede eliminar una sucursal con Google Calendar conectado:
> desconectalo primero.

## Fuentes de ingesta {#fuentes-de-ingesta}

En el menú: **Administración → Fuentes de ingesta**. Una fuente de ingesta
es cada camino por el que entran contactos al CRM desde afuera, sin que
nadie los cargue a mano. Hay dos tipos:

- **Webhook**: el formulario de una landing o del sitio web manda cada
  consulta directo al CRM. Quien arma el sitio necesita una
  [clave de ingesta](#claves-de-ingesta) de esa fuente.
- **Importación de archivo**: subís una planilla (.csv o .xlsx) con
  contactos, por ejemplo una base de clientes de una feria (ver
  [Importar un archivo](#importar-archivo)).

Cada contacto que llega por una fuente queda registrado como un
[evento de ingesta](#eventos-de-ingesta), que dice si se convirtió en
contacto o por qué falló.

**El listado.** Columnas **Nombre**, **Tipo**, **Estado** (**Activa** o
**Pausada**) y **Creada**. Podés buscar por nombre, filtrar por tipo y por
estado, y ordenar por fecha de creación o por nombre.

**Las acciones** de cada fila (los tres puntos):

- **Ver detalle**: nombre, tipo, estado, fecha y, en las de importación de
  archivo, el mapeo de columnas.
- **Editar**: abre el formulario (ver
  [Crear o editar una fuente](#nueva-fuente)).
- **Ver claves**: las claves de ingesta de esta fuente, ya filtradas.
- **Importar archivo**: solo en las de tipo importación de archivo.
- **Ver eventos**: los eventos de ingesta de esta fuente, ya filtrados.
- **Eliminar**: retira la fuente, previa confirmación.

**Nueva fuente**, arriba a la derecha, abre el formulario.

> Al eliminar una fuente, **todas sus claves de ingesta se revocan** y dejan
> de funcionar en el momento: el formulario del sitio que la usaba deja de
> mandar contactos. Si solo querés frenarla un tiempo, desmarcá **Activa**
> en el formulario (pausarla) en vez de eliminarla.

Esto no es lo mismo que **Plataforma → Importar datos**: esa herramienta la
usa el equipo de la plataforma para traer contactos, empresas y stock de un
sistema anterior cuando se da de alta un cliente.

## Crear o editar una fuente {#nueva-fuente}

1. En **Fuentes de ingesta**, tocá **Nueva fuente** (o **Editar**).
2. Completá los campos.
3. Tocá **Guardar**. Volvés al listado.

**Los campos.**

- **Nombre** (obligatorio): para reconocerla, por ejemplo "Landing Hilux
  2026" o "Planilla feria del automóvil".
- **Tipo**: **Webhook** o **Importación de archivo**. Se elige al crearla y
  **no se puede cambiar después**: una integración de webhook no se
  convierte en una importación de archivo. Si necesitás otro tipo, creá una
  fuente nueva.
- **Activa**: marcada, la fuente recibe contactos. Desmarcada, la fuente
  queda **pausada**: las importaciones contra ella se rechazan y lo que
  llegue por su clave no entra. Sirve para frenar una campaña sin perder la
  configuración.

### Mapeo de columnas

Aparece solo en las fuentes de tipo **Importación de archivo**. Le dice al
sistema qué columna del archivo va a qué dato del contacto. Cada fila tiene:

- **Columna del archivo**: el encabezado tal como está en la planilla (por
  ejemplo, "Nombre y apellido" o "Celular").
- **Campo del contacto**: a dónde va: **Nombre**, **Apellido**, **Email**,
  **Teléfono** o **Puesto**.

Tocá **Agregar columna** por cada una que quieras mapear (hasta 50) y
**Quitar** para sacar una. Cada campo del contacto puede usarse una sola
vez, y las filas a medio completar no se pueden guardar.

Si no cargás ninguna fila, el sistema espera que los encabezados del
archivo se llamen exactamente `firstName`, `lastName`, `email`, `phone` y
`jobTitle`. Para cualquier planilla "normal", cargá el mapeo.

**Sugerir mapeo desde un archivo de muestra.** Para no escribir los
encabezados a mano:

1. Tocá **Sugerir mapeo desde un archivo de muestra (.csv o .xlsx)** y
   elegí una planilla de ejemplo (la misma que vas a importar sirve).
2. Tocá **Sugerir mapeo desde un archivo**. El sistema lee solo los nombres
   de las columnas y agrega una fila por cada una, sin tocar las que ya
   tenías.
3. En cada fila nueva elegí el **Campo del contacto** y quitá las columnas
   que no te interesen.
4. Tocá **Guardar**: recién ahí se guarda el mapeo.

El archivo de muestra no se importa ni se guarda en ningún lado: solo se
leen sus encabezados.

> Los encabezados tienen que coincidir **exactamente** con los del archivo
> que después importes (mayúsculas, tildes y espacios incluidos). Si al
> importar todas las filas fallan, lo primero a revisar es esto; la
> pantalla de importación te muestra las columnas que detectó.

### Si la fuente es un webhook

Después de guardarla, creá una [clave de ingesta](#claves-de-ingesta) para
ella y pasásela a quien arma el formulario del sitio. Es lo único que
necesita para empezar a mandar contactos.

## Claves de ingesta {#claves-de-ingesta}

En el menú: **Administración → Claves de ingesta**. Una clave de ingesta es
la "contraseña" con la que un sistema externo (el formulario de una landing,
por ejemplo) se identifica para mandarle contactos a una fuente. Cada clave
pertenece a una sola fuente; una fuente puede tener varias claves.

### Crear una clave

1. Arriba de la pantalla, en **Fuente para la clave nueva**, elegí la fuente.
   Si llegaste desde **Ver claves** de una fuente, ya viene elegida.
2. Tocá **Crear clave**.
3. Se abre el cuadro **Clave de ingesta creada** con la clave completa.
   Copiala con el botón de copiar (o seleccionala y copiala a mano) y
   guardala en un lugar seguro, o pasásela ya a quien la va a usar.
4. Tocá **Listo, ya la guardé**.

> **Esta es la única vez que vas a poder ver la clave.** El sistema no la
> guarda completa en ningún lado: si la perdés, hay que revocarla y crear
> otra.

### El listado

Columnas **Fuente**, **Prefijo** (los primeros caracteres de la clave, para
saber cuál es cuál), **Estado** (**Activa** o **Revocada**), **Último uso**
("Nunca" si todavía no se usó) y **Creada**. Si la fuente fue eliminada, al
lado de su nombre dice "(eliminada)".

Podés filtrar por **Fuente** y por **Estado**, y ordenar por fecha de
creación o por último uso. **Último uso** sirve para saber si la landing
está mandando contactos: si una clave que debería usarse dice "Nunca", algo
está mal del lado del sitio.

### Revocar una clave

1. Buscá la fila (el prefijo te ayuda a identificarla).
2. Tocá **Revocar** y confirmá.

La clave deja de funcionar de inmediato y no se puede volver atrás: lo que
la usaba deja de poder mandar contactos. Si tenés que reemplazarla, creá
primero la nueva, pasala a quien corresponda y recién después revocá la
vieja, así no se pierde ninguna consulta en el medio.

## Eventos de ingesta {#eventos-de-ingesta}

En el menú: **Administración → Eventos de ingesta**. Es el registro de cada
contacto que intentó entrar por una fuente de ingesta, con qué pasó con él.
Sirve para controlar que una landing está funcionando y para ver por qué
una fila de un archivo no se convirtió en contacto.

**Las columnas.** **Fuente**, **Estado**, **Motivo**, **Creado**,
**Actualizado** y **Acciones**.

**Los estados.**

- **Pendiente**: llegó y está esperando que el sistema lo procese. Pasa a
  procesado o fallido en segundos o minutos.
- **Procesado**: ya es un contacto. La acción **Ver contacto** abre su
  ficha.
- **Fallido**: no se pudo convertir en contacto; la columna **Motivo** dice
  por qué (un email mal escrito, un teléfono inválido, una columna que no
  coincide con el mapeo). La acción **Reintentar** lo vuelve a procesar.
- **Duplicado**: el mismo contacto ya había entrado antes por esa fuente.
- **Agotó los reintentos**: falló varias veces seguidas y el sistema dejó de
  intentar solo.
- **Sin confirmar**: filas de una importación del equipo de la plataforma
  que todavía no se confirmó.

En un evento **Procesado**, el **Motivo** puede decir "Revisión manual: el
teléfono no se pudo normalizar y no se guardó": el contacto entró, pero sin
teléfono, porque el número no se pudo interpretar. Abrí la ficha con **Ver
contacto** y cargalo a mano.

**Los filtros.** Por **Fuente**, por **Estado** y el **Orden** (más
recientes o más antiguos primero). Si llegaste desde **Ver estas filas** de
una importación, arriba dice **"Mostrando solo las filas del lote…"**: ves
únicamente las de ese archivo, y **Ver todos los eventos** saca ese filtro.

**Reintentar** no es destructivo: como mucho vuelve a fallar, y el motivo se
reemplaza por el del intento nuevo. Conviene usarlo después de corregir la
causa (por ejemplo, cargar el código de país en
[Organización](#organizacion) si los teléfonos venían sin él). Si la fuente
del evento está pausada o fue eliminada, el reintento se rechaza: reactivala
primero.

## Importar un archivo {#importar-archivo}

Para subir una planilla de contactos contra una fuente de tipo
**Importación de archivo**. Antes de empezar, la fuente tiene que existir y
tener el mapeo de columnas cargado (ver
[Crear o editar una fuente](#nueva-fuente)).

1. En **Fuentes de ingesta**, abrí el menú de acciones de la fuente y tocá
   **Importar archivo**. Arriba de la pantalla se ve a qué fuente estás
   importando.
2. Tocá **Archivo (.csv o .xlsx, hasta 10 MB)** y elegí la planilla. Un
   archivo .xls o .ods no se puede leer: guardalo como .xlsx o .csv desde
   tu planilla y volvé a subirlo.
3. Tocá **Importar**.
4. Aparece la tarjeta **Resultado de la importación** con:
   - **Lote**: el identificador de esta subida.
   - **Filas leídas**: cuántas filas tenía el archivo.
   - **Eventos creados**: cuántas entraron a procesarse.
   - **Filas ya importadas antes (no se duplicaron)**: filas que ya habían
     entrado en una subida anterior de esa fuente y se saltearon.
   - **Columnas detectadas**: los encabezados que leyó el sistema. Si no
     coinciden con el mapeo de la fuente, las filas van a fallar: compará
     letra por letra.
5. Las filas se procesan en segundo plano. Tocá **Actualizar estado** las
   veces que haga falta para ver el **Estado del lote**: **Total**,
   **Pendientes**, **Promovidos a contactos** y **Fallidos**, y debajo la
   lista de **Filas que fallaron** con el motivo de cada una (se muestran
   hasta 100; si quedaron más afuera, la pantalla lo dice).
6. **Ver estas filas** abre [Eventos de ingesta](#eventos-de-ingesta)
   filtrado por este lote, donde podés reintentar las fallidas una por una.

Si la fuente está **pausada**, la pantalla lo avisa arriba y la importación
se rechaza: reactivala desde su formulario antes de subir el archivo.

Consejos para que la importación salga bien:

- Los encabezados de la planilla tienen que ser exactamente los del mapeo de
  la fuente. Si cambiás el archivo, actualizá el mapeo (o al revés).
- Los teléfonos conviene cargarlos con el código de país, o configurar el
  **Código de país por defecto** en [Organización](#organizacion) antes de
  importar.
- Subir el mismo archivo dos veces no duplica contactos: las filas repetidas
  se cuentan en "Filas ya importadas antes".

> Lo que se importa son contactos nuevos. Para traer la base completa de un
> sistema anterior (empresas, stock, historial), el camino es
> **Plataforma → Importar datos**, que maneja el equipo de la plataforma.
