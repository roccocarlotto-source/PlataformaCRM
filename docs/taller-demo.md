# Taller Demo

Una automotora de demostración, con el módulo Servicios y datos inventados,
para mostrar el producto a un taller o a una concesionaria antes de que
contrate. Es la hermana de la Clínica Demo (`docs/rubros.md` §12) y copia su
forma: alta por un platform admin con datos de ejemplo detrás, y el botón
"Reiniciar datos de demo" en Plataforma → Organizaciones.

**Nada de lo que hay acá es real.** Nombres comunes inventados, teléfonos
uruguayos de forma válida (pueden existir: por eso la demo nace en modo demo),
emails `@example.com`, links a `example.com`. El repo es público.

## 1. Modo demo

La diferencia con la clínica: una automotora tiene que mostrar WhatsApp,
recordatorios de service y avisos de recambio andando, y eso no se puede
simular dejando las reglas inactivas. El Taller Demo nace con
`organizations.is_demo = true` (`src/services/modoDemo.service.ts`), que es
lo que garantiza que **nada sale de la plataforma**:

- los envíos a WhatsApp, Messenger e Instagram se simulan: no hay HTTP y la
  fila queda enviada con un id `demo:<uuid>`, que Conversaciones muestra como
  "Simulado";
- las plantillas de WhatsApp quedan aprobadas sin pasar por Meta;
- invitar usuarios (salvo un platform admin), conectar una página de Facebook
  o un Google Calendar, asignar un número o una página al agente, dar de alta
  un WABA: 409;
- un aviso fijo arriba de la app lo dice: "Modo demo: los mensajes se simulan
  y no llegan a nadie".

La bandera la pone solo el alta de una demo (la opción `tallerDemo` o
`clinicaDemo` de `createOrganizationWithFoundingAdmin`); no hay endpoint que
la cambie después.

## 2. Cómo se crea

**Plataforma → Nueva organización → "Taller Demo con datos de ejemplo"**, con
un sufijo opcional del nombre y los tres usuarios. Detrás,
`POST /api/admin/organizations/taller-demo` (`authenticate`,
`businessWriteRateLimiter`, `requirePlatformAdmin`;
`src/automotora/demo/tallerDemo.controller.ts`), con body:

```json
{
  "sufijo": "Este",
  "usuarios": {
    "admin": { "fullName": "…", "email": "…" },
    "vendedor": { "fullName": "…", "email": "…" },
    "taller": { "fullName": "…", "email": "…" }
  }
}
```

Lo que hace, en orden (`crearTallerDemo`):

1. Pre-chequeos de los tres emails (distintos, sin cuenta ni invitación
   pendiente): un 409 acá no deja nada creado.
2. `createOrganizationWithFoundingAdmin` con AUTOMOTORA, COMPLETA, Uruguay
   (598), USD y `America/Montevideo`, la opción `tallerDemo` (slug
   `taller-demo` o `taller-demo-<sufijo>`, `is_demo`) y el admin como
   fundador, con su invitación real.
3. Los otros dos usuarios (USER: vendedor y encargado del taller) con el
   **mismo mecanismo del fundador** —identidad en Supabase Auth más fila en
   `users`, sin fila de `Invitation`— y no por `createInvitation`: una
   invitación lleva como "quien invita" a un usuario de la misma organización,
   y así los tres existen desde el alta y los datos ya se les pueden asignar.
   La identidad se crea primero sin mail (`createUser`) y el mail sale después
   a mejor esfuerzo: el correo integrado de Supabase tiene un cupo por hora
   bajo. Si alguno no sale, la respuesta lo dice (`invitacionEnviada: false`)
   y se reenvía desde **Plataforma → Organizaciones → Reenviar invitación**,
   que en una demo cubre a todos los usuarios que no abrieron el mail.
4. `activarModulo(…, "servicios")`, el mismo camino que el botón de
   Plataforma.
5. Los datos de ejemplo (§3). Si fallan a mitad, 500 y la organización queda
   creada; **Reiniciar datos de demo** la deja bien (borra todo lo de uso y
   recarga), o se borra a mano.

**Limpieza:** el slug no coincide con ningún patrón de
`PATRONES_DE_SLUG_DE_PRUEBA`; ninguna purga de organizaciones de test la toca
(lo prueban `testOrganizationsPurge.service.test.ts` y
`src/automotora/demo/tallerDemo.integration-test.ts`). Se borra a mano.

## 3. Qué datos lleva

`src/automotora/demo/config.ts` (los datos) y `datosDeEjemplo.ts` (la carga).
Dos partes, como en la clínica:

- la **configuración**, solo en el alta y por los services (las mismas
  validaciones que un cliente): dos sucursales con horario y el vendedor de
  responsable por defecto (una derivación de venta le llega a él; lo del
  taller le llega al encargado como responsable de cada orden), la agenda del
  taller y la de la **prueba de manejo** en Casa Central (recursos con el
  horario de la sucursal: sin horario no hay disponibilidad), el proceso de
  venta, la moneda y los tipos de service, dos campos personalizados, la base
  de conocimiento, el agente (activo, WhatsApp + web, con el modelo de la
  demo, un token de widget, sin número ni página; con `get_service_types` y
  `update_lead`, y la instrucción de registrar la oportunidad antes de
  proponer horario), un QR y cuatro automatizaciones (el recordatorio de
  próximo service, **7 días antes**);
- los **datos de uso** (`cargarDatosDeUso`), que un reinicio borra y vuelve a
  cargar: lo masivo (contactos, fuente y eventos de ingesta, stock, vehículos
  de clientes, oportunidades, conversaciones y mensajes, tareas, turnos) se
  escribe directo con Prisma en una transacción, con los mismos campos que
  escribirían los services (decisión de diseño: en producción cada consulta
  cuesta cientos de milisegundos); las órdenes de servicio van por los
  services (`crearOrden` → `cambiarEstado` → `registrarAprobacion` →
  `registrarAviso`), y después se corren sus fechas hacia atrás para que el
  historial sea creíble. Al final, la sincronización del stock con la base de
  conocimiento.

Las fechas son **relativas al momento de la carga**, en la zona de la demo:
lo que el Dashboard cuenta por mes cae siempre en "este mes" o "el mes
pasado", los turnos van la semana que viene, y el resto se expresa en días u
horas hacia atrás. `datosDeEjemplo.test.ts` lo prueba con un "hoy" por cada
día de la semana y en los bordes de mes.

| Pantalla | Qué se ve |
|---|---|
| Dashboard | 6 oportunidades abiertas por USD 98.200. Creadas este mes 7 (mes pasado 5). Ganadas este mes 2 por 41.500 (mes pasado 2 por 36.000); una de ellas, la del Corolla Cross, es de **hoy**, así la vista Semanal tiene una venta. Perdidas 1 (2). Tres tareas vencidas |
| Contactos | 15 contactos (6 de WhatsApp, 3 de Instagram, 2 de Messenger, 2 de la web, 2 referidos), dos sin interés, campos "Auto actual" y "Forma de pago"; más **Sofía Ramos**, el contacto del probador del agente (sin teléfono ni email, del vendedor) |
| Conversaciones | Cinco: WhatsApp (consulta por el Onix, el agente busca stock y crea la oportunidad), Instagram (precio de la Ranger, a consultar), Messenger (turno de taller, transferida al encargado), WhatsApp de Jorge Méndez (el **recordatorio de próximo service** que mandó la regla hace dos días y su respuesta) y WhatsApp de Nicolás Pereyra (el encargado le **avisa que su Fiesta está listo**). Salientes "Simulados" |
| Oportunidades | Proceso "Venta de autos" (Nuevo → Contactado → Prueba de manejo → Negociación → Ganada / Perdida), 13 oportunidades |
| Stock | 10 unidades: una reservada, dos vendidas (con su entrega), siete disponibles y publicadas; una en pesos, una a consultar |
| Taller → Vehículos de clientes | 16: cuatro de ventas ganadas ("Origen: Vendido por nosotros"), el resto cargados a mano. El Clio tiene su recordatorio de service ya enviado (aviso, fila de la cola ENVIADA y el mensaje en la conversación) |
| Taller → Órdenes | OS-0001 a OS-0011: 2 Agendadas (una con el turno cancelado), 2 Recibidas, 2 En trabajo (una con un extra aprobado), 2 Esperando aprobación (una hace más de 24 h), 1 Lista para retirar (el Fiesta de Nicolás Pereyra, avisado por WhatsApp; la ventana de 24 h ya cerró), 1 Entregada (fijó el próximo service), 1 Cancelada |
| Taller → Resumen | En el taller 6 (2/2/2). Listos 1. Esperando aprobación hace más de 24 h: 1. Services vencidos 2, en 30 días 3. Turnos cancelados 1. Recambios próximos 2 (2 sin fecha de compra), vencidos 3 |
| Agenda | Tres turnos de taller la semana que viene, uno cancelado |
| Automatizaciones | Activas: "Recordatorio de próximo service" (plantilla aprobada, simulada), "Se acerca el recambio → tarea al vendedor", "Venta ganada → tarea de agradecimiento". Inactiva: "Reseña por QR tras la venta" |

Las unidades se publican sin fotos (el agente las conoce igual por la base de
conocimiento); editar una desde la pantalla pide la foto que exige la
publicación.

## 4. Reiniciar los datos

`POST /api/admin/organizations/:organizationId/demo/reiniciar` (platform
admin; botón "Reiniciar datos de demo" en Plataforma → Organizaciones, en toda
fila con `isDemo`). Es el mismo endpoint que la Clínica Demo, despachado por
rubro (`src/services/reinicioDeDemo.service.ts`): **400 si la organización no
tiene `is_demo`**, sin tocar nada; CLINICA → el reinicio de la clínica de
siempre; AUTOMOTORA → `reiniciarDatosDelTallerDemo`
(`src/automotora/demo/reinicioDelTallerDemo.service.ts`):

1. 400 si no es AUTOMOTORA con el slug del Taller Demo; 409 si el módulo
   Servicios está apagado, si no hay un ADMIN activo o si falta alguna pieza
   de la configuración de ejemplo, buscada por su nombre de `config.ts`
   (sucursales, agenda del taller, proceso y etapas, tipos de service, campos,
   agente). Todo antes de borrar.
2. Los usuarios de los datos salen de la configuración: el ADMIN más viejo,
   el vendedor (responsable por defecto de Sucursal Este) y el encargado del
   taller (el otro USER activo).
   Después de validar, el reinicio **alinea** una demo creada antes con la
   configuración de hoy, sin pisar lo editado a mano: Casa Central con el
   vendedor de responsable, horario en los recursos, la agenda de la prueba de
   manejo, las herramientas que le falten al agente (y sus instrucciones, solo
   si siguen siendo las del alta anterior) y la regla del recordatorio a 7
   días antes (solo si sigue en los 7 días después de antes).
3. **Borrado y recarga masiva en una sola transacción**
   (`pg_advisory_xact_lock` por organización al empezar): si algo falla, la
   demo queda como estaba. El orden sale de las FKs, hijas antes que madres,
   con tres ciclos cortados antes (próximo service fijado por una orden, unidad
   de interés de un contacto, unidad recibida en permuta). Se borran también
   los datos agregados a mano durante una reunión (cotizaciones, pagos,
   entregas, fotos). Los contadores vuelven a 1 (OS-0001, STK-000001).
4. Las órdenes por los services y la sincronización del stock, como en el
   alta. Si fallan a mitad, 500; volver a reiniciar lo arregla.
5. Un segundo reinicio mientras corre el primero: 409 (candado en memoria; el
   backend corre en una sola instancia).

**Se conserva** (mismos ids): la organización y su modo demo, sucursales,
horarios, agenda del taller, proceso de venta, tipos de service y
`workshop_settings` (salvo el contador), campos personalizados, base de
conocimiento cargada a mano, agente y tokens del widget, automatizaciones y sus
plantillas, QR, usuarios, invitaciones y `llm_turn_usages`. Los archivos de las
fotos borradas quedan en el bucket, sin nada que los referencie.

**Cuánto tarda en producción** (medido el 2026-10-17): el alta, unos 4
minutos; el reinicio, unos 3. El diseño fijaba 60 s como umbral para pasar el
reinicio a un trabajo en segundo plano; por ahora la request no se corta (ni
Render ni el frontend) y el botón queda en espera hasta que termina.

Cómo mostrar la demo en una reunión: [`docs/demo-guion.md`](demo-guion.md).

## 5. Lo que pasa con el tiempo

Los barridos del módulo (recordatorio de service a las 10, recambios, ventas
→ vehículos) corren sobre la demo como sobre cualquier organización: crean
avisos, encolan recordatorios (que se "mandan" simulados) y tareas. Es
deseable: en la ficha de un vehículo se ve el recordatorio enviado hoy. El
reinicio (§4) vuelve todo al punto de partida.

## 6. Tests

- `src/automotora/demo/datosDeEjemplo.test.ts`: las fechas con un "hoy" por
  cada día de la semana y en los bordes de mes, y la coherencia de la
  configuración (transiciones de las órdenes, un auto por vez en el taller,
  los conteos de cada pantalla).
- `src/automotora/demo/tallerDemo.integration-test.ts`: el alta contra la
  app real: 401/403, los 400/409 sin dejar nada, el 201 con la organización
  en modo demo, el módulo, los tres usuarios, los datos tal como los cuentan
  el Dashboard y el Resumen del taller, nada enviado; la purga no la toca; el
  reenvío cubre a los tres usuarios; sin modo demo no se cargan datos; el
  alta común con el nombre de la demo no pone la bandera. Y el reinicio:
  borra lo de uso (también lo agregado a mano), conserva la configuración con
  sus ids, vuelve a cargar lo de §3 (OS-0001, STK-000001); dos a la vez dan
  200 y 409; configuración faltante 409 sin borrar; sin modo demo 400 sin
  borrar.
- `organizationAdmin.service.test.ts`: las dos opciones de demo ponen
  `is_demo`; `tallerDemo` no es un bypass.
