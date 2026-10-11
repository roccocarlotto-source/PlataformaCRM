import {
  Activity,
  BookOpen,
  Bot,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  Clock,
  Coins,
  LayoutDashboard,
  ListChecks,
  MailPlus,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  QrCode,
  Settings2,
  Shapes,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import type { MeResponse } from "../auth/AuthContext";
import { tieneModulo } from "../auth/useModulo";
import { vocabularioDe } from "../auth/vocabulario";
import { SidebarLink, SidebarSection } from "./Sidebar";

// El menú de una clínica (docs/rubros.md §1.3 y §3.1): Agenda, Turnos,
// Pacientes, Conversaciones, Tareas, Profesionales, Prestaciones, Base de
// conocimiento, Agente y Automatizaciones, con los textos del rubro. Sin
// Stock, Empresas, Oportunidades, Procesos de venta, Canjear cupón ni ingesta
// (decisión de Rocco para R17: los módulos de ingesta y cupones siguen, solo
// salen del menú). Administración conserva Usuarios, Invitaciones,
// Organización, Sedes, Campos y el QR (lo usa el QR de reseña, §7.1).
//
// Recepción (§11.2) ve lo operativo: agenda, turnos, bloqueos, sobreturnos,
// pacientes, conversaciones y sus tareas. Nada de configuración, que es de
// ADMIN: ni Administración, ni Agentes de IA (agente, base de conocimiento,
// automatizaciones), ni Profesionales ni Prestaciones.
export function MenuDeClinica({
  me,
  isAdmin,
  canUseInternalAgent,
}: {
  me: MeResponse | null;
  isAdmin: boolean;
  canUseInternalAgent: boolean;
}) {
  const v = vocabularioDe(me);
  const conAgenteInterno = tieneModulo(me, "agente_interno");

  return (
    <>
      <SidebarLink to="/" end icon={LayoutDashboard}>
        Dashboard
      </SidebarLink>
      {canUseInternalAgent && conAgenteInterno ? (
        <SidebarLink to="/internal-agent" end icon={MessageSquareText}>
          Agente interno
        </SidebarLink>
      ) : null}
      {/* La agenda y lo que cuelga de ella: el título es el link al
          calendario, como Contactos en el menú de automotora. */}
      <SidebarSection
        label={v.agenda.singularTitulo}
        link={{ to: "/agenda", icon: CalendarRange }}
        paths={[
          "/bookings",
          "/clinica/bloqueos",
          "/clinica/sobreturnos",
          "/clinica/profesionales",
          "/clinica/prestaciones",
          "/service-types",
        ]}
      >
        <SidebarLink to="/bookings" icon={CalendarDays}>
          {v.reserva.pluralTitulo}
        </SidebarLink>
        <SidebarLink to="/clinica/bloqueos" icon={CalendarRange}>
          Bloqueos
        </SidebarLink>
        <SidebarLink to="/clinica/sobreturnos" icon={CalendarRange}>
          Sobreturnos
        </SidebarLink>
        {isAdmin ? (
          <>
            <SidebarLink to="/clinica/profesionales" icon={Shapes}>
              {v.recurso.pluralTitulo}
            </SidebarLink>
            <SidebarLink to="/clinica/prestaciones" icon={Clock}>
              {v.tipoDeServicio.pluralTitulo}
            </SidebarLink>
            <SidebarLink to="/service-types" icon={Clock}>
              {`Configurar ${v.tipoDeServicio.plural}`}
            </SidebarLink>
          </>
        ) : null}
      </SidebarSection>
      <SidebarSection
        label={v.contacto.pluralTitulo}
        link={{ to: "/contacts", icon: Users }}
        paths={["/conversations"]}
      >
        <SidebarLink to="/conversations" icon={MessagesSquare}>
          Conversaciones
        </SidebarLink>
      </SidebarSection>
      <SidebarSection label="Tareas" paths={["/tasks", "/activities"]}>
        <SidebarLink to="/tasks" icon={CheckSquare}>
          Mis tareas
        </SidebarLink>
        {isAdmin ? (
          <SidebarLink to="/activities" icon={Activity}>
            Todas las tareas
          </SidebarLink>
        ) : null}
      </SidebarSection>
      {isAdmin ? (
        <>
          <SidebarSection
            label="Agentes de IA"
            link={{ to: "/agents", icon: Bot }}
            paths={["/knowledge-base", "/automations", "/internal-agent/settings"]}
          >
            <SidebarLink to="/knowledge-base" icon={BookOpen}>
              Base de conocimiento
            </SidebarLink>
            <SidebarLink to="/automations" icon={Zap}>
              Automatizaciones
            </SidebarLink>
            {conAgenteInterno ? (
              <SidebarLink to="/internal-agent/settings" icon={Settings2}>
                Configurar agente interno
              </SidebarLink>
            ) : null}
          </SidebarSection>
          <SidebarSection
            label="Administración"
            paths={[
              "/qr",
              "/users",
              "/invitations",
              "/organization",
              "/branches",
              "/contact-custom-fields",
            ]}
          >
            <SidebarLink to="/qr" icon={QrCode}>
              QR
            </SidebarLink>
            <SidebarLink to="/users" icon={UserCog}>
              Usuarios
            </SidebarLink>
            <SidebarLink to="/invitations" icon={MailPlus}>
              Invitaciones
            </SidebarLink>
            <SidebarLink to="/organization" icon={Coins}>
              Organización
            </SidebarLink>
            <SidebarLink to="/branches" icon={MapPin}>
              Sedes
            </SidebarLink>
            <SidebarLink to="/contact-custom-fields" icon={ListChecks}>
              {`Campos de ${v.contacto.singular}`}
            </SidebarLink>
          </SidebarSection>
        </>
      ) : null}
    </>
  );
}
