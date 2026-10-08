# Cupones y QR

Dos herramientas para después de la venta: los **códigos QR**, que llevan al
cliente a un link que vos elegís (por ejemplo, para dejar una reseña en
Google), y los **cupones de descuento**, que se le mandan a un cliente por
WhatsApp y se canjean en el mostrador escaneando su QR.

## Códigos QR {#qr}

Un código QR es una imagen que el cliente escanea con el celular y que lo
lleva a un link: la página de reseñas de Google de la sucursal, el catálogo,
una encuesta, lo que necesites. Cada QR pertenece a una sucursal y tiene un
número y un nombre para reconocerlo (por ejemplo, **QR 1 — Reseñas Google**).

Lo importante de cómo funciona:

- La imagen del QR no cambia nunca. Lo que el cliente escanea es un link fijo
  del sistema, y es el sistema el que lo manda al **enlace de destino** que
  cargaste. Por eso podés cambiar el destino, el nombre o el mensaje cuando
  quieras, sin reimprimir nada.
- El mismo QR sirve para todos los clientes, todas las veces que haga falta.
- Se puede imprimir (descargando la imagen), pegar como link, mandar por
  WhatsApp o por email, y las [automatizaciones](/ayuda/automatizaciones#acciones)
  pueden mandarlo solas cuando se gana una venta.

La pantalla [QR](/qr), dentro de **Administración**, lista todos los QR de la
organización. Podés filtrar por **Sucursal** y ordenar por fecha de creación o
por número. En cada fila hay un menú con estas acciones:

| Acción | Qué hace | Quién puede |
|---|---|---|
| **Ver detalle** | Muestra número, nombre, sucursal, enlace de destino, mensaje y fecha de creación. | Todos |
| **Ver imagen** | Muestra la imagen del QR para descargarla, y el link público para copiarlo. | Todos |
| **Enviar** | Prepara un WhatsApp o un email con el link del QR. | Todos |
| **Copiar link** | Copia el link público del QR al portapapeles. | Todos |
| **Editar** | Cambia número, nombre, destino o mensaje. | Solo un administrador |
| **Eliminar** | Borra el QR. | Solo un administrador |

> Si el portapapeles no está disponible (pasa en algunos navegadores o
> celulares), al tocar **Copiar link** el link aparece escrito en la pantalla
> para que lo copies a mano.

## Crear un QR {#nuevo-qr}

Solo un administrador puede crear, editar o eliminar un QR.

1. En [QR](/qr), tocá **Generar QR digital**.
2. Elegí la **Sucursal**. El QR queda ligado a ella y no se puede mover
   después.
3. El **N°** se completa solo con el siguiente número libre de esa sucursal.
   Es el número que vas a usar para identificarlo (por ejemplo, el que
   pegás en el mostrador). Podés cambiarlo, pero no puede repetirse con
   otro QR de la misma sucursal.
4. Escribí un **Nombre** (por ejemplo, "Reseñas Google").
5. Pegá el **Enlace de destino**: la dirección completa a la que va a ir el
   cliente, empezando con `https://`. Para las reseñas de Google, es el link
   "Escribir una reseña" de la ficha del negocio.
6. Si querés, escribí un **Mensaje**. Es un texto corto que acompaña al QR:
   aparece debajo de la imagen cuando la descargás y es el texto que se usa
   al enviarlo por WhatsApp o email. Por ejemplo: "¡Gracias por elegirnos!
   Nos ayudaría mucho conocer tu opinión."
7. Tocá **Crear QR**. Se abre enseguida la imagen del QR nuevo.

Para corregir un QR, usá **Editar** en su fila. Se pueden cambiar el número,
el nombre, el destino y el mensaje; la sucursal no. Si necesitás el QR en otra
sucursal, creá uno nuevo.

> **Eliminar** un QR lo deja de hacer funcionar de inmediato: si alguien
> escanea una copia impresa, no lo lleva a ningún lado. No se puede deshacer
> desde la pantalla.

### Ver y descargar la imagen

Con **Ver imagen** se abre la imagen del QR, con el mensaje debajo si lo
cargaste. Desde ahí:

- **Descargar imagen** guarda el archivo para imprimirlo o usarlo en un
  diseño.
- **Link público** es el link que el QR codifica; con **Copiar link** lo
  copiás para pegarlo donde quieras (una firma de email, una publicación).

Si editás el mensaje y volvés a abrir la imagen, ya aparece el texto nuevo.

## Enviar un QR {#enviar-qr}

Cualquier usuario puede mandarle un QR a un cliente, por ejemplo desde el
mostrador después de una entrega.

1. En la fila del QR, tocá **Enviar**.
2. Elegí el **Canal**: **WhatsApp** o **Email**.
3. Escribí el **Número de WhatsApp (con código de país)** o el **Email** del
   cliente. Para WhatsApp, un celular uruguayo se puede escribir como siempre
   (por ejemplo, 096 468 788): el código de país se agrega solo.
4. Tocá **Abrir WhatsApp** o **Abrir email**.

Se abre WhatsApp o tu programa de correo con el mensaje ya armado: el mensaje
del QR (o, si no tiene, "Dejanos tu reseña en Google") seguido del link.
Revisalo y mandalo vos. El sistema no manda nada por su cuenta y no guarda el
número ni el email que escribiste.

> Si al tocar **Abrir email** no se abre nada, es que el dispositivo no tiene
> un programa de correo configurado. Usá **Copiar mensaje**: copia el asunto y
> el texto completos para que los pegues en el correo que uses.

Si querés que el QR se mande solo, sin que nadie lo haga a mano, armá una
regla en [Automatizaciones](/ayuda/automatizaciones#acciones) con la acción
**Enviar QR por WhatsApp**.

## Cupones de descuento {#cupones}

Un cupón es un beneficio de un solo uso para un cliente concreto, por ejemplo
"15% de descuento en el taller". Tiene:

- un **descuento**: el texto que el cliente ve en su cupón;
- una **fecha de vencimiento**;
- un **estado**: **Vigente**, **Canjeado** o **Vencido**.

El cliente recibe un link. Al abrirlo ve una página con el descuento, el
estado del cupón y un QR, con la indicación de mostrárselo al empleado para
canjearlo. Abrir el link no gasta el cupón: solo se gasta cuando alguien del
equipo lo canjea desde la app (ver [Canjear un cupón](#canjear-cupon)).

En la ficha de cada contacto, la tarjeta **Cupones** lista todos los suyos
con su descuento, la fecha en que vence o en que se canjeó, y el estado. Los
que dicen **por regla** los generó una automatización; los demás los creó
alguien del equipo a mano.

Hay dos formas de crear cupones:

- a mano, desde la ficha del contacto, la de la oportunidad o la conversación
  (ver abajo);
- automáticamente cuando se gana una venta, con la acción **Enviar cupón de
  descuento** de [Automatizaciones](/ayuda/automatizaciones#acciones).

## Crear y mandar un cupón {#enviar-cupon}

El botón **Crear cupón** está en tres lugares:

- en la ficha de un contacto ya guardado;
- en la ficha de una oportunidad (el cupón es para el contacto de esa venta);
- en una conversación, con la sucursal de la conversación ya elegida.

Un administrador puede crear cupones para cualquier cliente. Un usuario solo
para los contactos u oportunidades que tiene asignados.

1. Tocá **Crear cupón**.
2. Escribí el **Descuento** tal como lo va a leer el cliente, por ejemplo
   "15% de descuento en el taller".
3. Indicá en cuántos días vence (**Vence a los (días)**). Viene en 30; el
   máximo es un año.
4. Elegí la **Sucursal**. Es la sucursal desde cuyo número de WhatsApp va a
   salir el mensaje con el cupón.
5. Tocá **Crear cupón**.

El cupón ya existe y queda en la tarjeta **Cupones** del contacto. En la
pantalla siguiente tenés:

- el **Link del cupón**, con **Copiar link**, por si querés pasárselo por otro
  medio;
- **Ver QR** y **Descargar QR**, la imagen del QR del cupón (es la misma que
  el cliente ve al abrir el link);
- **Enviar por WhatsApp**.

Con **Enviar por WhatsApp** el cliente recibe un mensaje como este, desde el
número de la sucursal: "¡Hola Ana! Te dejamos tu cupón: 15% de descuento en
el taller. Vale hasta el 30/11/2026. Mostrá este link en la sucursal: (link)".
Sale como un mensaje tuyo y queda registrado en la
[conversación](/ayuda/conversaciones) del contacto. Si WhatsApp no acepta el
mensaje, lo podés reintentar desde esa conversación.

El botón **Enviar por WhatsApp** aparece deshabilitado, con el motivo escrito
debajo, cuando no se puede mandar. Los motivos posibles:

- el contacto no tiene teléfono cargado;
- la sucursal no tiene un número de WhatsApp conectado (ningún
  [agente de IA](/ayuda/agentes-de-ia#canales) de esa sucursal tiene número);
- el cliente no le escribió a ese número en las últimas 24 horas. WhatsApp
  solo permite escribirle a alguien fuera de ese plazo con mensajes
  aprobados de antemano, y los envíos a mano no tienen uno. En ese caso,
  copiá el link y mandáselo por el medio que uses, o esperá a que el cliente
  escriba;
- el cupón ya se canjeó o venció.

> Un cupón creado a mano no se puede mandar por WhatsApp si el cliente no
> escribió en las últimas 24 horas. Si querés que los cupones salgan solos
> después de cada venta, sin depender de eso, usá la acción **Enviar cupón de
> descuento** de [Automatizaciones](/ayuda/automatizaciones#acciones), que
> usa un mensaje aprobado por WhatsApp.

## Canjear un cupón {#canjear-cupon}

Cuando el cliente viene a usar su cupón, muestra en el celular la página del
cupón (o el QR descargado). Cualquier usuario puede canjearlo desde
**Canjear cupón**, en el menú principal. Está pensado para usarse desde el
celular, en el mostrador.

1. Abrí **Canjear cupón**. El navegador te va a pedir permiso para usar la
   cámara la primera vez.
2. Apuntá la cámara al QR del cupón. Se lee solo, no hay que tocar nada.
3. Si no hay cámara, no diste permiso o el QR no enfoca, pedile al cliente el
   link del cupón, pegalo o tipealo en **Link o código del cupón** y tocá
   **Canjear**.

Si todo está bien, ves **Cupón canjeado** con el descuento que corresponde
aplicar. El cupón pasa a **Canjeado** y no se puede volver a usar.

Si no se puede canjear, la pantalla lo dice:

- **El cupón ya fue canjeado**, con la fecha y hora en que se usó.
- **El cupón venció**, con la fecha de vencimiento.
- **Este es un QR de reseñas, no un cupón**: el cliente escaneó o mostró el QR
  equivocado (uno de los de [Códigos QR](#qr)). Pedile que abra la página de
  su cupón.
- **Esto no es un cupón**: el código no es de esta plataforma.

Después del resultado, la cámara se apaga. **Escanear otro** la vuelve a
prender para el siguiente cliente; **Listo** vuelve a la pantalla anterior.

> El canje no se deshace. Antes de tocar **Canjear** con un link pegado a
> mano, verificá que sea el del cliente que tenés adelante.
