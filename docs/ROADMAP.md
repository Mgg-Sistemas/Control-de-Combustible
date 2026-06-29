# Roadmap — Control de Combustible

> Documento de planificación del producto. Última actualización: **2026-06-29**.
> Stack: **Expo / React Native + TypeScript** (móvil) · **Supabase** (backend, Auth, Postgres, Storage, RLS).
> Flujo de trabajo: **GitFlow** (`main` / `dev` / `feature/*` / `release/*` / `hotfix/*`). Equipo pequeño.

---

## 1. Visión del producto

**Control de Combustible** es una aplicación móvil multiplataforma que centraliza y digitaliza la gestión del combustible de una operación con flota de vehículos y maquinaria. Permite registrar ingresos de combustible, controlar consumos y despachos, administrar tanques y sus niveles, gestionar autorizaciones de despacho, llevar el inventario de vehículos y maquinaria, registrar traslados de combustible entre tanques o ubicaciones, y visualizar todo a través de un dashboard con reportes y alertas. Todo respaldado por un esquema de usuarios, roles y autenticación seguro sobre Supabase, eliminando el control manual en papel, reduciendo pérdidas y dando trazabilidad completa de cada litro.

---

## 2. Fases del proyecto

| Fase | Objetivo | Entregables | Duración | Fechas (inicio → fin) |
|------|----------|-------------|----------|------------------------|
| **Fase 0 — Setup / Infraestructura** | Cimentar el proyecto: repo, CI, Supabase, esqueleto de la app y convenciones. | Repo con GitFlow configurado, proyecto Expo inicial + TS, proyecto Supabase (DB, Auth, RLS base), CI/CD (EAS + lint/test), diseño de esquema de datos, design system base. | 2 semanas | **2026-06-29 → 2026-07-12** |
| **Fase 1 — MVP** | Producto mínimo usable: autenticar, gestionar tanques y registrar el ciclo básico de combustible. | Auth + Roles básicos, módulo Tanques, módulo Ingresos, módulo Consumos/Despachos, navegación principal. | 6 semanas | **2026-07-13 → 2026-08-23** |
| **Fase 2 — Operación ampliada** | Cubrir el flujo operativo completo de control y movimientos. | Módulo Autorizaciones, módulo Vehículos y Maquinaria, módulo Traslados de combustible. | 6 semanas | **2026-08-24 → 2026-10-04** |
| **Fase 3 — Inteligencia y visibilidad** | Convertir datos en información accionable. | Dashboard, Reportes (PDF/CSV/Excel), sistema de Alertas (niveles, anomalías, autorizaciones). | 4 semanas | **2026-10-05 → 2026-11-01** |
| **Fase 4 — Pulido y publicación** | Estabilizar, probar y lanzar a producción. | QA integral, pruebas E2E, optimización, hardening de seguridad, publicación en stores y build web. | 4 semanas | **2026-11-02 → 2026-11-29** |

> **Lanzamiento objetivo (v1.0):** **2026-11-29**.

---

## 3. Desglose por sprints

Sprints de **2 semanas**. Cada sprint inicia lunes y cierra el segundo viernes.

### Fase 0 — Setup / Infraestructura

#### Sprint 0 — Cimientos · **2026-06-29 → 2026-07-12**
**Objetivo:** dejar el entorno listo para desarrollar funcionalidades.

| Ticket | Descripción |
|--------|-------------|
| INFRA-1 | Crear repositorio, configurar GitFlow (`main`/`dev`), protección de ramas y plantillas de PR/issue. |
| INFRA-2 | Inicializar proyecto Expo + TypeScript, ESLint, Prettier, Husky (pre-commit). |
| INFRA-3 | Crear proyecto Supabase: entornos `dev` y `prod`, claves y variables de entorno. |
| INFRA-4 | Diseñar y versionar el esquema de base de datos (migraciones) de todos los módulos. |
| INFRA-5 | Configurar Supabase Auth y políticas RLS base. |
| INFRA-6 | Configurar CI/CD: GitHub Actions (lint + test) y EAS Build/Submit. |
| INFRA-7 | Design system base: tema, tipografía, componentes UI reutilizables, navegación (Expo Router). |

---

### Fase 1 — MVP

#### Sprint 1 — Auth y Tanques · **2026-07-13 → 2026-07-26**
**Objetivo:** usuarios pueden entrar y administrar tanques.

| Ticket | Descripción |
|--------|-------------|
| AUTH-1 | Pantallas login / logout / recuperar contraseña con Supabase Auth. |
| AUTH-2 | Roles básicos (admin, operador) y guardas de navegación por rol. |
| AUTH-3 | Persistencia de sesión y refresh de token. |
| TANK-1 | CRUD de tanques (nombre, ubicación, capacidad, tipo de combustible). |
| TANK-2 | Vista de nivel/saldo actual por tanque. |

#### Sprint 2 — Ingresos · **2026-07-27 → 2026-08-09**
**Objetivo:** registrar entradas de combustible a tanques.

| Ticket | Descripción |
|--------|-------------|
| ING-1 | Formulario de ingreso de combustible (tanque, cantidad, proveedor, costo, fecha). |
| ING-2 | Adjuntar foto/comprobante (Supabase Storage). |
| ING-3 | Actualización automática del saldo del tanque al registrar ingreso. |
| ING-4 | Listado y detalle de ingresos con filtros por fecha/tanque. |

#### Sprint 3 — Consumos / Despachos · **2026-08-10 → 2026-08-23**
**Objetivo:** registrar salidas/despachos y cerrar el ciclo del MVP.

| Ticket | Descripción |
|--------|-------------|
| CONS-1 | Formulario de consumo/despacho (tanque origen, cantidad, destino, operador). |
| CONS-2 | Descuento automático del saldo del tanque y validación de saldo suficiente. |
| CONS-3 | Listado y detalle de consumos con filtros. |
| CONS-4 | Estabilización del MVP + `release/1.0-mvp` y pruebas de aceptación interna. |

---

### Fase 2 — Operación ampliada

#### Sprint 4 — Autorizaciones · **2026-08-24 → 2026-09-06**
**Objetivo:** controlar quién puede despachar y bajo qué aprobación.

| Ticket | Descripción |
|--------|-------------|
| AUTZ-1 | Solicitud de autorización de despacho (solicitante, cantidad, motivo). |
| AUTZ-2 | Flujo de aprobación/rechazo por rol autorizado + estados. |
| AUTZ-3 | Vinculación: un consumo requiere autorización aprobada. |
| AUTZ-4 | Notificaciones in-app de autorizaciones pendientes/resueltas. |

#### Sprint 5 — Vehículos y Maquinaria · **2026-09-07 → 2026-09-20**
**Objetivo:** inventario de activos que consumen combustible.

| Ticket | Descripción |
|--------|-------------|
| VEH-1 | CRUD de vehículos y maquinaria (placa/código, tipo, capacidad de tanque). |
| VEH-2 | Registro de odómetro/horómetro por activo. |
| VEH-3 | Asociar consumos a un vehículo/maquinaria. |
| VEH-4 | Cálculo de rendimiento (litros por km / por hora). |

#### Sprint 6 — Traslados de combustible · **2026-09-21 → 2026-10-04**
**Objetivo:** mover combustible entre tanques/ubicaciones con trazabilidad.

| Ticket | Descripción |
|--------|-------------|
| TRAS-1 | Formulario de traslado (tanque origen → tanque destino, cantidad). |
| TRAS-2 | Actualización atómica de saldos en origen y destino. |
| TRAS-3 | Listado/historial de traslados con filtros. |
| TRAS-4 | `release/2.0-operacion` y QA del flujo operativo completo. |

---

### Fase 3 — Inteligencia y visibilidad

#### Sprint 7 — Dashboard y Reportes · **2026-10-05 → 2026-10-18**
**Objetivo:** visión consolidada y exportable.

| Ticket | Descripción |
|--------|-------------|
| DASH-1 | Dashboard con KPIs: existencias, ingresos vs consumos, top consumidores. |
| DASH-2 | Gráficas por período (día/semana/mes). |
| REP-1 | Reportes exportables a PDF/CSV/Excel por módulo y rango de fechas. |
| REP-2 | Reporte de conciliación de inventario por tanque. |

#### Sprint 8 — Alertas · **2026-10-19 → 2026-11-01**
**Objetivo:** avisar proactivamente de eventos relevantes.

| Ticket | Descripción |
|--------|-------------|
| ALRT-1 | Alertas de nivel bajo / nivel crítico por tanque. |
| ALRT-2 | Alertas de anomalías de consumo (consumo atípico por vehículo). |
| ALRT-3 | Push notifications (Expo Notifications) + centro de notificaciones. |
| ALRT-4 | `release/3.0-bi` y validación de reportes/alertas. |

---

### Fase 4 — Pulido y publicación

#### Sprint 9 — QA y hardening · **2026-11-02 → 2026-11-15**
**Objetivo:** calidad y seguridad listas para producción.

| Ticket | Descripción |
|--------|-------------|
| QA-1 | Pruebas E2E (flujos críticos) y pruebas unitarias clave. |
| QA-2 | Auditoría de RLS y permisos por rol; revisión de seguridad. |
| QA-3 | Optimización de rendimiento y manejo de estado offline. |
| QA-4 | Accesibilidad, internacionalización (es) y revisión UX. |

#### Sprint 10 — Publicación · **2026-11-16 → 2026-11-29**
**Objetivo:** lanzar v1.0.

| Ticket | Descripción |
|--------|-------------|
| REL-1 | Builds de producción con EAS (iOS / Android). |
| REL-2 | Fichas de tienda (App Store / Google Play) y assets. |
| REL-3 | Build web (Expo Web) y despliegue. |
| REL-4 | `release/1.0` → merge a `main`, tag `v1.0.0`, monitoreo post-lanzamiento. |

---

## 4. Hitos / Milestones

| Hito | Descripción | Fecha |
|------|-------------|-------|
| **M0 — Kickoff** | Inicio del proyecto, entorno y esquema listos. | 2026-06-29 |
| **M1 — Infra lista** | CI/CD, Supabase y esqueleto de app operativos. | 2026-07-12 |
| **M2 — MVP funcional** | Auth + Tanques + Ingresos + Consumos en `dev`. | 2026-08-23 |
| **M3 — Operación completa** | Autorizaciones + Vehículos/Maquinaria + Traslados. | 2026-10-04 |
| **M4 — BI listo** | Dashboard, Reportes y Alertas terminados. | 2026-11-01 |
| **M5 — Release Candidate** | App estabilizada y aprobada en QA. | 2026-11-15 |
| **M6 — Lanzamiento v1.0** | Publicación en stores y web. | 2026-11-29 |

---

## 5. Definición de "Hecho" (Definition of Done)

Una tarea/ticket se considera **Hecho** cuando:

- [ ] El código cumple la convención del proyecto (ESLint/Prettier sin errores).
- [ ] Está tipado correctamente en TypeScript (sin `any` injustificados).
- [ ] Tiene pruebas (unitarias y/o E2E para flujos críticos) y todas pasan.
- [ ] Las migraciones de base de datos y políticas RLS están aplicadas y versionadas.
- [ ] Funciona en iOS y Android (y web si aplica).
- [ ] Pasó revisión de código (PR aprobado por al menos un revisor).
- [ ] Se hizo merge a `dev` siguiendo GitFlow, sin romper la build de CI.
- [ ] La funcionalidad fue verificada contra el criterio de aceptación del ticket.
- [ ] No introduce regresiones en flujos existentes.
- [ ] La documentación relevante (README/CHANGELOG/notas) fue actualizada.

---

## 6. Métricas de éxito / KPIs

### KPIs de producto
| KPI | Meta |
|-----|------|
| Tiempo de registro de un despacho | < 60 segundos |
| Exactitud de inventario (físico vs sistema) | ≥ 98 % |
| Adopción del equipo operativo | ≥ 90 % de despachos registrados en la app |
| Reducción de mermas/pérdidas no justificadas | -25 % en 3 meses post-lanzamiento |
| Autorizaciones procesadas dentro de SLA | ≥ 95 % en < 30 min |

### KPIs técnicos
| KPI | Meta |
|-----|------|
| Crash-free sessions | ≥ 99.5 % |
| Cobertura de pruebas en módulos críticos | ≥ 70 % |
| Tiempo de arranque en frío (cold start) | < 3 s |
| Build de CI exitosa en `dev`/`main` | ≥ 95 % |
| Tiempo de carga del dashboard | < 2 s |

---

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Prob. | Mitigación |
|--------|---------|-------|-----------|
| Equipo pequeño: cuello de botella / dependencia de una persona | Alto | Media | Documentar decisiones, pair programming, sprints con buffer y priorización clara (MoSCoW). |
| Mal diseño del esquema de datos / saldos inconsistentes | Alto | Media | Definir esquema en Fase 0, usar transacciones/funciones RPC atómicas para saldos, pruebas de conciliación. |
| Conectividad intermitente en campo (operación offline) | Alto | Alta | Estrategia offline-first (cache local y sincronización), validaciones en servidor. |
| Configuración deficiente de RLS / fuga de datos | Alto | Media | Auditoría de RLS por rol (QA-2), pruebas de seguridad, principio de menor privilegio. |
| Rechazo / demoras en publicación en App Store / Play | Medio | Media | Preparar fichas y assets temprano (Sprint 10), revisar políticas de tiendas con antelación. |
| Cambios de alcance (scope creep) | Medio | Alta | Backlog priorizado, control de cambios, congelar alcance por fase. |
| Costos/limitaciones de Supabase al escalar | Medio | Baja | Monitoreo de uso, índices y consultas optimizadas, plan de escalamiento. |
| Baja adopción del equipo operativo | Alto | Media | UX simple, capacitación, feedback temprano con usuarios reales en MVP. |
| Dependencia de servicios externos (Expo/EAS, push) | Medio | Baja | Versionado de SDK, builds reproducibles, fallback de notificaciones in-app. |

---

> _Documento vivo: se revisa al cierre de cada sprint y se ajusta en la retrospectiva._
