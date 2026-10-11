# Plataforma

Esta sección es para el **administrador de la plataforma**: la persona que da
de alta a los clientes (las automotoras) y los deja conectados. El personal de
una automotora no la ve.

Las pantallas están en el grupo **Plataforma** del menú, al final: **Nueva
organización**, **Número de WhatsApp**, **Página de Facebook**, **Modelo de
IA**, **Uso de IA** e **Importar datos**.

> Varias de estas pantallas piden el **identificador** de un agente o de una
> organización: un código largo de letras y números. El del agente aparece en
> la dirección del navegador al abrir la ficha del agente para editarla; el de
> la organización, en la dirección del navegador después de elegirla en
> **Página de Facebook** o en **Importar datos**. Pegalo tal cual, sin
> espacios.

## Nueva organización {#nueva-organizacion}

Crea un cliente nuevo y a la persona que va a administrarlo. Esa persona recibe
un mail para elegir su contraseña y, cuando lo complete, entra como
**administrador** de su organización.

1. Entrá a **Plataforma → Nueva organización**.
2. En **Organización**, escribí el **Nombre de la organización**, tal como se
   llama el negocio (por ejemplo, *Automotores del Sur*).
3. En **Primer administrador**, completá el **Nombre completo** y el **Email**
   de la persona que va a administrar el CRM en esa automotora (por ejemplo,
   *Ana Pérez*, *ana@example.com*).
4. Tocá **Crear organización**.

En **Organización** aparece también **Edición**: **Completa** o **Esencial**
(ver [Las ediciones](#las-ediciones)). Es obligatoria y viene sin ninguna
opción elegida: elegí la que contrató el cliente. Cuando la plataforma ofrece
más de un rubro, aparece también **Rubro** (por ejemplo, **Automotora** o
**Clínica**), con el mismo criterio. Si para alguno de los dos hay una sola
opción disponible, ese campo no aparece y la organización se crea con esa.

> El rubro define qué ve y cómo habla el sistema para ese cliente. Después de
> creada, solo se puede cambiar mientras la organización todavía no tenga
> contactos, turnos, conversaciones ni vehículos.

Al terminar, la pantalla muestra **Organización creada**, con el nombre, un
**Identificador** corto (el nombre abreviado con el que el sistema distingue a
esa organización) y a qué email se mandó la invitación. Avisale al cliente que
revise su correo. Con **Dar de alta otra organización** se vuelve al
formulario vacío.

> Revisá bien el email antes de confirmar: la invitación sale a esa casilla y
> quien la complete queda como administrador del cliente.

### Clínica Demo {#clinica-demo}

Una clínica de demostración, con datos inventados, para mostrarle el sistema a
una clínica antes de que contrate.

1. Entrá a **Plataforma → Nueva organización**.
2. Marcá **Clínica Demo con datos de ejemplo**. El nombre, la edición y el
   rubro desaparecen: la demo se llama **Clínica Demo**, es del rubro clínica y
   de edición **Esencial**.
3. Si querés tener más de una, escribí un **Sufijo del nombre** (por ejemplo,
   *Norte* crea *Clínica Demo Norte*).
4. Completá el **Nombre completo** y el **Email** de quien va a entrar a la
   demo. Le llega la misma invitación que en un alta común.
5. Tocá **Crear Clínica Demo**.

La demo trae la **Sede Centro** con su horario, tres profesionales, cuatro
prestaciones, un bloqueo, la base de conocimiento, ocho pacientes inventados
(sin teléfono), unos quince turnos la semana siguiente, tres atendidos la
semana anterior, un QR de reseñas y un agente **Recepción virtual**. El agente
y las automatizaciones (recordatorio, QR al atender y control) quedan
**desactivados**: la demo no le manda mensajes a nadie.

> La demo no se borra sola. Cuando ya no la necesites, pedí que la borren.

### Las ediciones {#las-ediciones}

| Edición | Qué tiene |
|---|---|
| **Completa** | Todo el CRM: empresas, procesos de venta con su embudo, cotizaciones, pagos, entregas, permutas, financiación y el dashboard comercial, además de todo lo de Esencial. |
| **Esencial** | Contactos y consultas, conversaciones, agentes de IA, stock, agenda, tareas, cupones y QR, automatizaciones y oportunidades simples: cada una está **En curso**, **Vendida** o **Perdida**, sin embudo ni etapas. El dashboard muestra la atención (conversaciones, derivaciones, consultas y tareas) en lugar de los montos. |

Al crear una organización **Esencial**, el sistema le arma su proceso de venta:
**Ventas**, con las etapas **En curso**, **Vendida** y **Perdida**. El cliente
no lo ve ni lo puede cambiar; es lo que ordena sus oportunidades.

En **Esencial**, cada agente de IA arranca sin nivel: el administrador del
cliente tiene que elegir **Cuánto hace la IA** antes de activarlo.

> Una organización **Esencial** se puede pasar a **Completa** desde
> [Organizaciones](#organizaciones). Al revés no: una organización **Completa**
> no vuelve a **Esencial**.

## Organizaciones {#organizaciones}

En **Plataforma → Organizaciones** está la lista de las organizaciones vigentes,
con su **Identificador** y su **Edición**.

### Pasar a edición completa

1. En la fila de una organización **Esencial**, tocá **Pasar a edición
   completa**.
2. Confirmá con **Pasar a completa**.

Arriba de la lista aparece que la organización *ya tiene la edición completa*.
Desde ese momento tiene todos los módulos: empresas, procesos de venta (su
proceso **Ventas** pasa a ser uno común, que puede editar y ver como embudo),
cotizaciones, pagos, entregas, permutas, financiación y el dashboard comercial.
Las oportunidades que ya tenía siguen igual, cada una en la etapa de su estado.
Quien esté usando la app del cliente ve los módulos nuevos al volver a cargar la
página.

> No se puede deshacer: una organización **Completa** no vuelve a **Esencial**.

## Importar datos {#importar-datos}

Cuando un cliente nuevo viene de otro sistema (otro CRM, una planilla de ventas,
un programa de gestión), sus empresas, contactos, historial y stock se traen
desde **Plataforma → Importar datos**: un asistente que lee un archivo o una
planilla de Google, pregunta a qué campo del CRM va cada columna, muestra qué
va a pasar con cada fila antes de tocar nada y, al final, entrega un informe.

Arriba se elige la **Organización** del cliente. Debajo aparecen el formulario
para subir un archivo, las **Sincronizaciones** vigentes (si las hay) y las
**Importaciones anteriores** de esa organización, cada una con su estado
(**Sin configurar**, **Calculando**, **Vista previa lista**, **Importando**,
**Terminada**, **Descartada**, **Deshaciendo**, **Deshecha**). Con **Abrir** se
vuelve a cualquiera: a seguir una que quedó a mitad o a ver su informe.

> La importación corre en segundo plano. Se puede cerrar la pantalla en
> cualquier momento y volver más tarde desde **Importaciones anteriores**.

### Orden recomendado

Cada tipo de dato se importa en un archivo aparte, y el orden importa, porque
unos se refieren a otros:

1. **Empresas** y **Stock de vehículos**, en cualquier orden.
2. **Contactos**: así cada contacto encuentra su empresa (por el nombre) y su
   vehículo de interés (por el código de stock o la patente). Las empresas que
   no existan se crean solas, salvo que elijas lo contrario.
3. **Historial (notas, llamadas y tareas)** al final: cada fila tiene que
   encontrar a su contacto, por el identificador que tenía en el sistema
   anterior, por el email o por el teléfono. Si no lo encuentra, la fila falla.

Importar contactos sin empresas no es un error: la referencia queda vacía y la
vista previa lo avisa. Conviene esperar a que termine una importación antes de
subir la siguiente que depende de ella.

> Usá **el mismo sistema de origen** para todos los archivos del mismo cliente.
> Es lo que permite que un contacto encuentre la empresa que vino del otro
> archivo, y que volver a subir un archivo actualice lo que ya entró en vez de
> duplicarlo.

### Subir el archivo o la planilla

**Cómo tiene que ser el archivo:**

- Un **.xlsx** o un **.csv**, de hasta **10 MB**, **10.000 filas** y **200
  columnas** (un stock más grande se parte en varios). Un **.xls** (Excel
  viejo) o un **.ods** no se pueden leer: guardalo como .xlsx o .csv y volvé a
  subirlo. De un .xlsx con varias hojas se lee la primera.
- **Los encabezados en la primera fila.** No hace falta que se llamen como en
  el CRM: en el paso siguiente se indica a qué campo va cada columna, y el
  asistente sugiere las obvias ("Mail" → Email, "Razón social" → Nombre).
- Un .csv se lee solo. Si en la vista previa ves "Ã±" en vez de "ñ", guardá el
  archivo como .xlsx y subilo de nuevo.
- **Una columna que identifique a cada fila**, si el sistema anterior la tiene
  (un "id" o número interno, o el código de stock para las unidades): con eso,
  volver a subir el archivo corregido actualiza en vez de duplicar. Sin ese
  dato, el sistema reconoce a un contacto por su email o teléfono, a una
  empresa por su nombre y a una unidad por su patente o VIN.
- Las celdas vacías no borran nada: significan "sin dato".

**Pasos:**

1. Elegí la **Organización**.
2. En **Qué se importa**, elegí **Empresas**, **Contactos**, **Historial
   (notas, llamadas y tareas)** o **Stock de vehículos**.
3. En **Sistema de origen**, elegí de dónde vienen los datos. La primera vez,
   **Uno nuevo…** y un **Nombre del sistema de origen** que lo describa (por
   ejemplo, *Planilla de ventas* o *CRM anterior*). En las siguientes
   importaciones del mismo cliente, elegí ese mismo.
4. Si es stock, en **De dónde** elegí **Un archivo (.csv o .xlsx)** o **Un link
   de Google Sheets**. Los demás tipos solo aceptan un archivo: traen datos
   personales, y una planilla compartida por link queda a la vista de
   cualquiera que lo tenga.
5. Subí el **Archivo**, o pegá el **Link de la planilla**. La planilla tiene
   que estar compartida como **"Cualquier persona con el enlace puede ver"**,
   y se lee la pestaña a la que apunta el link. Se toma una foto de la
   planilla en ese momento: lo que alguien edite después no entra.
6. Tocá **Subir y continuar**.

### Mapear columnas

El asistente muestra una fila por cada columna del archivo. En cada una se
elige el campo del CRM al que va; las que quedan en **Ignorar columna** no se
importan. Un campo del CRM recibe una sola columna: si lo elegís en otra, se le
saca a la anterior.

Lo mínimo para poder seguir:

| Tipo | Hace falta mapear |
|---|---|
| Empresas | **Nombre**. |
| Contactos | **Nombre completo**, o bien **Nombre** y **Apellido**. |
| Historial | Una columna que identifique al contacto (**Id del contacto en el origen**, **Email del contacto** o **Teléfono del contacto**), el **Tipo** (una columna, o un tipo para todo el archivo) y el **Autor de las actividades**. |
| Stock | **Marca**, **Modelo** y **Año**, más la **Sucursal de las unidades nuevas** y el **Responsable de los cambios en las fichas**. |

Detalles por tipo:

- **Contactos.** Si el archivo trae el nombre en una sola columna, mapeala a
  **Nombre completo**: la primera palabra queda como nombre y el resto como
  apellido ("Ana María Pérez" → Ana / María Pérez). También se pueden mapear
  columnas a los [campos personalizados](/ayuda/campos-personalizados) de la
  organización. Un valor que no esté entre las opciones de un campo de lista
  hace fallar la fila: la importación no crea opciones nuevas. Si muchas filas
  fallan por el mismo valor, que el administrador del cliente agregue la
  opción y después tocá **Cambiar el mapeo** y **Ver la vista previa**.
- **Historial.** En la tarjeta **Historial** se elige el **Autor de las
  actividades** (un usuario de la organización; por defecto, su administrador
  más antiguo) y, si el archivo no trae columna de tipo, un **Tipo para las
  filas sin tipo**. Si el archivo trae el nombre del autor original, se agrega
  al final del texto de cada actividad ("Autor original: …"). Las tareas que
  venían hechas quedan completadas y confirmadas; las vencidas sin hacer
  quedan abiertas y asignadas al autor elegido.
- **Stock.** En la tarjeta **Stock** se eligen la sucursal, el responsable, la
  **Condición si la fila no la trae** (nuevo o usado), la **Moneda de los
  montos sin moneda** y si se quieren **Importar también las vendidas** (si
  no, se omiten). Las reservadas en el origen entran como **No disponible**:
  el agente no las ofrece. El costo y el precio mínimo se guardan en dólares:
  si vienen en moneda local se convierten con la cotización vigente de la
  organización, que la vista previa muestra; sin cotización, esas filas
  fallan. Las fotos van en una columna con uno o varios links (sirven los de
  Google Drive si el archivo está compartido) y se bajan en segundo plano,
  hasta 20 por unidad y de hasta 5 MB cada una.

**Qué es cada valor.** Al mapear una columna de etapa, de tipo de actividad o,
en el stock, de estado, condición, combustible o caja, el asistente lista los
valores distintos que encontró y pide decir a qué equivale cada uno en el CRM
("Reservado" → Reservada). Un valor **Sin asignar** hace fallar sus filas.

**Formato de los datos.** Ahí se eligen el **Formato de fecha**, el
**Separador decimal**, para contactos el **Separador de listas de opciones**
(campos de selección múltiple) y qué **Valores cuentan como "sí"** y como
**"no"**.

**Duplicados.** En **Si un registro ya existe** se elige qué hacer con las
filas que encuentran un registro que ya está en el CRM:

| Opción | Qué hace |
|---|---|
| **Completar lo vacío sin pisar** | Solo escribe los campos que el CRM tiene vacíos. Lo distinto queda anotado. Es la más segura y la que viene elegida. |
| **Pisar con lo del archivo** | El archivo manda. El antes y el después de cada campo quedan en el informe. |
| **Omitir** | No toca lo que ya existe; solo crea lo nuevo. |

En la vista previa se puede cambiar fila por fila. Para contactos, la casilla
**Crear las empresas que no existen** decide si una empresa del archivo que no
está en el CRM se crea o la referencia queda vacía.

> Hay datos que **nunca se pisan**, ni con "Pisar con lo del archivo": el
> email y el teléfono con los que se reconoció a un contacto, la etapa de un
> contacto cuando el archivo la haría retroceder (de Cliente a Lead), la
> patente o el VIN que identifican a una unidad, y el estado de una unidad que
> maneja el CRM (reservada, vendida o con una oportunidad).

Al tocar **Ver la vista previa**, el sistema revisa todas las filas contra lo
que ya hay en el CRM; mientras tanto muestra **Calculando la vista previa**.

### Vista previa

Es un pronóstico de lo que va a pasar, antes de tocar nada. Arriba, los
totales: **Se crea**, **Se actualiza**, **Choca**, **Sin cambios**, **Se
omite** y **Falla**. Los mismos botones filtran la lista; **Todas** la muestra
completa.

Cada fila es una tarjeta con su número, lo que la identifica (nombre y email,
o marca, modelo y año) y, según el caso:

- el motivo por el que **falla**, o advertencias que no la frenan ("el
  vendedor con ese email no existe", "la empresa «Ejemplo SA» no existe");
- "Se crea la empresa «…»", cuando el archivo trae una empresa nueva;
- si encontró un registro existente, la comparación campo por campo: **Se
  completa** (el CRM lo tenía vacío), **Distinto** (los dos tienen valor y
  difieren) o **No se pisa** (es un dato protegido), con el valor del CRM y el
  del archivo, y **Qué hacer con la fila N**: **La del lote** (lo elegido en
  Duplicados) o una de las tres opciones solo para esa fila.

Si hay empresas por crear, un aviso dice cuántas y muestra ejemplos; **No crear
empresas** lo desactiva para todo el lote.

Desde acá: **Cambiar el mapeo** vuelve al paso anterior sin subir el archivo de
nuevo (al guardar, la vista previa se calcula otra vez); **Descartar** tira el
archivo sin importar nada; **Confirmar e importar** resume cuántas filas se van
a crear, actualizar y fallar y, al aceptar, empieza la importación y la pantalla
muestra el avance (*120 de 850 filas*).

> Si entre la vista previa y la confirmación alguien cargó o editó un contacto
> en el CRM, la importación lo tiene en cuenta: aplica la opción de duplicados
> elegida y lo anota en la fila.

Si el stock vino de un link de Google Sheets, antes de confirmar aparece la
tarjeta **Sincronización**; ver [Sincronizaciones](#sincronizaciones).

### Informe y deshacer

Al terminar, el informe muestra cuántas filas quedaron **Creados**,
**Actualizados**, **Sin cambios**, **Omitidos** y **Fallidas**. Para el stock,
además, cuántas fotos se bajaron, cuántas siguen bajándose y cuántas no se
pudieron bajar.

Tres descargas, según lo que haya pasado:

- **Descargar filas fallidas**: las filas que no entraron, con sus columnas
  originales y una columna **Motivo** al final. Se corrigen ahí mismo y se
  vuelve a subir ese archivo con el **mismo sistema de origen**: lo que ya
  entró no se duplica.
- **Descargar cambios**: cada campo que la importación actualizó, con el valor
  de antes y el de después. Es la forma de corregir a mano un "pisar" que no
  debía pasar.
- **Descargar fotos sin bajar** (stock): cada link que no se pudo bajar y el
  motivo (no es una imagen, el archivo de Drive no está compartido, pasa el
  tope de 20 por unidad).

**Deshacer lo creado** da de baja todo lo que **esa** importación creó. Pide
confirmación y mientras corre muestra **Deshaciendo**. Al terminar, el informe
pasa a **Informe (deshecha)** y dice cuántos registros se dieron de baja y, si
dejó alguno, cuál y por qué.

> Deshacer no es volver atrás del todo:
>
> - **Lo que la importación actualizó no se revierte.** Para eso está el
>   archivo de cambios.
> - **Lo que ya tuvo uso propio en el CRM se deja**: un contacto que después
>   recibió una conversación, una oportunidad o una nota cargada a mano; una
>   unidad con una oportunidad o una entrega; una empresa con contactos que no
>   vinieron de esta importación. El informe lista cada uno con su motivo.
> - Se puede deshacer hasta 90 días después.

Con **Nueva importación** se vuelve a empezar para la misma organización.

### Sincronizaciones

Si el stock de un cliente vive en una planilla de Google Sheets que él mantiene
al día, se puede dejar que el CRM la lea sola cada cierta cantidad de horas.

**Cómo se activa.** Solo en una importación de stock que vino de **Un link de
Google Sheets**. En la vista previa, antes de confirmar:

1. Marcá **Mantener sincronizado con la planilla**.
2. Indicá **Cada cuántas horas** (entre 1 y 168; 6 es un buen valor).
3. Si querés que una unidad que desaparezca de la planilla deje de ofrecerse,
   marcá **Pasar a No disponible las unidades que desaparezcan de la
   planilla**. Viene apagado.
4. Tocá **Confirmar e importar**.

**Qué hace cada corrida.** Lee la planilla con el mismo mapeo y los mismos
ajustes de la importación original, y se importa sola, sin vista previa. Cada
corrida queda como una importación más, con el mismo informe.

- **La planilla manda sobre los campos mapeados**: los actualiza en cada
  corrida. Lo que no está mapeado no se toca, y de las fotos solo se bajan los
  links nuevos.
- **Nunca borra nada**, y el estado que maneja el CRM (reservada, vendida, con
  una oportunidad) no se pisa, ni siquiera para marcarla no disponible.
- **Las unidades que ya no están en la planilla** se informan en cada corrida.
  Pasan a **No disponible** solo si se marcó esa opción y la corrida no tuvo
  filas fallidas. Si la unidad vuelve a aparecer, no vuelve sola a Disponible
  salvo que la columna de estado esté mapeada.

**La lista.** En **Importar datos**, después de elegir la organización, la
tarjeta **Sincronizaciones** muestra cada una con su sistema de origen, cada
cuántas horas corre y cuándo fue la última vez ("última sincronización hace
2 h"). Los estados:

| Estado | Qué significa |
|---|---|
| **Activa** | Corre con normalidad. |
| **La última falló** | La última corrida no pudo leer la planilla; el error se muestra debajo. Va a volver a intentar. |
| **Pausada** | Alguien la pausó a mano. |
| **Pausada: falló 3 veces seguidas** | Se pausó sola. Queda resaltada hasta que se corrija y se reanude. |

Las causas típicas de una falla: la planilla dejó de estar compartida con el
enlace, o le borraron o renombraron una columna mapeada. Una corrida con filas
fallidas pero que pudo leer la planilla no cuenta como falla.

Botones por sincronización: **Ver la última corrida** (abre su informe),
**Pausar** / **Reanudar** (después de corregir la planilla, **Reanudar** la
hace correr en el próximo intervalo) y **Borrar** (la planilla deja de
sincronizarse; lo que ya se importó queda como está).

> Si la última sincronización figura "hace 14 h" y el intervalo era de 6, el
> sistema estuvo detenido un rato. No se pierde nada: al volver corre una vez
> y programa la siguiente desde ese momento.

## Número de WhatsApp {#whatsapp}

Cada agente de IA que atiende por WhatsApp necesita tener asignado el número
desde el que habla. Lo asigna **solo la plataforma**: el administrador del
cliente lo ve en la ficha de su agente, de solo lectura. Lo que se carga **no
es el teléfono**, sino el **"Phone number ID"** que Meta muestra para ese
número en su panel de WhatsApp: solo dígitos, como *123456789012345*.

1. Entrá a **Plataforma → Número de WhatsApp**.
2. Pegá el **ID del agente** (ver el recuadro al principio de esta sección).
3. Pegá el **ID del número de WhatsApp**.
4. Tocá **Guardar**.

La pantalla pasa a **Número de WhatsApp actualizado** y muestra el agente, su
organización y el número asignado. Con **Asignar otro número** se vuelve al
formulario.

- **Para liberar un número**, guardá con el campo **ID del número de WhatsApp**
  vacío: el resultado dice "Sin número asignado: el número quedó libre."
- **Un número va a un solo agente.** Si otro agente ya lo tiene, primero hay
  que liberarlo desde ese agente.

> Asignar el número no alcanza para que el agente atienda: el administrador
> del cliente tiene que habilitar **WhatsApp** en los **Canales** del agente.
> Ver [Agentes de IA](/ayuda/agentes-de-ia).

## Página de Facebook e Instagram {#facebook}

Para que los agentes de un cliente contesten por Messenger y por Instagram, hay
que conectar la página de Facebook del negocio (y la cuenta de Instagram
vinculada a esa página) con su organización, y después decir qué agente atiende
esa página. Las dos cosas se hacen en **Plataforma → Página de Facebook**, y
las hace **solo la plataforma**: el administrador del cliente ve el estado en
su configuración, sin botones.

### Antes de empezar

**Lo que hace el cliente, una sola vez:**

1. Tener la página de Facebook del negocio dentro de un portfolio comercial de
   Meta (Meta Business Suite). Para atender también por Instagram, la cuenta
   profesional de Instagram tiene que estar **vinculada a esa página**; si no,
   la conexión queda solo con Messenger.
2. Desde la configuración de su portfolio, **compartir la página con el
   portfolio de la plataforma como socio**, con permiso para administrar la
   página y sus mensajes (y la cuenta de Instagram, si la hay). Para eso se le
   pasa el identificador del portfolio de la plataforma.

El cliente no entra al CRM para esto y nunca ve la pantalla de Meta.

**Lo que hace la plataforma antes de conectar:** en su portfolio, la página
compartida aparece entre los activos de socios. Hay que asignársela a la
persona que va a conectar, con la misma cuenta de Facebook con la que va a
iniciar sesión; si no, Meta no la muestra para elegir.

### Conectar la página

1. Entrá a **Plataforma → Página de Facebook** y elegí la **Organización**.
2. En la tarjeta **Facebook e Instagram de la organización**, que dice **Sin
   conectar**, tocá **Conectar con Facebook**. La pestaña se va a Facebook.
3. Entrá con la cuenta de Facebook que tiene asignada la página.
4. En la pantalla de Meta, elegí el portfolio de la plataforma y, entre las
   páginas, **marcá una sola: la del cliente**.
5. Meta vuelve a esta misma pantalla con la organización ya elegida. Se ve
   "Conectando la página de Facebook…" y, enseguida, "La página de Facebook
   quedó conectada."

La tarjeta pasa a **Conectada**, con el nombre de la página y el usuario de
Instagram (por ejemplo, *Automotores del Sur · @automotoresdelsur*) y, en
chico, sus identificadores numéricos, que sirven para el paso siguiente y para
cruzar con el panel de Meta. Si no hay Instagram vinculado, lo dice.

> Si marcás más de una página, la conexión se rechaza ("Autorizaste más de una
> página") y hay que repetir desde **Conectar con Facebook**.

Otros mensajes que pueden aparecer:

- **"la empezó otro usuario"** o **"ya se usó"**: el intento de conexión queda
  atado a quien tocó **Conectar**, a la organización elegida y a los 10 minutos
  siguientes, y sirve una sola vez. Volvé a tocar **Conectar con Facebook**.
- **La página ya está conectada a otra organización**: hay que desconectarla
  de la otra primero.
- **"La conexión dejó de funcionar"**: Meta dejó de aceptarla, por ejemplo
  porque el cliente le quitó el acceso al portfolio de la plataforma o la
  persona que conectó perdió el acceso a la página. Se revisa el acceso y se
  vuelve a conectar desde esta pantalla.

Con la página conectada hay dos botones:

- **Volver a conectar**: repite el flujo sobre la misma página sin pasar por
  desconectar, para refrescar la conexión sin dejar un hueco sin mensajes. No
  toca el agente asignado ni los canales.
- **Desconectar**: pide confirmación. Los agentes de esa organización dejan de
  contestar por Messenger y por Instagram, y la página queda libre.

> **Una organización tiene una sola página.** Conectar otra página reemplaza
> la anterior, y las conversaciones que llegaron por la anterior ya no se
> pueden responder.

### Asignar la página a un agente

Debajo, en la tarjeta **Página de un agente**:

1. Pegá el **ID del agente**.
2. Pegá el **ID de la página de Facebook**: el número que quedó a la vista en
   la tarjeta de arriba. Es el identificador numérico que Meta muestra para la
   página, no su nombre ni su dirección web: solo dígitos, como
   *123456789012345*.
3. Tocá **Guardar**. La tarjeta pasa a **Página asignada a** y el nombre del
   agente; con **Asignar otra página** se vuelve al formulario.

Guardar con el campo vacío libera la página. **Una página va a un solo
agente**: si otro ya la tiene, hay que liberarla primero.

### Para terminar

El administrador del cliente habilita **Messenger** y/o **Instagram** en los
**Canales** del agente (ver [Agentes de IA](/ayuda/agentes-de-ia)) y ve en su
[configuración de la organización](/ayuda/organizacion-y-sucursales) si la
página está **Conectada** o **Sin conectar**. Después, mandale un mensaje a la
página por Messenger (y por Instagram, si corresponde) y comprobá que el agente
contesta y que la conversación aparece en la bandeja del cliente.

## Modelo de IA {#modelo-de-ia}

El modelo es el "motor" de inteligencia artificial que usa un agente para
entender y redactar. Lo elige **solo la plataforma**, porque todas las
organizaciones usan la misma cuenta con el proveedor y el gasto lo paga la
plataforma. Un agente nuevo nace con el modelo por defecto; el administrador
del cliente lo ve en la ficha de su agente, de solo lectura, y si necesita otro
lo pide.

En **Plataforma → Modelo de IA** hay dos tarjetas, porque son dos tipos de
agente:

**Agente de atención a clientes** (los que atienden por WhatsApp, Messenger,
Instagram o la web):

1. Pegá el **ID del agente**.
2. Escribí el **Modelo**: el nombre exacto tal como lo publica el proveedor
   (OpenRouter), por ejemplo *openai/gpt-4o-mini*.
3. Tocá **Guardar**. Debajo aparece "*Nombre del agente* ahora usa *modelo*."

**Agente interno de una organización** (el asistente que usa el personal del
cliente desde adentro del CRM; hay uno por organización): lo mismo, pero con
el **ID de la organización** en vez del del agente.

La organización tiene que haber configurado su agente interno antes; esta
pantalla no lo crea. Quien es administrador de la plataforma también puede
cambiar el modelo desde la ficha del propio agente.

> Un nombre de modelo mal escrito o inexistente **no da error al guardar**: el
> error aparece recién cuando el agente intenta usarlo, y en ese momento el
> agente deriva la conversación a una persona. Después de cambiar un modelo,
> probá el agente con un mensaje.

## Uso de IA {#uso-de-ia}

**Plataforma → Uso de IA** muestra cuánto gastó cada organización en IA en los
**últimos 30 días**. Es una vista de solo lectura, sin filtros ni fechas, con
una fila por organización, ordenadas de la que más gastó a la que menos:

| Columna | Qué es |
|---|---|
| **Organización** | El cliente. |
| **Turnos** | Cuántas veces un agente respondió en ese período. Cada respuesta del agente es un turno, cualquiera sea el canal. |
| **Tokens de entrada** | Cuánto texto leyó el modelo para responder (la conversación, las instrucciones del agente, lo que buscó en el stock y la base de conocimiento). |
| **Tokens de salida** | Cuánto texto escribió el modelo. |
| **Costo (USD)** | Lo que el proveedor informó que costaron esos turnos, en dólares. |

Un *token* es la unidad en la que el proveedor mide el texto: a grandes rasgos,
una palabra corta o un pedazo de una larga.

> El costo lo informa el proveedor en cada respuesta. Cuando no lo informó en
> ningún turno del período, la columna muestra **—**: no significa que haya
> sido gratis.

Aparecen todas las organizaciones vigentes, también las que no usaron agentes
en el período (quedan en cero).
