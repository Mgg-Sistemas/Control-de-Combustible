# SKILLS — Control de Combustible

Documento de competencias y skills reutilizables para el proyecto **Control de Combustible**.

- **Stack:** App móvil Expo (React Native) + TypeScript; backend Supabase (PostgreSQL, Auth, RLS, Storage).
- **Flujo de trabajo:** GitFlow, equipo pequeño.
- **Dominio de la app:** ingresos de combustible, consumos, tanques, autorizaciones, vehículos/maquinaria, traslados de combustible, dashboard y usuarios/roles.

Este documento tiene dos partes:

- **Parte A — Matriz de competencias del equipo:** qué habilidades técnicas se necesitan, a qué nivel y para qué.
- **Parte B — Skills reutilizables de Claude Code:** flujos automatizables a crear en `.claude/skills/` para acelerar el desarrollo.

---

## PARTE A — Matriz de competencias del equipo

Niveles: **Básico** (entiende y usa con guía), **Intermedio** (trabaja con autonomía), **Avanzado** (diseña, optimiza y resuelve problemas complejos).

| # | Competencia | Nivel requerido | Para qué se usa en este proyecto |
|---|-------------|-----------------|----------------------------------|
| 1 | **React Native + Expo** | Intermedio | Construir todas las pantallas: ingresos, consumos, tanques, autorizaciones, vehículos/maquinaria, traslados y dashboard. Navegación, formularios, listas, cámara/escaneo y manejo de estado de la UI. |
| 2 | **TypeScript** | Intermedio | Tipado de modelos de dominio (Tanque, Vehículo, Consumo, Traslado), props de componentes, respuestas de Supabase y reducción de errores en runtime. |
| 3 | **Supabase (cliente JS)** | Intermedio | Consultas CRUD, suscripciones realtime, Auth (login/roles), Storage (fotos de comprobantes/medidores) y RPC. |
| 4 | **PostgreSQL / SQL** | Intermedio | Diseño del esquema (tablas, relaciones, índices, constraints), vistas para el dashboard, funciones/triggers para balances de tanque y migraciones. |
| 5 | **RLS y seguridad (Postgres + Supabase Auth)** | Avanzado | Políticas Row Level Security por rol/usuario para que cada perfil solo vea/edite lo permitido (autorizaciones, traslados, datos por sede). Es crítico: protege datos sensibles de inventario. |
| 6 | **Diseño UI móvil (UX)** | Intermedio | Pantallas usables en campo (operadores con guantes/sol): formularios claros, validación, estados de carga/error, accesibilidad y diseño responsivo. |
| 7 | **Gestión de estado y data-fetching** | Intermedio | Cache, revalidación y sincronización (React Query/TanStack o Context) para listas e indicadores del dashboard. |
| 8 | **Autenticación y roles** | Intermedio | Flujo de login, manejo de sesión/refresh token, control de acceso por rol (admin, supervisor, operador) en UI y en RLS. |
| 9 | **GitFlow** | Intermedio | Ramas `main`/`develop`/`feature/*`/`release/*`/`hotfix/*`, PRs y revisiones de código en equipo pequeño. |
| 10 | **CI/CD (EAS Build/Update + GitHub Actions)** | Básico → Intermedio | Builds y actualizaciones OTA con EAS, lint/test automáticos en PR y publicación de versiones. |
| 11 | **Testing** | Básico → Intermedio | Unit/component (Jest + React Native Testing Library) en lógica de cálculo (balances, consumos) y componentes críticos; smoke tests de flujos. |
| 12 | **Manejo de archivos/imágenes (Storage)** | Básico | Subida y visualización de fotos de comprobantes, medidores y firmas de autorización. |
| 13 | **Reportes y visualización (dashboard)** | Intermedio | Agregaciones (consumo por vehículo/período, nivel de tanques) y gráficos en la app. |
| 14 | **Depuración y observabilidad** | Básico | Logs, Sentry/manejo de errores y diagnóstico en dispositivos reales. |

### Recursos de aprendizaje recomendados

| Competencia | Recurso oficial |
|-------------|-----------------|
| React Native + Expo | https://docs.expo.dev/ · https://reactnative.dev/docs/getting-started |
| TypeScript | https://www.typescriptlang.org/docs/ · https://react.dev/learn/typescript |
| Supabase (cliente JS) | https://supabase.com/docs/reference/javascript · https://supabase.com/docs/guides/with-expo-react-native |
| PostgreSQL / SQL | https://www.postgresql.org/docs/ · https://supabase.com/docs/guides/database/overview |
| RLS y seguridad | https://supabase.com/docs/guides/database/postgres/row-level-security · https://supabase.com/docs/guides/auth |
| Diseño UI móvil (UX) | https://m3.material.io/ · https://developer.apple.com/design/human-interface-guidelines/ |
| Gestión de estado / data-fetching | https://tanstack.com/query/latest/docs/framework/react/overview |
| Autenticación y roles | https://supabase.com/docs/guides/auth/managing-user-data · https://supabase.com/docs/guides/auth/row-level-security |
| GitFlow | https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow |
| CI/CD (EAS) | https://docs.expo.dev/eas/ · https://docs.expo.dev/eas-update/introduction/ · https://docs.github.com/actions |
| Testing | https://jestjs.io/docs/tutorial-react-native · https://callstack.github.io/react-native-testing-library/ |
| Manejo de archivos / Storage | https://supabase.com/docs/guides/storage |
| Reportes y visualización | https://supabase.com/docs/guides/database/postgres/views · https://gifted-charts.web.app/ |
| Depuración y observabilidad | https://docs.expo.dev/debugging/runtime-issues/ · https://docs.sentry.io/platforms/react-native/ |

---

## PARTE B — Skills reutilizables de Claude Code

Flujos de trabajo automatizables a crear en `.claude/skills/`. Cada skill debe ser una carpeta con su `SKILL.md` (instrucciones + pasos) y, opcionalmente, plantillas. El objetivo es estandarizar cómo se crean tablas, pantallas y módulos para mantener consistencia en todo el proyecto.

### Resumen

| Skill | Propósito | Cuándo invocarla |
|-------|-----------|------------------|
| `nueva-tabla-supabase` | Crear tabla + RLS + tipos TS | Al modelar una entidad nueva del dominio |
| `nueva-pantalla-crud` | Generar pantalla CRUD de un módulo existente | Al exponer en la app una tabla ya creada |
| `nuevo-modulo` | Scaffolding completo de un módulo de dominio | Al iniciar un módulo nuevo de punta a punta |
| `sync-tipos-supabase` | Regenerar tipos TS desde el esquema | Tras cualquier cambio en la base de datos |
| `seed-datos-demo` | Cargar datos de demostración/prueba | Al preparar entornos de prueba o demos |
| `politica-rls` | Crear/auditar políticas RLS por rol | Al revisar seguridad de una tabla |

---

### 1. `nueva-tabla-supabase`

| Campo | Detalle |
|-------|---------|
| **Propósito** | Crear una tabla nueva con su migración SQL, índices, constraints, políticas RLS y tipos TypeScript, todo consistente. |
| **Cuándo invocarla** | Cuando se modela una entidad nueva del dominio (p. ej. `traslados_combustible`, `autorizaciones`). |

**Pasos que ejecutaría:**

1. Pedir/confirmar: nombre de tabla, columnas (con tipo y nulabilidad), relaciones (FKs) y reglas de acceso por rol.
2. Generar archivo de migración SQL (`supabase/migrations/<timestamp>_<tabla>.sql`) con `create table`, PK `id uuid default gen_random_uuid()`, `created_at`/`updated_at`, constraints e índices.
3. Habilitar RLS (`alter table ... enable row level security`) y crear políticas base por rol (select/insert/update/delete).
4. Crear trigger `updated_at` si aplica.
5. Aplicar la migración (`supabase db push` o `supabase migration up`) y verificar.
6. Invocar `sync-tipos-supabase` para regenerar los tipos TS.
7. Crear (o actualizar) el archivo de modelo/servicio TS del módulo con las funciones CRUD tipadas.

---

### 2. `nueva-pantalla-crud`

| Campo | Detalle |
|-------|---------|
| **Propósito** | Generar la pantalla CRUD (lista + detalle + formulario crear/editar + eliminar) de una tabla ya existente, siguiendo el patrón de UI del proyecto. |
| **Cuándo invocarla** | Cuando una tabla ya existe en Supabase y hay que exponerla en la app. |

**Pasos que ejecutaría:**

1. Leer la definición de la tabla y sus tipos TS generados.
2. Crear pantalla de lista con búsqueda/filtros, estados de carga/vacío/error y paginación.
3. Crear pantalla de detalle y formulario crear/editar con validación (tipos derivados del modelo).
4. Conectar al servicio Supabase del módulo (data-fetching + cache/revalidación).
5. Registrar las rutas en la navegación y aplicar control de acceso por rol.
6. Generar test de componente básico (render + acción principal).

---

### 3. `nuevo-modulo`

| Campo | Detalle |
|-------|---------|
| **Propósito** | Scaffolding completo de un módulo de dominio de punta a punta: tabla + RLS + tipos + servicio + pantallas + navegación + test. Combina las skills 1, 2 y 4. |
| **Cuándo invocarla** | Al arrancar un módulo nuevo completo (p. ej. "Tanques", "Traslados"). |

**Pasos que ejecutaría:**

1. Recopilar especificación del módulo: entidad(es), campos, reglas de negocio y roles.
2. Ejecutar `nueva-tabla-supabase` para crear esquema, RLS y tipos.
3. Crear la estructura de carpetas del módulo (`screens/`, `services/`, `components/`, `types/`).
4. Ejecutar `nueva-pantalla-crud` para las pantallas.
5. Añadir el módulo al menú/navegación y al dashboard si corresponde.
6. Generar tests y un README corto del módulo.
7. Crear rama `feature/<modulo>` (GitFlow) y dejar un commit inicial listo para PR.

---

### 4. `sync-tipos-supabase`

| Campo | Detalle |
|-------|---------|
| **Propósito** | Regenerar el archivo de tipos TypeScript a partir del esquema actual de Supabase para mantener la app tipada y sincronizada. |
| **Cuándo invocarla** | Después de cualquier cambio en la base de datos (nueva tabla, columna, enum o migración). |

**Pasos que ejecutaría:**

1. Verificar acceso al proyecto Supabase (project-ref / variables de entorno).
2. Ejecutar `supabase gen types typescript` (local o `--project-id`) hacia `src/types/database.types.ts`.
3. Detectar cambios incompatibles (columnas eliminadas/renombradas) y reportar dónde rompen.
4. Ejecutar `tsc --noEmit` para validar que el proyecto sigue compilando.
5. Resumir los cambios de tipos y archivos afectados.

---

### 5. `seed-datos-demo`

| Campo | Detalle |
|-------|---------|
| **Propósito** | Poblar la base con datos de demostración/prueba realistas y coherentes (tanques, vehículos, ingresos, consumos, traslados, usuarios/roles). |
| **Cuándo invocarla** | Al preparar un entorno de pruebas, una demo o tras resetear la base local. |

**Pasos que ejecutaría:**

1. Confirmar entorno destino (local/staging) — **nunca** producción.
2. Crear usuarios de prueba por cada rol (admin, supervisor, operador).
3. Insertar datos maestros: tanques con capacidad/nivel inicial, vehículos/maquinaria.
4. Insertar movimientos: ingresos, consumos y traslados con fechas coherentes para que el dashboard tenga datos.
5. Respetar FKs y mantener consistencia de balances de tanque.
6. Generar/actualizar `supabase/seed.sql` y aplicarlo; reportar conteos por tabla.

---

### 6. `politica-rls`

| Campo | Detalle |
|-------|---------|
| **Propósito** | Crear o auditar políticas Row Level Security de una tabla, asegurando acceso correcto por rol y sin fugas de datos. |
| **Cuándo invocarla** | Al revisar la seguridad de una tabla nueva o existente, o antes de un release. |

**Pasos que ejecutaría:**

1. Listar las políticas actuales de la tabla y los roles del proyecto.
2. Verificar que RLS está habilitado y que existen políticas explícitas para select/insert/update/delete.
3. Proponer/ajustar políticas usando `auth.uid()` y la tabla de perfiles/roles.
4. Generar migración SQL con las políticas.
5. Sugerir pruebas: consultar como cada rol y confirmar que solo ve/edita lo permitido.
6. Reportar riesgos detectados (tablas sin RLS, políticas demasiado abiertas).

---

> **Nota:** cada skill debe vivir en `.claude/skills/<nombre>/SKILL.md` con descripción, "cuándo invocar" y los pasos. Mantener plantillas SQL/TSX dentro de la carpeta de la skill ayuda a que el resultado sea consistente con las convenciones del proyecto.
