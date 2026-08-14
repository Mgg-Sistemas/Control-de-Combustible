# Traspaso del proyecto — Control de Combustible (SOS La Guaira)

> Documento para poner al corriente a otra persona / a su sesión de Claude.
> Estado al **14-ago-2026**. Todo el texto de la app y docs va en **español**.

---

## 1. Qué es y cómo se despliega

- **App**: Expo v56 (React Native) + TypeScript, backend **Supabase** (Postgres + RLS + realtime + pg_cron).
- **Dominio**: www.soslaguaira.com. Se accede por navegador y por QR.
- **Entrada**: `App.tsx` → `AuthProvider` → `src/navigation` (tabs + stack "Más").
- **Datos**: `src/lib/supabase.ts` (cliente), `src/hooks/useTable.ts` (lectura genérica), `src/types/database.ts` (tipos del dominio, alineados con `supabase/schema.sql`).
- **Comandos**: `npm run web` (probar en navegador), `npx expo start -c` (limpiar caché tras cambiar `.env`), `npx tsc --noEmit` (typecheck).

### Deploy (2 ramas SIEMPRE)
- Se ramifica `feature/*` desde `dev`; **nunca** se commitea directo a `main`.
- **Tras cada cambio: commit + push a `dev` Y a `main`.** El host (DigitalOcean) sirve la `dist/` precompilada (Build Command = None); un **robot de GitHub Actions compila la `dist` en `main`**. Por eso el deploy sale de `main`.
- No commitear `.env` (está en `.gitignore`).
- Barra **ACTUALIZAR** en la app compara `BUILD_ID` vs `/version.json` para avisar al usuario que recargue.

### Supabase / SQL
- Muchas funciones ya están en el código pero **no se activan hasta correr su `.sql`** en Supabase → SQL Editor. Ver **§8 SQL pendiente**.
- **REGLA DE ORO**: tras editar cualquier `.sql` de **función/trigger/RPC**, hay que correr el `CREATE OR REPLACE` en Supabase a mano — **el repo no lo aplica solo**. Diagnóstico: `select pg_get_functiondef('public.<fn>()'::regprocedure);` muestra el cuerpo REAL instalado.
- Una tabla **no emite realtime** si no está en la publicación `supabase_realtime` (`alter publication supabase_realtime add table ...`).
- El MCP de Supabase a veces está autenticado (`apply_migration` para DDL funciona) y a veces no (se le pasa el SQL al usuario para que lo corra). El clasificador de seguridad puede bloquear escrituras a producción → por defecto se entrega el SQL al usuario.

---

## 2. Reglas de JORNADAS (lo más importante)

La **fuente única de horas** es `machine_rounds` (+ `machine_work_segments` como bitácora por-tramo). De ahí leen TODOS los módulos y reportes. Los pagos son **por jornada**, no por hora.

### Turnos y horario
- **DÍA = 7:00am → 7:00pm (12 h)**. **NOCHE = 7:00pm → 7:00am (12 h)**. "Corrido" = día 12 h + noche N horas.
- **Inicio ancla a 7am/7pm** (regla 13-ago-2026): si el inspector marca **dentro del margen** (≤8:30am día / ≤8:30pm noche), `jornada_start_at` se ancla al arranque nominal (7am/7pm) → cuenta turno completo. Si marca **fuera del margen** (9am, 11am, etc.) conserva el inicio declarado → **horas reales + alerta** (no se regalan 12 h a marca tardía). Implementado en `iniciarJornada` (SupervisorScreen): `startIso = retrasoMin <= 0 ? nominalIso : declaredIso`.
- Horario **mostrado** siempre nominal (7am-7pm / 7pm-7am) vía helper `horarioNominal`; las **horas trabajadas** son reales (no tocan pagos).
- El único inspector que **auto-inicia** jornada es **SOS LA GUAIRA** (ver §5, "siempre activo").

### Topes de horas
- **Día ≤ 12 h**, **Noche ≤ 12 h**, **Total (día+noche) ≤ 24 h SIEMPRE**. Nunca 24,5/25 h.
- Excepción: **COMPRESOR CON MARTILLO serial/placa `79669`** trabaja 24 h continuas (único con trato especial).
- El tope de 12 h por turno se aplica al bancar en el teléfono y al mostrar en módulos/reportes (`min(12, ...)`), para que el número del teléfono cuadre con el reporte.

### Permanencia
- Máquinas "jornada/permanencia" trabajan ~12 h de día y ocasionalmente 6 h de noche.
- La **noche NO auto-abre** (deja permanencia); `night_hours` = suma real de segmentos. (Hubo un bug `auto_full_shift` que sumaba +6 h fantasma — corregido.)

### Iniciada por / Finalizada por (14-ago-2026)
- Cada jornada muestra **▶️ Iniciada por** y **🏁 Finalizada por** con **nombre y apellido**, sincronizado en TODAS las tarjetas de Inspecciones y en los 3 informes (por firma, por empresa, por jornada).
- "Iniciada por" = `machine_rounds.jornada_marked_by` (columna nueva; **no se pisa al finalizar**). "Finalizada por" = `recorded_by` del tramo de cierre manual en `machine_work_segments`. El cierre automático 7pm/7am no lleva persona.
- Requiere correr `supabase/machine_rounds_jornada_marked_by.sql` (agrega la columna **y recrea el RPC** `upsert_machine_round` para aceptarla). **Es bloqueante**: el cliente ya hace `select ... jornada_marked_by`.

---

## 3. CRONS activos (pg_cron)

- **`auto_close_jornadas()`** — cada 10 min. Auto-cierra jornadas: **DÍA a las 7pm**, **NOCHE a las 7am**. Candado por hora `if extract(hour ...) not in (7,19) then continue;` (evita cierres a medianoche). Banca `jornada_start_at → hora fin` con tope `least(12, ...)` por turno. Excluye al `79669`. **Complementa** el cierre manual anticipado del teléfono.
- **`expire_paradas_no_trabajo()`** — cada 10 min. Resuelve los tickets `MÁQUINA PARADA` (parada "no trabajó") cuyo **turno ya cerró** (día→19:00 mismo día; noche 19:00–23:59→07:00 día sig; noche 00:00–06:59→07:00 mismo día) → la máquina cae a **⏳ pendiente por iniciar** al día siguiente (NO se arrastra). Archivo: `supabase/expira_paradas_no_trabajo_al_cerrar_turno.sql`.

### GOTCHA crítico de pg_cron
- **Al RESTAURAR la BD (restore), pg_cron se DESPROGRAMA** → las jornadas dejan de cerrarse. Hay que **re-`cron.schedule`** los jobs. Otro motivo de "jornadas que no cierran" es **debris viejo** tras un restore (se guarda ~48 h).
- El `cron` llama a la **función instalada en la BD**, no al archivo del repo. Si editas la función en el `.sql` y no corres el `CREATE OR REPLACE`, el cron sigue usando la versión vieja.

---

## 4. Clasificación de estados (avería / parada / iniciada / pendiente / finalizada)

Prioridad: **avería > parada > iniciada > pendiente**; `finalizada` = cerrada.

- **Clasificador ÚNICO compartido**: `clasificarEstadoTurno(...)` en `src/lib/inspectorDaySets.ts`. Lo usan las tarjetas (InspectionsSummary), el reporte por firma y (vía sets) el resto. Escalera: `averia → parada → (trabajo? abierta?iniciada:cerrada) → (siempreActivo?…) → (declaro?parada) → pendiente`.
- **`declaro`** = `jornada_shift === turno` (persiste tras el auto-cierre aunque `jornada_start_at` sea null y las horas 0). Regla del cliente: **"0 horas = parada"** — una máquina que declaró jornada y cerró con 0 h (sin avería/parada) NO es "por iniciar", es **parada**.
- **Por-turno AISLADO**: la parada/avería de un turno NO afecta al otro (día independiente de noche). Un inspector puede cubrir día Y noche de la misma máquina; el turno vigente se decide por la hora (`nowShift`), no día-primero.
- **DESINCRONIZACIÓN conocida**: el teléfono (SupervisorScreen, `segmentoDe`) arma su `rmap` a partir de `jornada_start_at`/horas y **NO guarda el `declaredSet`** (jornada_shift). Por eso una jornada "declarada noche pero 0 h y sin inicio" sale **pendiente** en el teléfono pero **parada** en los reportes. (Se resolvió puntualmente creando un ticket `MÁQUINA PARADA`; ver historial de payloaders abajo.)

### Parada vs Avería
- **"📍 Parada / No trabajó"** = ticket `maintenance_requests` con `material='MÁQUINA PARADA'`. Vale **solo por su turno**; el cron la expira al cerrar el turno → pendiente por iniciar. **No arrastra**.
- **Avería real** = ticket con `material` distinto (caucho/aceite/filtro/repuesto/otro). **Arrastra** (la máquina queda averiada) hasta que se resuelva de verdad con **🟢 VOLVER A OPERATIVA**.
- **"Parada por avería"** crea DOS tickets: el marcador `MÁQUINA PARADA` + la avería real. El cron resuelve solo el marcador; la avería real mantiene la máquina averiada.
- **Flujo averiada** (regla del cliente): una máquina averiada NO se puede "Iniciar jornada" directo — primero **VOLVER OPERATIVA** (resuelve la avería) y luego **INICIAR JORNADA**. Aplica a parada y avería.
- No se puede iniciar jornada en máquina averiada/parada/"esperando instrucciones" (mismo bloqueo por teléfono del operador o por carnet del inspector).

---

## 5. Reglas y roles especiales

- **Inspector "SOS LA GUAIRA" = siempre activo**: sus máquinas nunca salen parada/avería; siempre cuentan como trabajando y sus horas paradas cuentan como trabajadas (catálogo, panel, teléfono y todos los reportes). Si se les reporta avería, el ticket queda para el mecánico pero no cambia su estado. Helper `inspectorSiempreActivo()`.
- **Roles reales** (`profiles.role`): admin, supervisor (="inspector"), coordinador_patio, operador, conductor. Acceso por-usuario vía `module_permissions`. Roles **FIJOS** (se eliminó el sistema de roles dinámicos), editables y se pueden añadir nuevos desde lista desplegable. Cada rol tiene su pantalla (cocina→CocinaScreen, chofer de combustible, etc.).
- **Coordinador de inspectores**: inspector con superpoderes; conmutador "🚜 Máquinas / 👥 Inspectores"; opera EN NOMBRE de cualquier inspector (la jornada/estado se le marca al inspector dueño; queda nota "registrado por [coordinador]").
- **Supervisión valida jornada**: el check-in del supervisor (GPS) valida la jornada; sin visita el operador no cobra (falta engancharlo a pagos).

---

## 6. Módulos

- **Inspecciones de Maquinaria** — el corazón operativo. Panel de PC (`InspectionsSummary`) + teléfono (`SupervisorScreen`). KPIs por inspector: iniciadas / pendientes / paradas / averiadas / eficiencia / horas reales. Reportes: **por firma** (`inspectorReport.ts`), **por empresa** (`porEmpresaReport.ts`), **por jornada** (`ReportsScreen.tsx`), resumen por inspector.
- **Acarreo** — traslado de maquinaria en chutos + bateas. Tablas `haul_*`, módulo 'acarreo', 6 fases completas. Regla fija: chuto/batea/todo sale del catálogo `machinery`, no de listas aparte.
- **Geodesta** — topografía. Tablas `geodesta_*`, UTM REGVEN 19N (EPSG:2202). Fase 0 hecha; resto pendiente.
- **Obras Públicas** — rol externo (módulo `obras_publicas`) con vista propia. Datos `op_*` (9 tablas) **AISLADOS** de inspectores. Asignación desde catálogo (botón 🏛️). Solo comparte la ubicación con el mapa. m³ removidos POR EDIFICIO. **Se vació entero el 13/08** (eran pruebas) con `supabase/vaciar_obras_publicas.sql` (no toca `public.edificios`, que es compartido).
- **Combustible** — ingresos, consumos, tanques, traslados. Nivel de tanque **DERIVADO** de `stock_movements` (vista `tank_levels`); nunca se edita a mano. Triggers validan que no se despache/traslade más que el stock.
- **Control de Pagos** — cuadra con el Informe por jornada (mismo precio del rango/actual, piso `FLEET_HOURS_START`). Cotejo automático por empresa (✓ cuadra / ⚠️ difiere).
- **Mantenimiento de Maquinaria** — tickets de avería, horómetro (umbral 200/220/250 = last_horometro − horometro_base, alimentado por inicio/fin de jornada, NO toca pagos).
- Otros: Auditoría (`audit_log`), Requerimientos (correlativo REQ-000N por trigger), Asistencia de camiones, Distribución de guardias, Mangueras (correlativo automático).

---

## 7. Campo EDIFICIO y catálogo

- **EDIFICIO** es UN SOLO campo en todo el sistema (se unificó "referencia" + "edificio"), elegido de un catálogo COMPARTIDO (`edificios`) con desplegable + "➕ Agregar". Aparece en el CHECK de máquina y al surtir combustible.
- El **catálogo** separa marca/modelo (tipo sincronizado; valida placa|serial y marca|modelo). **Este/Oeste** lo decide el GPS/mapa (se corrige moviendo el GPS).
- Orden **A→Z natural** en todas las listas/reportes (usar `cmpText`, no `localeCompare` a mano).

---

## 8. SQL pendiente por correr (CRÍTICO)

Estado de `sql-pendiente-por-correr` (memoria). Los que faltan:

- 🔴 **`machine_rounds_jornada_marked_by.sql`** — URGENTE. Columna `jornada_marked_by` + recrea el RPC `upsert_machine_round`. **Bloqueante** (el cliente ya hace `select ... jornada_marked_by` en 3 sitios → sin él, error 400 rompe el panel de Inspecciones y 2 reportes).
- ⏳ **`op_external_machines.sql`**, **`op_realtime.sql`**, **`op_edificio_removidos.sql`**, **`op_edificio_reporte_fase2.sql`**, **`op_daily_reports.sql`** — módulo Obras Públicas (el cliente degrada seguro sin ellos, pero funciones específicas dan error hasta correrlos).
- ⏳ **`payloaders_noche_0_y_tope_24h.sql`** y **`auto_close_jornadas.sql`** (re-correr por el `least(12,…)` nuevo).

Ya corridos esta semana: `vaciar_obras_publicas.sql`, `expira_paradas_no_trabajo_al_cerrar_turno.sql`, `machine_segments_source_finish_early.sql` (arregló el CHECK de `source` para `manual_finish_early` con NOT VALID), `horas_maquinas_4014_2268_desde_7am.sql`, y varios ajustes de datos de payloaders (ver §10).

---

## 9. Convenciones y gotchas rápidos

- **Todo en español** (UI + docs). Mantener `src/types/database.ts` sincronizado con `supabase/schema.sql`.
- **Actualizar el manual SIEMPRE** tras cada cambio del sistema: `src/screens/ManualScreen.tsx` **y** `docs/MANUAL-USUARIO.md`.
- Usar activamente los **plugins** instalados (typescript-lsp, context7, supabase, playwright, code-review…) y sugerirlos cuando apliquen.
- **Confirm dentro de Modal (web)**: `useConfirm()` queda tapado tras un Modal a pantalla completa → usar confirmación EN LÍNEA.
- **Edición vs refetch realtime**: un refetch (realtime/foco) puede pisar una edición reciente con datos viejos → proteger las claves editadas por una ventana de tiempo.
- **Persistencia de vista**: recargar mantiene la pantalla vía linking (la URL refleja el módulo); depende del SPA fallback del host.
- **Rendimiento**: la lentitud es del cliente (no de la BD; los índices ya existen). Batch 1+2 aplicados; fase 3 pendiente (descargas de tabla completa, virtualización, realtime incremental). Hay RPCs agregados en servidor (`machine_total_hours`, `machine_worked_flags`) con fallback al escaneo.
- **Auditoría 11-ago-2026**: críticos de seguridad+concurrencia ya arreglados en BD; refactors riesgosos pendientes (unificar avería/parada, `machine_rounds` atómico ya via RPC `upsert_machine_round`, isOnline nativo…).

---

## 10. Historial reciente (ago-2026, lo que se tocó)

- **Inicio 7am/7pm** anclado en código (margen ≤8:30) + arreglo de datos del día.
- **Parada "no trabajó" expira al cerrar turno** (cron nuevo) → solo quedan averiadas las que de verdad necesitan Volver operativa.
- Reporte **por empresa**: día/noche separados (una parada de noche ya no dice "no trabajó todo el día"); no trae turno no iniciado ni datos viejos a un turno que aún no empieza.
- **Motivo de finalización** (close_reason) mostrado en lista Cerradas + 3 reportes (tras arreglar el CHECK de `source`).
- **Iniciada por / Finalizada por NOMBRE Y APELLIDO** en todas las tarjetas + 3 reportes (columna `jornada_marked_by` + RPC).
- **Obras Públicas vaciado** (borrón total, eran pruebas).
- **Payloaders …1166 / app26 / …5020**: se les quitaron las horas de NOCHE del 13/08. Como al borrar la noche completa (horas + `jornada_start_at` + segmento) salían **pendientes** en el teléfono, se marcó su noche como **🟡 "no trabajó · NO HAY VOLQUETA"** (ticket `MÁQUINA PARADA`) para que salgan de pendientes y sean consistentes; el cron las expira a las 7am → mañana pendientes. El día (9–11 h) intacto.

---

### Archivos clave para leer primero
- `AGENTS.md` / `CLAUDE.md` — guía base del repo.
- `supabase/schema.sql` — esquema, RLS, RPCs, triggers (incl. `upsert_machine_round`, `auto_close_jornadas`).
- `src/lib/inspectorDaySets.ts` — clasificador único de estados por turno.
- `src/screens/redesign/InspectionsSummary.tsx` — panel de Inspecciones (PC).
- `src/screens/SupervisorScreen.tsx` — teléfono (iniciar/finalizar jornada, parada/avería).
- `src/lib/inspectorReport.ts`, `src/lib/porEmpresaReport.ts`, `src/screens/ReportsScreen.tsx` — los 3 informes.
- `docs/MANUAL-USUARIO.md` — manual de usuario (mantener actualizado).
