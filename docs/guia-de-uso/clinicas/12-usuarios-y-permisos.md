# Usuarios y permisos

## Los dos roles de una clínica {#roles}

En una clínica, las personas que entran al sistema tienen uno de estos dos
roles. Los profesionales no son usuarios: son parte de la agenda.

| Rol | Para quién | Qué puede hacer |
|---|---|---|
| **Administrador** | Quien configura la clínica | Todo: agenda, pacientes, conversaciones, tareas y toda la configuración |
| **Recepción** | Quien atiende la recepción | Lo del día a día de **sus sedes**: agenda, conversaciones y tareas, y todos los pacientes. No configura nada |

### Qué puede hacer Recepción {#recepcion}

| Pantalla | Recepción |
|---|---|
| **Agenda:** ver, crear y cancelar turnos | Sí, en las sedes que tiene asignadas |
| Dar un turno fuera de horario | No (solo un administrador) |
| Profesionales, prestaciones, horarios y calendario de Google | No |
| **Pacientes:** ver, crear y editar | Sí, cualquier paciente |
| Borrar un paciente, borrar sus datos personales, unir o importar | No |
| **Conversaciones:** ver, responder, cerrar y devolver al asistente | Sí, las de sus sedes, aunque estén asignadas a otra persona |
| **Tareas:** ver, completar, editar y tomar | Las suyas, las de sus sedes y las que no son de ninguna sede |
| Asignarle una tarea a otra persona | No |
| Usuarios, invitaciones, asistente, automatizaciones, base de conocimiento, organización y sedes | No |

> Recepción puede editar cualquier paciente, pero no lo puede asignar a otra
> persona. Para cambiar a quién está asignado un paciente, pedíselo a un
> administrador.

## Sedes de cada persona de recepción {#sedes}

Cada persona de Recepción tiene una o más **sedes** asignadas, y ve la agenda,
las conversaciones y las tareas de esas sedes. Los pacientes no son de ninguna
sede: Recepción los ve todos, para poder darles un turno en cualquiera de sus
sedes.

- Si alguien tiene más de una sede, en **Turnos**, **Agenda** y
  **Conversaciones** elige la sede en el filtro **Sede**. Solo aparecen las
  suyas.
- Las tareas que no son de ninguna sede (por ejemplo, una que cargó un
  administrador a mano) las ven y las pueden tomar todas las personas de
  Recepción.
- Los avisos de una sede (por ejemplo, un paciente que pidió hablar con una
  persona) le llegan como tarea a alguien de Recepción de esa sede: al
  **Responsable por defecto** de la sede si es de Recepción, o si no a quien
  tenga menos tareas pendientes.
- Los administradores ven todas las sedes y no se les asignan sedes.

> Si a una persona de Recepción no le queda ninguna sede (por ejemplo, porque
> se borró la única que tenía), ve el aviso **"No tenés sedes asignadas"** y
> solo ve los pacientes. En [Usuarios](/users) aparece marcada con **Sin
> sedes**.

## Usuarios {#usuarios}

Solo un administrador la ve. En el menú: **Administración → Usuarios**. Es
el listado de todas las cuentas de la clínica, activas e inactivas.

No hay un botón de "Nuevo usuario": las cuentas se crean cuando la persona
acepta una invitación (ver [Invitar a alguien de recepción](#invitar)).

**Las columnas.** **Nombre**, **Email**, **Rol**, **Sedes**, **Estado**
(**Activo** o **Inactivo**), **Acceso al agente interno** y **Acciones**. En
**Sedes**, un administrador dice **Todas**; una persona de Recepción, sus
sedes separadas por coma, o **Sin sedes** si no le queda ninguna.

**Los filtros.** Arriba del listado podés filtrar por **Rol**
(**Administrador** o **Recepción**) y por **Estado**, y ordenar por
**Nombre** o por **Fecha de alta**, en orden ascendente o descendente. Se
muestran 20 por página.

**Tu propia fila.** No tiene controles: no podés cambiarte el rol,
desactivarte ni eliminarte a vos mismo. Si hace falta, lo hace otro
administrador.

### Acceso al agente interno

La casilla **Acceso al agente interno** le permite a una persona de
Recepción usar el chat con el asistente del equipo (ver
[El agente interno](/ayuda/primeros-pasos#agente-interno)). Marcala o
desmarcala y se guarda al instante. En las filas de los administradores
aparece siempre marcada y no se puede cambiar: un administrador tiene acceso
siempre.

Para que el agente interno responda, además, tiene que estar configurado en
**Agentes de IA → Configurar agente interno**. Si tu clínica no tiene el
agente interno, esa opción no aparece en el menú.

### Ver detalle, desactivar, activar y eliminar

El menú de acciones de cada fila (los tres puntos) tiene:

- **Ver detalle**: un cuadro con nombre, email, rol, estado, acceso al
  agente interno, **último acceso** y **fecha de alta**.
- **Editar sedes**: solo en las filas de Recepción (ver
  [Cambiar las sedes de una persona](#cambiar-sedes)).
- **Desactivar** / **Activar**: una cuenta inactiva no puede ingresar a la
  app. Lo que tenía asignado sigue a su nombre, y se puede volver a activar
  cuando haga falta. Es lo que conviene cuando alguien deja de trabajar un
  tiempo o se va del equipo: no se pierde nada.
- **Eliminar**: saca a la persona de la clínica, previa confirmación.

> Una cuenta inactiva deja de aparecer en los selectores de personas (por
> ejemplo, el **Responsable por defecto** de una sede), pero lo que ya tenía
> asignado no se pasa solo a otra persona. Si atendía pacientes o tareas,
> reasignalos desde cada ficha.

## Cambiar el rol de una persona {#cambiar-rol}

En [Usuarios](/users), un administrador elige el rol en la fila de cada
persona: **Administrador** o **Recepción**. Al pasar a alguien a Recepción se
abre la elección de sus sedes. El cambio vale desde la próxima vez que esa
persona use el sistema, en unos segundos.

## Cambiar las sedes de una persona {#cambiar-sedes}

En [Usuarios](/users), la columna **Sedes** muestra las de cada persona. Para
cambiarlas, abrí el menú de la fila, tocá **Editar sedes**, elegí las sedes y
tocá **Guardar**. Tiene que quedar al menos una.

## Invitaciones {#invitaciones}

Solo un administrador la ve. En el menú: **Administración → Invitaciones**.
Es el historial de todas las invitaciones que se mandaron, con su estado.

**Las columnas.** **Email**, **Rol**, **Estado**, **Invitado por** (quién la
mandó), **Creada**, **Vence** y **Acciones**. La columna **Rol** muestra un
guion: el rol y las sedes de la persona se ven en [Usuarios](#usuarios) una
vez que acepta.

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

### Reenviar una invitación

Si la persona no recibió el email, lo perdió o no lo encuentra:

1. Buscá la fila con estado **Pendiente**.
2. Tocá **Reenviar**. Le llega de nuevo el email con el mismo enlace y las mismas sedes, y el
   vencimiento vuelve a contar desde ese momento.

Arriba de la lista aparece *Reenviamos la invitación a…* con el email.

Si la persona ya abrió el enlace pero no terminó de crear su cuenta, no hay un
email nuevo que mandarle: el sistema te lo dice. Pedile que entre con
**¿Olvidaste tu contraseña?** usando ese email; después de elegir la
contraseña, la app la lleva a completar su cuenta.

Una invitación no se edita: si hay que cambiar el email, el rol o las
sedes, o si venció, se crea otra desde [Invitar](#invitar).

> Las invitaciones tienen fecha de vencimiento (se ve en la columna
> **Vence**). Si la persona no la acepta a tiempo, va a tener que recibir una
> invitación nueva.

## Invitar a alguien de recepción {#invitar}

Solo un administrador puede invitar.

1. Entrá a [Invitaciones](/invitations) y tocá **Invitar**.
2. Escribí el email de la persona.
3. En **Rol** elegí **Recepción** (ya viene elegido) o **Administrador**.
4. Si es de Recepción, elegí sus **Sedes** (al menos una).
5. Tocá **Enviar invitación**. Le llega un mail para entrar, y cuando entra ya
   tiene esas sedes.

> En una clínica no existe el rol **Usuario**: si alguien no administra, es de
> Recepción.
