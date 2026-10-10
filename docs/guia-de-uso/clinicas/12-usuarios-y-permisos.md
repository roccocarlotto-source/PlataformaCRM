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

- Si alguien tiene más de una sede, en **Reservas**, **Calendario** y
  **Conversaciones** elige la sede en el filtro **Sucursal**. Solo aparecen las
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

## Cambiar el rol de una persona {#cambiar-rol}

En [Usuarios](/users), un administrador elige el rol en la fila de cada
persona: **Administrador** o **Recepción**. Al pasar a alguien a Recepción se
abre la elección de sus sedes. El cambio vale desde la próxima vez que esa
persona use el sistema, en unos segundos.

## Cambiar las sedes de una persona {#cambiar-sedes}

En [Usuarios](/users), la columna **Sedes** muestra las de cada persona. Para
cambiarlas, abrí el menú de la fila, tocá **Editar sedes**, elegí las sedes y
tocá **Guardar**. Tiene que quedar al menos una.
