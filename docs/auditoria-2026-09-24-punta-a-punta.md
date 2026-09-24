# Auditoría de punta a punta — 2026-09-24

Auditoría de solo lectura de la plataforma (CRM + agente de IA + WhatsApp +
widget + automatizaciones + agenda + pagos + QR), hecha en una sesión en la
nube. **No se modificó ningún archivo salvo este.** Convención de severidad y
formato heredados de `docs/auditoria-2026-08-29.md`.

> **Estado de este documento:** en construcción — se escribe a medida que
> avanza la auditoría, con un commit por avance. Las secciones marcadas
> `(pendiente)` todavía no se completaron.

---

## 0. Alcance y método

### 0.1 Repositorios y commits auditados

| Repo | Commit | Rama de origen | Estado |
|---|---|---|---|
| `roccocarlotto-source/PlataformaCRM` | `c49fc11c619a716677927e410544caf79d53d011` (= `origin/master` al 2026-09-24) | `master` | auditado |
| `roccocarlotto-source/plataforma-qr` | — | — | **NO ACCESIBLE desde esta sesión.** `add_repo` devolvió "you don't have access to roccocarlotto-source/plataforma-qr" y `list_repos` no lo lista. Todo lo que se dice del Worker de Cloudflare, del `admin/` y del Supabase de QR sale de `docs/qr-integration.md` y del lado CRM del contrato, y queda marcado como **VERIFICAR**. |

### 0.2 Qué se leyó

(pendiente)

### 0.3 Qué se ejecutó y resultados reales

(pendiente)

### 0.4 Limitaciones

1. `plataforma-qr` no accesible (ver 0.1): el eje D-QR y la sección 4 se
   auditan de un solo lado.
2. La rama de trabajo asignada por el entorno era `claude/great-heisenberg-ptafjy`;
   el prompt pidió explícitamente `audit/punta-a-punta-2026-09-XX`, así que
   el documento se publica en `audit/punta-a-punta-2026-09-24`.
3. (se completa a medida que avanza)

### 0.5 Convención de severidad

| Nivel | Criterio |
|---|---|
| **CRÍTICO** | Pérdida de datos, fuga de secretos, fuga de aislamiento entre tenants, caída del servidor |
| **ALTO** | Bug funcional real bajo condiciones alcanzables en producción |
| **MEDIO** | Bug real pero de bajo impacto o difícil de alcanzar |
| **BAJO** | Mejora, deuda técnica o inconsistencia menor sin impacto funcional claro |
| **VERIFICAR** | No está claro si es bug o decisión, o no se pudo comprobar en este entorno |

---

## 1. Resumen ejecutivo

(pendiente)

---

## 2. Lo que vi: mapa de la plataforma

### 2.1 Arquitectura real

(pendiente)

### 2.2 Fichas por módulo

(pendiente)

### 2.3 Modelo de datos resumido

(pendiente)

### 2.4 Catálogos: tools del agente, triggers/acciones de automatización, variables de entorno

(pendiente)

### 2.5 Documentación vs. código

(pendiente)

---

## 3. Hallazgos por eje

### A. Aislamiento multi-tenant y autorización

(pendiente)

### B. Agente de IA y herramientas

(pendiente)

### C. Integridad de datos y concurrencia

(pendiente)

### D. Integraciones externas

(pendiente)

### E. Secretos, configuración y seguridad general

(pendiente)

### F. Frontend

(pendiente)

### G. Operación y despliegue

(pendiente)

### H. Tests y CI

(pendiente)

### I. Alineación con el producto

(pendiente)

---

## 4. Contratos entre repos

(pendiente)

---

## 5. Auditorías previas: siguen abiertos / confirmados resueltos

(pendiente)

---

## 6. Sugerencias

### 6.1 Correcciones

(pendiente)

### 6.2 Cambios

(pendiente)

### 6.3 Mejoras

(pendiente)

---

## 7. Qué no se pudo verificar

(pendiente)

---

## 8. Orden de trabajo recomendado

(pendiente)
