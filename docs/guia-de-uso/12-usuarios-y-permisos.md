# Usuarios y permisos

Quién entra a la app, con qué rol y qué puede hacer cada uno. Las pantallas
**Usuarios** e **Invitaciones** (menú **Administración**) son solo para
administradores; la primera parte de esta sección, sobre los roles, le sirve
a todo el equipo.

## Los dos roles {#roles}

Cada cuenta tiene uno de dos roles dentro de la organización:

- **Administrador**: configura todo y puede ver, editar y eliminar cualquier
  registro. Es quien invita gente, arma los procesos de venta, carga el
  stock y configura los agentes de IA.
- **Usuario**: el rol de trabajo diario de un vendedor o de recepción. Ve el
  CRM, crea contactos y oportunidades, atiende conversaciones, maneja sus
  tareas y los turnos. La regla general es: **edita solo lo que tiene
  asignado a su nombre**. No elimina, no une contactos ni reasigna
  registros a otra persona.

Cuando un usuario abre un contacto o una oportunidad asignada a otra persona,
la ve en modo lectura con el aviso **"Está asignado a otra persona: solo
quien lo tiene asignado o un administrador puede editarlo"**. Lo que un
usuario crea queda a su nombre.

Un administrador puede cambiar el rol de una cuenta en cualquier momento
(ver [Usuarios](#usuarios)). Además de estos dos roles, el **equipo de la
plataforma** (quien provee el sistema, no el personal de la automotora)
tiene un menú propio, **Plataforma**, que no depende del rol.

Qué ve y qué puede hacer cada uno, pantalla por pantalla:

| Pantalla | Administrador | Usuario |
|---|---|---|
| Dashboard | Todo, con la actividad de todo el equipo y las acciones rápidas. | Todo, pero en "Actividad reciente" solo sus actividades y sin acciones rápidas. |
| Agente interno | Siempre. | Solo si un administrador le dio acceso. |
| Canjear cupón | Sí. | Sí. |
| Contactos | Ver, crear, editar, marcar sin interés, eliminar, unir duplicados, reasignar. | Ver todos, crear (quedan a su nombre), editar y marcar sin interés solo los asignados a él. No ve la columna "Asignado". |
| Conversaciones | Ver todas, responder, devolver al agente, abrir la ficha del contacto. | Ver todas; responder o devolver al agente solo en las conversaciones de contactos asignados a él. |
| Empresas | Ver, crear, editar, eliminar. | Solo ver. |
| Oportunidades | Ver, crear, editar, mover en el embudo, cerrar, eliminar, reasignar. | Ver todas, crear (a su nombre), editar y mover solo las asignadas a él. |
| Procesos de venta y etapas | Ver y configurar. | Solo ver. |
| Stock | Ver, cargar unidades, editar, subir fotos, publicar, eliminar. | Solo ver (sin la columna "Vendedor"). |
| Actividades (listado completo) | Ver las de todo el equipo, crear para cualquier persona, editar, eliminar. | No la ve. |
| Mis tareas | Las suyas. | Las suyas: completarlas, crear tareas para sí mismo y editar las que creó y no completó. |
| Reservas | Ver y cancelar turnos. | Ver y cancelar turnos. |
| Calendario | Crear turnos, incluso fuera del horario del recurso. | Crear turnos dentro del horario del recurso. |
| Recursos y Tipos de servicio | Configurar. | No los ve. |
| QR | Ver, enviar, copiar link, crear, editar, eliminar. | Ver, enviar y copiar link. |
| Usuarios e Invitaciones | Sí. | No. |
| Fuentes, Claves y Eventos de ingesta | Sí. | No. |
| Organización y Sucursales | Sí. | No (las sucursales las ve en los selectores donde hacen falta). |
| Campos de contacto | Definirlos. | Los ve y los completa en la ficha de cada contacto. |
| Agentes de IA, Base de conocimiento, Automatizaciones, Configurar agente interno | Sí. | No. |
| Ayuda | Sí. | Sí. |

El detalle de cada pantalla está en su propia sección de esta guía.

> Lo que decide los permisos es el sistema, no el menú: aunque alguien
> escriba a mano la dirección de una pantalla de administración, un usuario
> no puede entrar ni modificar nada ahí.

## Usuarios {#usuarios}

Solo un administrador la ve. En el menú: **Administración → Usuarios**. Es
el listado de todas las cuentas de la organización, activas e inactivas.

No hay un botón de "Nuevo usuario": las cuentas se crean cuando la persona
acepta una invitación (ver [Invitar a una persona](#invitar)).

**Las columnas.** Nombre, Email, Rol, Estado (**Activo** o **Inactivo**),
Acceso al agente interno y Acciones.

**Los filtros.** Arriba del listado podés filtrar por **Rol** y por
**Estado**, y ordenar por **Nombre** o por **Fecha de alta**, en orden
ascendente o descendente. Se muestran 20 por página.

**Tu propia fila.** No tiene controles: no podés cambiarte el rol,
desactivarte ni eliminarte a vos mismo. Si hace falta, lo hace otro
administrador.

### Cambiar el rol

En la columna **Rol** de cada fila hay un desplegable con **Administrador**
y **Usuario**. Elegí el nuevo rol y se guarda al instante, sin botón de
guardar. Si no se pudo guardar, el error aparece en esa misma fila.

> Pasar a alguien a administrador le da acceso a toda la configuración:
> usuarios, sucursales, agentes de IA, stock, eliminación de registros.
> Pasar un administrador a usuario le saca todo eso en el momento.

### Habilitar el acceso al agente interno

La casilla **Acceso al agente interno** le permite a un usuario usar el chat
con el asistente de IA del equipo (ver
[El agente interno](/ayuda/primeros-pasos#agente-interno)). Marcala o
desmarcala y se guarda al instante. En las filas de los administradores
aparece siempre marcada y no se puede cambiar: un administrador tiene acceso
siempre.

Para que el agente interno responda, además, tiene que estar configurado en
**Agentes de IA → Configurar agente interno**.

### Ver detalle, desactivar, activar y eliminar

El menú de acciones de cada fila (los tres puntos) tiene:

- **Ver detalle**: un cuadro con nombre, email, rol, estado, acceso al
  agente interno, **último acceso** y **fecha de alta**.
- **Desactivar** / **Activar**: una cuenta inactiva no puede ingresar a la
  app. Todo lo que tenía asignado sigue a su nombre, y se puede volver a
  activar cuando haga falta. Es lo que conviene cuando alguien deja de
  trabajar un tiempo o se va del equipo: no se pierde nada.
- **Eliminar**: saca a la persona de la organización, previa confirmación.

> Una cuenta inactiva deja de aparecer en los selectores de "Asignado a" y
> de "Vendedor" de las fichas, pero lo que ya tenía asignado no se reasigna
> solo. Si esa persona atendía contactos u oportunidades, reasignalos a
> otra desde cada ficha.

## Invitaciones {#invitaciones}

Solo un administrador la ve. En el menú: **Administración → Invitaciones**.
Es el historial de todas las invitaciones que se mandaron, con su estado.

**Las columnas.** Email, Estado, Invitado por (quién la mandó), Creada y
Vence.

**Los estados.**

- **Pendiente**: se envió y la persona todavía no la aceptó. Es la única que
  se puede revocar.
- **Aceptada**: la persona ya creó su cuenta. Aparece en
  [Usuarios](#usuarios).
- **Revocada**: la cancelaste; el enlace del email ya no sirve.
- **Vencida**: pasó la fecha de vencimiento sin que la aceptaran.

**Los filtros.** Podés filtrar por **Estado** y ordenar por **Fecha de
creación** o por **Vencimiento**.

### Revocar una invitación

Si invitaste a la persona equivocada o te equivocaste de email:

1. Buscá la fila con estado **Pendiente**.
2. Tocá **Revocar** y confirmá.
3. El enlace que recibió deja de funcionar. Si corresponde, mandá una
   invitación nueva.

Una invitación no se edita ni se reenvía: si hay que cambiar el email o el
rol, o si venció, se crea otra desde [Invitar](#invitar).

## Invitar a una persona {#invitar}

Solo un administrador puede invitar. Es la única forma de sumar gente a la
organización.

1. En el menú, entrá a **Administración → Invitaciones** y tocá **Invitar**.
2. Escribí el **Email** de la persona (obligatorio). Es el email con el que
   va a ingresar a la app, así que tiene que ser uno que lea.
3. Elegí el **Rol**: **Usuario** (viene preseleccionado) o
   **Administrador**. Ver [Los dos roles](#roles) para decidir.
4. Tocá **Enviar invitación**.
5. Volvés al listado, con la invitación nueva como **Pendiente**.

La persona recibe un email con un enlace. Al abrirlo elige su nombre y su
contraseña, y entra directo a la app (el paso a paso, desde su lado, está en
[Aceptar una invitación](/ayuda/primeros-pasos#aceptar-invitacion)).
Avisale que revise también el correo no deseado.

Si el email ya tiene una cuenta en la organización o una invitación
pendiente, el sistema te lo dice al enviar.

> Las invitaciones tienen fecha de vencimiento (se ve en la columna
> **Vence**). Si la persona no la acepta a tiempo, va a ver el mensaje "Este
> enlace no es válido o expiró" y vas a tener que invitarla de nuevo.
