# Taller Demo

Una automotora de demostración, con el módulo Servicios y datos inventados,
para mostrar el producto a un taller o a una concesionaria antes de que
contrate. Es la hermana de la Clínica Demo (`docs/rubros.md` §12) y copia su
forma: alta por un platform admin con datos de ejemplo detrás, y (en un PR
posterior) el botón "Reiniciar datos de demo".

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
   creada: se borra a mano (hasta que exista el reinicio).

**Limpieza:** el slug no coincide con ningún patrón de
`PATRONES_DE_SLUG_DE_PRUEBA`; ninguna purga de organizaciones de test la toca
(lo prueban `testOrganizationsPurge.service.test.ts` y
`src/automotora/demo/tallerDemo.integration-test.ts`). Se borra a mano.

## 3. Qué datos lleva

`src/automotora/demo/config.ts` (los datos) y `datosDeEjemplo.ts` (la carga).
Dos partes, como en la clínica:

- la **configuración**, solo en el alta y por los services (las mismas
  validaciones que un cliente): dos sucursales con horario y responsable por
  defecto, la agenda del taller, el proceso de venta, la moneda y los tipos de
  service, dos campos personalizados, la base de conocimiento, el agente
  (activo, WhatsApp + web, con el modelo de la demo, un token de widget, sin
  número ni página), un QR y cuatro automatizaciones;
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
| Dashboard | 6 oportunidades abiertas por USD 98.200. Creadas este mes 7 (mes pasado 5). Ganadas este mes 2 por 41.500 (mes pasado 2 por 36.000). Perdidas 1 (2). Tres tareas vencidas |
| Contactos | 15 contactos (6 de WhatsApp, 3 de Instagram, 2 de Messenger, 2 de la web, 2 referidos), dos sin interés, campos "Auto actual" y "Forma de pago"; más "Visitante Web", el contacto del probador del agente |
| Conversaciones | Tres: WhatsApp (consulta por el Onix, el agente busca stock y crea la oportunidad), Instagram (precio de la Ranger, a consultar), Messenger (turno de taller, transferida al encargado). Salientes "Simulados" |
| Oportunidades | Proceso "Venta de autos" (Nuevo → Contactado → Prueba de manejo → Negociación → Ganada / Perdida), 13 oportunidades |
| Stock | 10 unidades: una reservada, dos vendidas (con su entrega), siete disponibles y publicadas; una en pesos, una a consultar |
| Taller → Vehículos de clientes | 15: cuatro de ventas ganadas (con la oportunidad de origen), el resto cargados a mano |
| Taller → Órdenes | OS-0001 a OS-0011: 2 Agendadas (una con el turno cancelado), 2 Recibidas, 2 En trabajo (una con un extra aprobado), 2 Esperando aprobación (una hace más de 24 h), 1 Lista para retirar (cliente avisado), 1 Entregada (fijó el próximo service), 1 Cancelada |
| Taller → Resumen | En el taller 6 (2/2/2). Listos 1. Esperando aprobación hace más de 24 h: 1. Services vencidos 2, en 30 días 3. Turnos cancelados 1. Recambios próximos 2 (2 sin fecha de compra), vencidos 3 |
| Agenda | Tres turnos de taller la semana que viene, uno cancelado |
| Automatizaciones | Activas: "Recordatorio de próximo service" (plantilla aprobada, simulada), "Se acerca el recambio → tarea al vendedor", "Venta ganada → tarea de agradecimiento". Inactiva: "Reseña por QR tras la venta" |

Las unidades se publican sin fotos (el agente las conoce igual por la base de
conocimiento); editar una desde la pantalla pide la foto que exige la
publicación.

## 4. Lo que pasa con el tiempo

Los barridos del módulo (recordatorio de service a las 10, recambios, ventas
→ vehículos) corren sobre la demo como sobre cualquier organización: crean
avisos, encolan recordatorios (que se "mandan" simulados) y tareas. Es
deseable: en la ficha de un vehículo se ve el recordatorio enviado hoy. El
reinicio (PR posterior) vuelve todo al punto de partida.

## 5. Tests

- `src/automotora/demo/datosDeEjemplo.test.ts`: las fechas con un "hoy" por
  cada día de la semana y en los bordes de mes, y la coherencia de la
  configuración (transiciones de las órdenes, un auto por vez en el taller,
  los conteos de cada pantalla).
- `src/automotora/demo/tallerDemo.integration-test.ts`: el alta contra la
  app real: 401/403, los 400/409 sin dejar nada, el 201 con la organización
  en modo demo, el módulo, los tres usuarios, los datos tal como los cuentan
  el Dashboard y el Resumen del taller, nada enviado; la purga no la toca; el
  reenvío cubre a los tres usuarios; sin modo demo no se cargan datos; el
  alta común con el nombre de la demo no pone la bandera.
- `organizationAdmin.service.test.ts`: las dos opciones de demo ponen
  `is_demo`; `tallerDemo` no es un bypass.
