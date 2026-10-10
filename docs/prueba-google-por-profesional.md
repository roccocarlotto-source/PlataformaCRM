# Prueba de punta a punta: un calendario de Google por profesional (R8)

Guía para probar a mano, antes de la primera clínica real, lo que hace R8
(`docs/rubros.md` §4.6, D4, D16). Usá una **cuenta de Google de prueba** y una
**clínica de prueba**. En producción hoy hay 0 conexiones de Google.

## 0. Antes de empezar (una sola vez)

1. **Google Cloud, pantalla de consentimiento:** sumá el scope
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly` al proyecto
   de OAuth que usa la plataforma. Si la app está verificada, Google puede pedir
   verificar el scope nuevo. Mientras tanto la lista de calendarios no va a
   aparecer, y se usa el respaldo de pegar el ID (paso 3). Las automotoras no
   piden este scope.
2. **Cuenta de prueba:** en Google Calendar de esa cuenta creá dos calendarios,
   por ejemplo "Prueba Ana" y "Prueba Bruno".
3. **Clínica de prueba:** una organización CLINICA (la Clínica Demo de R19, o
   una creada por el platform admin con `CLINICA_HABILITADA` en un entorno de
   prueba) con:
   - una sede con horario;
   - dos profesionales (Ana y Bruno) con horario, por ejemplo lunes de 9 a 13;
   - una prestación que atiendan los dos;
   - un paciente de prueba (`persona@example.com`);
   - un usuario ADMIN y uno de Recepción con esa sede asignada.

## 1. Conectar la cuenta a la sede

1. Como ADMIN: **Sucursales → la sede → Conectar Google Calendar**.
2. En la pantalla de Google, comprobá que se piden **ver y editar eventos**,
   **ver disponibilidad** y **ver la lista de calendarios**. Este último permiso
   solo aparece en una clínica.
3. Aceptá. La sede queda **Conectada**.

**Qué mirar:** al conectar una sucursal de una **automotora** de prueba, Google
pide solo los dos permisos de siempre, sin la lista de calendarios.

## 2. Esperar el canal de la sede

El worker de canales corre cada hora y abre el canal de notificaciones de la
sede. Sin canal, los cambios hechos en Google no llegan a la plataforma.

## 3. Elegir el calendario de cada profesional

1. Como ADMIN: **Profesionales → menú de Ana → Calendario de Google**.
2. Elegí "Prueba Ana" de la lista y **Guardar**.
   - Si la lista no aparece (falta el scope del paso 0), pegá el ID del
     calendario: en Google Calendar, **Configuración del calendario → Integrar
     el calendario → ID del calendario**.
3. Dejá a Bruno **sin calendario propio**.
4. Comprobá los rechazos:
   - elegir el calendario principal de la cuenta (el de la sede) → error;
   - elegirle a Bruno el calendario de Ana → "Ese calendario ya es de Ana";
   - un ID inventado → "La cuenta de Google conectada no puede usar ese
     calendario".
5. Al guardar se abre en el momento el canal de notificaciones del calendario
   de Ana. Si Google falló al abrirlo, el worker lo reintenta en su próxima
   pasada (hasta una hora).

## 4. Disponibilidad

1. En "Prueba Ana", creá un evento propio el lunes de 10 a 11.
2. En el calendario principal de la cuenta (el de la sede), creá un evento el
   lunes de 9 a 13.
3. Pedí la disponibilidad de la prestación, desde el asistente o desde la
   agenda.
   - **Ana:** no ofrece las 10. Las demás horas sí.
   - **Bruno:** ofrece todo. Un profesional sin calendario no resta nada de
     Google, y en una clínica el calendario de la sede nunca se resta.

## 5. Agendar

1. Dale un turno al paciente con **Ana** el lunes a las 9. En Google aparece en
   **"Prueba Ana"**.
2. Dale un turno con **Bruno** el lunes a las 11. En Google aparece en el
   **calendario principal** (el de la sede).
3. Cancelá el turno de Ana en la plataforma. El evento desaparece de "Prueba
   Ana".

## 6. Mover y borrar en Google (D16)

1. Volvé a dar el turno con Ana. En Google, **arrastrá el evento** a las 12.
   - En la plataforma el turno **sigue a las 9**.
   - A la Recepción de la sede le llega una tarea **"Turno movido en Google:
     …"** con el paciente, el profesional y el horario nuevo.
2. En Google, **borrá el evento**.
   - En la plataforma el turno **sigue en pie** (CONFIRMED).
   - Llega una tarea **"Turno borrado en Google: …"**.
   - Si se cancela el turno en la plataforma, no pasa nada en Google: el evento
     ya no está.
3. Las notificaciones de Google pueden tardar unos segundos. Si no llega nada,
   revisá que el canal de "Prueba Ana" exista. En los logs del backend, buscá
   "Canal de notificaciones" o el `lastErrorMessage` de su fila.

## 7. Cambiar y quitar el calendario

1. Cambiale a Ana el calendario a "Prueba Bruno" (o a otro). El canal viejo se
   detiene y el nuevo se abre en el momento. El turno que ya
   estaba en "Prueba Ana" se sigue cancelando ahí.
2. Quitale el calendario (**Sin calendario propio**). Ana vuelve a funcionar
   solo con la agenda de la plataforma.

## 8. Desconectar

**Sucursales → la sede → Desconectar Google Calendar.** Se detienen el canal de
la sede y el de cada profesional. Al reconectar, los calendarios elegidos se
conservan (están en el profesional) y el worker vuelve a abrir sus canales.

## Si algo falla

- **Un calendario borrado o sin permiso** no rompe la sede: el error queda en
  la fila del canal de ese calendario y ese profesional se calcula sin Google.
- **La sede pasa a ERROR** solo si Google rechaza la autorización de la cuenta
  (hay que reconectar), igual que hoy.
