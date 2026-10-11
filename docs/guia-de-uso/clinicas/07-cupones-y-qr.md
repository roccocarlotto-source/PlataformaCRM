# Cupones y QR

Dos herramientas para después del turno: los **códigos QR**, que llevan al
paciente a un link que vos elegís (por ejemplo, para dejar una reseña en
Google), y los **cupones de descuento**, que se le mandan a un paciente por
WhatsApp y se canjean en la recepción escaneando su QR.

## Códigos QR {#qr}

Un código QR es una imagen que el paciente escanea con el celular y que lo
lleva a un link: la página de reseñas de Google de la sede, una encuesta, lo
que necesites. Cada QR pertenece a una sede y tiene un número y un nombre para
reconocerlo (por ejemplo, **QR 1 — Reseñas Google**).

Lo importante de cómo funciona:

- La imagen del QR no cambia nunca. Lo que el paciente escanea es un link fijo
  del sistema, y es el sistema el que lo manda al **Enlace de destino** que
  cargaste. Por eso podés cambiar el destino, el nombre o el mensaje cuando
  quieras, sin reimprimir nada.
- El mismo QR sirve para todos los pacientes, todas las veces que haga falta.
- Se puede imprimir (descargando la imagen), pegar como link o mandar por
  WhatsApp o por email. Y una regla de automatización puede mandarlo sola
  después de cada turno atendido (ver [El QR de reseña después del
  turno](#qr-de-resena)).

La pantalla [QR](/qr) está en **Administración**, en el menú. **Solo un
administrador** la ve en el menú: Recepción no la tiene. La pantalla se llama
**Códigos QR** y lista todos los QR de la clínica. Podés filtrar por sede y
ordenar por **Fecha de creación** o por **Número**. En cada fila hay un menú
con estas acciones:

| Acción | Qué hace |
|---|---|
| **Ver detalle** | Muestra número, nombre, sede, enlace de destino, mensaje y fecha de creación. |
| **Ver imagen** | Muestra la imagen del QR para descargarla, y el link público para copiarlo. |
| **Enviar** | Prepara un WhatsApp o un email con el link del QR. |
| **Copiar link** | Copia el link público del QR al portapapeles. |
| **Editar** | Cambia número, nombre, destino o mensaje. |
| **Eliminar** | Borra el QR. |

> Si el portapapeles no está disponible (pasa en algunos navegadores o
> celulares), al tocar **Copiar link** el link aparece escrito en la pantalla
> para que lo copies a mano.

## Crear un QR {#nuevo-qr}

1. En [QR](/qr), tocá **Generar QR digital**.
2. Elegí la sede. El QR queda ligado a ella y no se puede mover después.
3. El **N°** se completa solo con el siguiente número libre de esa sede. Es
   el número que vas a usar para identificarlo (por ejemplo, el que pegás en
   la recepción). Podés cambiarlo, pero no puede repetirse con otro QR de la
   misma sede.
4. Escribí un **Nombre** (por ejemplo, "Reseñas Google").
5. Pegá el **Enlace de destino**: la dirección completa a la que va a ir el
   paciente, empezando con `https://`. Para las reseñas de Google, es el link
   "Escribir una reseña" de la ficha del negocio.
6. Si querés, escribí un **Mensaje (opcional)**. Es un texto corto que
   acompaña al QR: aparece debajo de la imagen cuando la descargás y es el
   texto que se usa al enviarlo por WhatsApp o email. Por ejemplo: "¡Gracias
   por elegirnos! Nos ayudaría mucho conocer tu opinión."
7. Tocá **Crear QR**. Se abre enseguida la imagen del QR nuevo.

Para corregir un QR, usá **Editar** en su fila. Se pueden cambiar el número,
el nombre, el destino y el mensaje; la sede no. Si necesitás el QR en otra
sede, creá uno nuevo.

> **Eliminar** un QR lo deja de hacer funcionar de inmediato: si alguien
> escanea una copia impresa, no lo lleva a ningún lado. Las reglas que lo
> mandaban después del turno tampoco lo pueden usar. No se puede deshacer
> desde la pantalla.

### Ver y descargar la imagen {#imagen-qr}

Con **Ver imagen** se abre la imagen del QR, con el mensaje debajo si lo
cargaste. Desde ahí:

- **Descargar imagen** guarda el archivo para imprimirlo o usarlo en un
  diseño (por ejemplo, un cartel para la sala de espera).
- **Link público** es el link que el QR codifica; con **Copiar link** lo
  copiás para pegarlo donde quieras (una firma de email, una publicación).

Si editás el mensaje y volvés a abrir la imagen, ya aparece el texto nuevo.

## Enviar un QR a mano {#enviar-qr}

1. En la fila del QR, tocá **Enviar**.
2. Elegí el **Canal**: **WhatsApp** o **Email**.
3. Escribí el **Número de WhatsApp (con código de país)** o el **Email** del
   paciente. Para WhatsApp, un celular uruguayo se puede escribir como siempre
   (por ejemplo, 099 123 456): el código de país se agrega solo.
4. Tocá **Abrir WhatsApp** o **Abrir email**.

Se abre WhatsApp o tu programa de correo con el mensaje ya armado: el mensaje
del QR (o, si no tiene, "Dejanos tu reseña en Google") seguido del link.
Revisalo y mandalo vos. El sistema no manda nada por su cuenta y no guarda el
número ni el email que escribiste.

> Si al tocar **Abrir email** no se abre nada, es que el dispositivo no tiene
> un programa de correo configurado. Usá **Copiar mensaje**: copia el asunto y
> el texto completos para que los pegues en el correo que uses.

## El QR de reseña después del turno {#qr-de-resena}

Lo más común en una clínica es pedir la reseña sola, sin que nadie la mande a
mano: una regla de automatización con el evento **Cuando se atiende un turno**
y la acción **Pedir una reseña con un QR**. El paciente recibe un WhatsApp con
el QR que elijas, unas horas después del turno.

1. Creá primero el QR de reseñas en [QR](/qr) (ver [Crear un QR](#nuevo-qr)).
2. Armá la regla en Automatizaciones y elegí ese QR. Los tiempos, el texto
   propuesto y qué pasa si después marcás **No vino** están en
   [Después del turno](/ayuda/automatizaciones#despues-del-turno).

> La regla sale solo con turnos marcados **Atendido** (o que se cerraron
> solos). Si el turno se marca **No vino**, el pedido de reseña se cancela.
> Ver [Atendido y No vino](/ayuda/actividades-y-agenda#atendido-no-vino).

## Cupones de descuento {#cupones}

Un cupón es un beneficio de un solo uso para un paciente concreto, por ejemplo
"15% de descuento en la próxima Limpieza facial". Tiene:

- un **descuento**: el texto que el paciente ve en su cupón;
- una **fecha de vencimiento**;
- un **estado**: **Vigente**, **Canjeado** o **Vencido**.

El paciente recibe un link. Al abrirlo ve una página con el descuento, el
estado del cupón y un QR, con la indicación de mostrarlo para canjearlo.
Abrir el link no gasta el cupón: solo se gasta cuando alguien del equipo lo
canjea desde la app (ver [Canjear un cupón](#canjear-cupon)).

En la ficha de cada paciente, la tarjeta **Cupones** lista todos los suyos
con su descuento, la fecha en que vence o en que se canjeó, y el estado.

> En una clínica los cupones se crean **solo a mano**, desde la ficha del
> paciente o desde una conversación. No hay una regla que los mande sola
> después del turno.

## Crear y mandar un cupón {#enviar-cupon}

El botón **Crear cupón** está en dos lugares:

- arriba de la ficha de un paciente ya guardado;
- en una [conversación](/ayuda/conversaciones#detalle), en la tarjeta **Datos
  de la conversación**, con la sede de la conversación ya elegida.

Un administrador puede crear cupones para cualquier paciente. Recepción, solo
para los pacientes que tiene asignados: con los demás, el sistema no lo deja.

1. Tocá **Crear cupón**.
2. Escribí el **Descuento** tal como lo va a leer el paciente, por ejemplo
   "15% de descuento en la próxima Limpieza facial". Hasta 200 caracteres.
3. Indicá en cuántos días vence (**Vence a los (días)**). Viene en 30; el
   máximo es un año (365 días).
4. Elegí la sede. Es la sede desde cuyo número de WhatsApp va a salir el
   mensaje con el cupón.
5. Tocá **Crear cupón**.

El cupón ya existe y queda en la tarjeta **Cupones** del paciente. En la
ventana **Cupón creado** tenés:

- el **Link del cupón**, con **Copiar link**, por si querés pasárselo por otro
  medio;
- **Ver QR** y **Descargar QR**, la imagen del QR del cupón (es la misma que
  el paciente ve al abrir el link);
- **Enviar por WhatsApp**.

Con **Enviar por WhatsApp** el paciente recibe, desde el número de la sede,
un mensaje con su nombre, el descuento, la fecha hasta la que vale y el link
del cupón. Sale como un mensaje tuyo y queda registrado en la
[conversación](/ayuda/conversaciones#detalle) del paciente. Si WhatsApp no
acepta el mensaje, lo podés reintentar desde esa conversación.

El botón **Enviar por WhatsApp** aparece deshabilitado, con el motivo escrito
debajo, cuando no se puede mandar. Los motivos posibles:

- el paciente no tiene teléfono cargado;
- la sede no tiene un número de WhatsApp conectado (ningún agente de IA de esa
  sede tiene número);
- el paciente no le escribió a ese número en las últimas 24 horas. WhatsApp
  solo permite escribirle a alguien fuera de ese plazo con mensajes aprobados
  de antemano, y los envíos a mano no tienen uno. En ese caso, copiá el link
  y mandáselo por el medio que uses, o esperá a que el paciente escriba;
- el cupón ya se canjeó o venció.

> Un cupón no se puede mandar por WhatsApp si el paciente no escribió en las
> últimas 24 horas. El cupón igual queda creado: copiá el link y mandáselo por
> otro medio.

## Canjear un cupón {#canjear-cupon}

Cuando el paciente viene a usar su cupón, muestra en el celular la página del
cupón (o el QR descargado). Se canjea desde la pantalla **Canjear cupón**,
que puede usar cualquier persona del equipo, administrador o Recepción. Está
pensada para usarse desde el celular, en la recepción.

> En una clínica, **Canjear cupón** no está en el menú. Se abre desde este
> link: [Canjear cupón](/vouchers/scan). Si la usás seguido, guardala en los
> favoritos del navegador.

1. Abrí [Canjear cupón](/vouchers/scan). El navegador te va a pedir permiso
   para usar la cámara la primera vez.
2. Apuntá la cámara al QR del cupón. Se lee solo, no hay que tocar nada.
3. Si no hay cámara, no diste permiso o el QR no enfoca, pedile al paciente el
   link del cupón, pegalo o tipealo en **Link o código del cupón** y tocá
   **Canjear**.

Si todo está bien, ves **Cupón canjeado** con el descuento que corresponde
aplicar. El cupón pasa a **Canjeado** y no se puede volver a usar.

Si no se puede canjear, la pantalla lo dice:

- **Este cupón ya fue canjeado**, con la fecha y hora en que se usó.
- **Este cupón venció**, con la fecha de vencimiento.
- **Este es un QR de reseñas, no un cupón**: el paciente escaneó o mostró el
  QR equivocado (uno de los de [Códigos QR](#qr)). Pedile que abra la página
  de su cupón.
- **Esto no es un cupón**: el código no es de esta plataforma.

Después del resultado, la cámara se apaga. **Escanear otro** la vuelve a
prender para el siguiente paciente; **Listo** vuelve a la pantalla anterior.

> El canje no se deshace. Antes de tocar **Canjear** con un link pegado a
> mano, verificá que sea el del paciente que tenés adelante.
