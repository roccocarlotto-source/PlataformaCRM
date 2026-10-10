// A qué lugar de la guía apunta el ícono "?" de cada pantalla
// (PageHeader.help). El valor es `<slug de la sección>#<ancla>`, y las dos
// partes tienen que existir en docs/guia-de-uso/: lo verifica
// anclas.test.ts, así un rename de ancla en el markdown rompe el test y no
// un link en producción.
//
// Registro central y no strings sueltos en cada pantalla, por eso mismo: para
// poder verificarlos todos de una, sin renderizar nada.
export const AYUDA = {
  dashboard: "primeros-pasos#dashboard",
  agenteInternoChat: "primeros-pasos#agente-interno",
  ayuda: "primeros-pasos#ayuda",

  contactos: "contactos-y-consultas#contactos",
  contactoForm: "contactos-y-consultas#ficha-de-contacto",
  empresas: "contactos-y-consultas#empresas",
  empresaForm: "contactos-y-consultas#nueva-empresa",

  conversaciones: "conversaciones#bandeja",
  conversacion: "conversaciones#detalle",

  oportunidades: "oportunidades-y-procesos-de-venta#oportunidades",
  oportunidadForm: "oportunidades-y-procesos-de-venta#ficha-de-oportunidad",
  // Las mismas pantallas en la edición Esencial (sin procesos de venta).
  oportunidadesEsencial: "oportunidades-y-procesos-de-venta#oportunidades-esencial",
  oportunidadEsencialForm: "oportunidades-y-procesos-de-venta#nueva-oportunidad-esencial",
  procesosDeVenta: "oportunidades-y-procesos-de-venta#procesos-de-venta",
  procesoForm: "oportunidades-y-procesos-de-venta#procesos-de-venta",
  etapas: "oportunidades-y-procesos-de-venta#etapas",
  etapaForm: "oportunidades-y-procesos-de-venta#etapas",

  stock: "stock#stock",
  unidadForm: "stock#ficha-de-unidad",

  actividades: "actividades-y-agenda#actividades",
  misTareas: "actividades-y-agenda#mis-tareas",
  actividadForm: "actividades-y-agenda#nueva-actividad",
  reservas: "actividades-y-agenda#reservas",
  calendario: "actividades-y-agenda#calendario",
  recursos: "actividades-y-agenda#recursos",
  recursoForm: "actividades-y-agenda#recursos",
  tiposDeServicio: "actividades-y-agenda#tipos-de-servicio",
  tipoDeServicioForm: "actividades-y-agenda#tipos-de-servicio",

  qr: "cupones-y-qr#qr",
  canjearCupon: "cupones-y-qr#canjear-cupon",

  agentes: "agentes-de-ia#agentes",
  agenteForm: "agentes-de-ia#nuevo-agente",
  instalarWidget: "agentes-de-ia#instalar-en-un-sitio",
  probarAgente: "agentes-de-ia#probar",
  agenteInternoConfig: "agentes-de-ia#agente-interno",

  baseDeConocimiento: "base-de-conocimiento#entradas",
  entradaForm: "base-de-conocimiento#nueva-entrada",

  automatizaciones: "automatizaciones#reglas",
  automatizacionForm: "automatizaciones#nueva-regla",

  camposDeContacto: "campos-personalizados#campos",
  campoForm: "campos-personalizados#nuevo-campo",

  usuarios: "usuarios-y-permisos#usuarios",
  invitaciones: "usuarios-y-permisos#invitaciones",
  invitar: "usuarios-y-permisos#invitar",

  organizacion: "organizacion-y-sucursales#organizacion",
  sucursales: "organizacion-y-sucursales#sucursales",
  sucursalForm: "organizacion-y-sucursales#nueva-sucursal",
  fuentes: "organizacion-y-sucursales#fuentes-de-ingesta",
  fuenteForm: "organizacion-y-sucursales#nueva-fuente",
  clavesDeIngesta: "organizacion-y-sucursales#claves-de-ingesta",
  eventosDeIngesta: "organizacion-y-sucursales#eventos-de-ingesta",
  importarArchivo: "organizacion-y-sucursales#importar-archivo",

  nuevaOrganizacion: "plataforma#nueva-organizacion",
  organizaciones: "plataforma#organizaciones",
  numeroDeWhatsapp: "plataforma#whatsapp",
  paginaDeFacebook: "plataforma#facebook",
  modeloDeIa: "plataforma#modelo-de-ia",
  usoDeIa: "plataforma#uso-de-ia",
  importarDatos: "plataforma#importar-datos",
} as const;

export type ClaveDeAyuda = keyof typeof AYUDA;
