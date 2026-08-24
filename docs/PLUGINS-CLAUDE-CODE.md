# Plugins y herramientas de Claude Code — Control de Combustible

Referencia de los **plugins / skills / servidores MCP** disponibles cuando se trabaja
este proyecto con Claude Code. La idea es usarlos activamente y sugerirlos cuando
apliquen (no reinventar lo que un plugin ya resuelve).

> Convención del repo: todo en **español**. GitFlow: `feature/*` desde `dev`, no
> commitear directo a `main`. Antes de cada commit: `npx tsc --noEmit` + `npm run test:all`.

---

## 🧠 Proceso y metodología — `superpowers`
El más importante: define *cómo* trabajar antes de tocar código.

| Skill | Para qué |
|---|---|
| `brainstorming` | Antes de construir algo nuevo: aclarar intención, requisitos y diseño. |
| `systematic-debugging` | Ante cualquier bug: buscar la causa raíz antes de proponer arreglos. |
| `test-driven-development` | Escribir la prueba que falla antes del código. |
| `writing-plans` / `executing-plans` | Planificar tareas multi-paso y ejecutarlas con checkpoints. |
| `verification-before-completion` | No declarar "listo" sin correr la verificación (tsc + tests). |
| `dispatching-parallel-agents` | Repartir en subagentes tareas independientes. |

## 🗄️ Base de datos — `supabase`
Backend del proyecto (Postgres + Auth + Storage + Realtime).

- **`supabase`** — cualquier tarea de Supabase: esquema, RLS, migraciones, Auth,
  Edge Functions, Realtime, Storage, depurar errores y leer logs.
- **`supabase-postgres-best-practices`** — leer ANTES de escribir/cambiar tablas,
  índices, RLS, triggers o funciones. Reglas de rendimiento y seguridad de Postgres.

> Nota del proyecto: el nivel de tanque es DERIVADO de `stock_movements`; las
> mutaciones sensibles se entregan como **SQL** para correr en el panel (el MCP de
> escritura puede estar bloqueado según la sesión). Las lecturas sí funcionan con un
> script Node + anon key.

## 🔤 Código — LSP, revisión y limpieza
- **`typescript-lsp` (herramienta LSP)** — navegación real de tipos/símbolos:
  definiciones, referencias, diagnósticos. Mejor que grep para preguntas de tipos.
- **`code-review` / `pr-review-toolkit`** — revisión de PR/diff: bugs, seguridad,
  cobertura de pruebas, fallos silenciosos, diseño de tipos.
- **`code-simplifier`** — simplifica y ordena el código recién tocado sin cambiar su
  comportamiento.
- **`commit-commands`** — `commit`, `commit-push-pr`, limpiar ramas `[gone]`.

## 📚 Documentación de librerías — `context7`
Trae documentación **actualizada** de librerías/frameworks (React, Expo, Supabase,
etc.) antes de escribir código con ellas. Preferirlo sobre la memoria del modelo
cuando haya dudas de API o versión.

## 🌐 Navegador y pruebas — `playwright` · `chrome-devtools-mcp`
- **`playwright`** — automatizar el navegador: abrir la app web, hacer clics, llenar
  formularios, tomar capturas, revisar consola/red.
- **`chrome-devtools-mcp`** — depurar rendimiento, red, accesibilidad y Core Web
  Vitals; cazar fugas de memoria.

Útiles para probar la app web (`npm run web`) de punta a punta.

## 📱 Plataforma — `expo` · `vercel`
- **`expo`** — skills de Expo/EAS (build, hosting, updates, router, diseño, upgrade).
  El proyecto es Expo v56: consultar los docs versionados antes de escribir código de Expo.
- **`vercel`** — si algo se despliega/consulta en Vercel (deploy, env vars, funciones).

## 💾 Sistema y archivos — `desktop-commander`
Shells persistentes, procesos largos, acceso a archivos fuera del workspace, leer
archivos grandes (CSV, xlsx, PDF) y búsqueda a escala. (Puede desconectarse en algunas
sesiones.)

## 🧩 Crear plugins / skills — `plugin-dev` · `skill-creator` · `claude-md-management`
- **`plugin-dev`** — crear plugins (comandos, agentes, hooks, MCP).
- **`skill-creator`** — crear/optimizar skills y medir su desempeño.
- **`claude-md-management`** — auditar y mejorar los `CLAUDE.md` / `AGENTS.md`.

## 🎨 Diseño y artefactos — `frontend-design` · `dataviz` · `artifact-design` · `playground`
- **`frontend-design`** — dirección visual para UI nueva (tipografía, paleta, que no
  se vea "de plantilla").
- **`dataviz`** — antes de hacer cualquier gráfico/tablero.
- **`artifact-design` / `design` / `playground`** — publicar páginas/lienzos o crear
  exploradores interactivos.

## 🧠 Memoria y reportes — `remember` · `session-report`
- **`remember`** — guardar estado de la sesión para continuar limpio la próxima vez.
- **`session-report`** — reporte HTML del uso de la sesión (tokens, subagentes, skills).

## 🔌 Integraciones y otros
- **`telegram`** — configurar/gestionar el canal de Telegram.
- **`auth0`** — integración de autenticación Auth0.
- **`ai-plugins` (Endor)** — seguridad de la cadena de suministro / SAST / dependencias.
- **`agent-sdk-dev`** — crear apps con el Claude Agent SDK.
- **`claude-code-setup`** — recomendar automatizaciones (hooks, subagentes, skills, MCP).
- **`ralph-loop` / `loop` / `schedule`** — correr tareas en intervalos o en la nube.

---

## Cómo se usan
- Un skill se invoca con `/<nombre>` (ej. `/code-review`) o Claude lo activa solo
  cuando la tarea aplica.
- Los servidores MCP (supabase, expo, vercel, context7, playwright, chrome-devtools,
  desktop-commander) exponen herramientas extra; algunos requieren autenticación por
  sesión (`claude mcp` o `/mcp`).
- Regla del proyecto ([memoria "usar-plugins-y-sugerirlos"]): usar activamente los
  plugins instalados y **sugerirlos** cuando encajen, en vez de resolver a mano lo que
  ya cubren.

_Última actualización: 24 de agosto de 2026._
