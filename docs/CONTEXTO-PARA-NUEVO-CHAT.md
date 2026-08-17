# Contexto completo — Control de Combustible (SOS La Guaira)

> Documento de traspaso. Pégalo entero al iniciar un chat nuevo.
> Fecha de corte: **17 de agosto de 2026, ~15:00 (hora de Caracas)**.

---

## 1. Qué es esto

ERP interno de **SOS La Guaira / Mineral Group Guayana**, hecho en **Expo v56 / React Native 0.85.3 / TypeScript**, con **Supabase** (Postgres + RLS + pg_cron + Realtime) de backend. Corre como app móvil y como web.

Sitio en producción: **https://www.soslaguaira.com** (el dominio sin `www` redirige con 301, así que `curl` necesita `-L`).

Cubre control de combustible, inspecciones de maquinaria, jornadas y horas de trabajo, nómina, compras, obras públicas, mantenimiento y servicio de maquinaria, coordinación de operadores y reportes en PDF.

### Ruta del proyecto (ojo, está anidada)

```
C:\Users\USUARIO\Desktop\proyect\Control-de-Combustible-main\      ← carpeta externa: solo tiene .mcp.json, .remember y la interna
└── Control-de-Combustible-main\                                   ← EL PROYECTO DE VERDAD (package.json, src/, supabase/)
```

Casi todo el trabajo ocurre en la **carpeta interna**. Vino de otra computadora, por eso la anidación.

---

## 2. Reglas que NO se pueden romper

Son instrucciones textuales del cliente. Violarlas es el error más caro que se puede cometer aquí.

1. **Nada de cambios destructivos en la base sin respaldo previo Y sin preguntar.** "cuando vayas a hacer algún cambio en supabase en base de datos un delete, o algún cambio fuerte, necesito que hagas un backup, y que me preguntes antes de hacerlo". **Leer es libre.**
2. **No tocar el inspector "SOS LA GUAIRA"** ni su automatización (`sos-reassert-shift-start`). "la idea es que esas máquinas inicien solas y se apaguen solas".
3. **No hacer cambios en Inspectores ni en Inspecciones** salvo que se pida explícitamente ese módulo.
4. **Regla de oro del SQL**: editar un archivo `.sql` **no lo aplica**. Hay que correrlo a mano en el SQL Editor de Supabase y verificar el resultado. Nunca dar por hecho que un `.sql` del repo ya está en producción.
5. **El manual se actualiza siempre.** Todo cambio funcional se refleja en `docs/MANUAL-USUARIO.md` y en `src/screens/ManualScreen.tsx`. Es convención no negociable.
6. **Respaldo antes de reformar un módulo**: carpeta `docs/backups/<modulo>-<fecha>` + etiqueta de git.
7. **Probar antes de decir "listo".** Que compile con `tsc` y despliegue limpio **no es prueba** de que funcione.
8. **Análisis de compatibilidad global antes de arreglar**: este código tiene mucha lógica duplicada. Antes de corregir un bug hay que buscar **todas** las implementaciones del mismo cálculo, no solo la primera.

### Preferencias de trabajo del cliente

- Escribe en **español**, informal, y espera respuestas en español. Toda la interfaz va en español.
- **No usar `AskUserQuestion`** — prefiere preguntas en texto plano.
- **Quiere que se desplieguen subagentes** para trabajar en paralelo. Lo ha pedido varias veces ("despliega múltiples agentes").
- Suele decir "es urgente" / "rápido por favor". Prioriza entregar y subir.

---

## 3. Git y despliegue

### GitFlow obligatorio

- Ramas `feature/*` salen de `dev`.
- **A `main` NUNCA se hace merge**: solo **cherry-pick de los commits propios**. La compañera del cliente también trabaja en el repo y sus cambios no deben irse a producción mezclados sin querer.
- **Nunca commitear directo a `main`.**

### Identidad

- El cliente firma como **sistemamgg2**; la compañera es **Mgg-Sistemas**.
- Repo: **`Mgg-Sistemas/Control-de-Combustible`** en GitHub.
- Email de la cuenta: `mineralgroupguayanaca@gmail.com`.

### Compatibilidad con la compañera

Ella empuja a `dev` y a `main` sin avisar. **Siempre `git fetch` antes de trabajar.** Si un push sale rechazado por non-fast-forward, **nunca forzar**: crear una rama de respaldo, `reset --hard origin/dev`, y volver a aplicar lo propio con `git checkout <respaldo> -- <archivos>`. Sus cambios se reconcilian, jamás se sobreescriben.

### Despliegue

`.github/workflows/deploy-web.yml` construye `dist/` **en cada push a `main`**. Ya no hace falta build manual. Deja un commit `build(web): dist automática [skip ci]`.

Para verificar que el despliegue llegó:

```bash
curl -sL "https://www.soslaguaira.com/version.json"
# devuelve {"v":"<sha completo del commit desplegado>"}
```

Empujar a `main` a veces falla por tamaño; usar:

```bash
git -c http.postBuffer=524288000 -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999999 push origin main
```

---

## 4. Cómo se prueba

**El proyecto no tiene framework de tests.** Los tests son scripts `.mjs` que transpilan los `.ts` en memoria con el paquete `typescript` e interceptan `require` con un `Module` stub para simular las dependencias.

```bash
npx tsc --noEmit          # obligatorio antes de cualquier commit
npm run test:clasificacion   # 48 aserciones — estados por turno
npm run test:cola-offline    # 31 aserciones — cola offline de listeros
npm run test:reportes        # 15 aserciones — paridad teléfono vs web
npm run test:horas           # 24 aserciones — cálculo de horas
```

Otros scripts: `npm run web`, `npm run build:web`, `npm run deploy`.

**Disciplina de verificación usada en esta sesión y que conviene mantener**: cada test se corrió primero contra el código **viejo** para demostrar que falla, y después contra el nuevo. Si no falla antes, el test no prueba nada.

---

## 5. Conocimiento del dominio (esto es lo que más cuesta reaprender)

### Jornadas y turnos

- Turno **día** ancla a las **07:00**; turno **noche** a las **19:00**. Hora de Caracas (`America/Caracas`, UTC-4).
- Tope de **12 horas** por turno.
- El turno de noche del día X cierra a las 07:00 del día X+1.
- Las horas se **bancan al cerrar** la jornada. Mientras está en curso, `day_hours`/`night_hours` siguen en 0 y el cálculo "en vivo" se hace en el cliente. **Esta es la fuente del bug clásico de esta app.**
- El cierre lo hace el cron **`auto-close-jornadas`**, que escribe tramos en `machine_work_segments` con `source = 'auto_close'`.

### Clasificación de estados por turno

Hay prioridad entre estados. "0 horas = parada". **Parada y avería no son lo mismo.** Existe una desincronización conocida entre lo que se declara desde el teléfono y lo que sale en los reportes: una máquina declarada con 0 h queda *pendiente* en el teléfono y *parada* en la web.

### Supervisión

**Sin visita del supervisor el operador no cobra.** La validación de la jornada por parte de supervisión es parte del cálculo de pago.

### Crons de pg_cron

Al restaurar la base **los crons se desprograman** y las jornadas dejan de cerrarse. Ya pasó una vez. Verificar con `select jobname, schedule, active from cron.job order by jobname;`.

Cadena del "cajón" **MAQUINAS FALTANTES** — 5 crons encadenados:

1. `assign-missing-to-placeholder` (*/15) — la puerta de entrada: asigna toda máquina activa sin inspector a un usuario virtual
2. `auto-start-placeholder-day` (5 11 * * *)
3. `auto-start-placeholder-night` (5 23 * * *)
4. `auto-full-shift-placeholder` (15 4 * * *)
5. `auto-close-placeholder-night` (*/10)

El cliente quiere quitar el (1). **Ya se verificó que el cajón tiene 0 máquinas**, así que quitarlo es de riesgo cero.

### Trampa: `machinery.code` NO es único

Varias máquinas distintas comparten el mismo código (hay 5 llamadas "OXICORTE"). **Nunca usar `code` como identidad** — usar siempre `id`. Ignorar esto ya causó un bug real: llaves duplicadas de React y selección cruzada en las listas de checkboxes.

---

## 6. Estado actual del repositorio

| Rama | Commit | Nota |
|---|---|---|
| `dev` (local) | `eb2d3880` | al día |
| `origin/dev` | `104c6e9b` | falta empujar `eb2d3880` |
| `main` / `origin/main` | `100e4e84` | desplegado; el build es de `f305f754` |
| `respaldo-conteo-6fe6c2c0` | `6fe6c2c0` | trabajo abandonado de Reportes→Conteo, por si hace falta rescatar algo |

**Sin commitear en el árbol de trabajo**: `.claude/settings.local.json`, `docs/backups/`, `docs/manuales-pdf/` (sin seguimiento), más lo que estén produciendo los agentes.

---

## 7. Lo que se hizo en esta sesión

### Auditoría de horas (el caso César Flames)

**Síntoma**: el reporte que el inspector imprimía desde el teléfono daba **137,38 h** y la web **35,38 h** para la jornada del 16/08/2026. Diferencia exacta de 102,00 h.

**Auditoría**: se encontraron **13 fórmulas distintas de horas repartidas en 8 archivos**, divergiendo en 4 ejes: día+noche vs solo turno; ancla real vs nominal (7am/7pm); `max` vs `suma` de bancado+transcurrido; y distintos umbrales y topes.

**Causa raíz, doble**:
1. Las jornadas del 16/08 nunca cerraron, así que `day_hours` quedó en 0.
2. `src/lib/inspectorReport.ts` **no tenía guardia de "es hoy"**, así que un día pasado saturaba en 12,00 h por máquina para siempre.

**Arreglo**: se unificó la fórmula en `src/lib/hours.ts` (`horasTurnoDelDia`, `MIN_WORKED_HOURS = 0.05`, tipo `RondaHoras`) y se agregó el guardia en `inspectorReport.ts`:

```ts
const esDiaDeHoy = date === caracasBusinessToday();
const liveElapsedH = esDiaDeHoy && estado === 'encurso' && rd?.jornada_start_at ? ... : 0;
```

**Verificado hoy contra la base** (por REST, ver §9): el cron **está vivo** y cerró solo los días 13, 14, 15 y 16 de agosto. **Cero jornadas sin cerrar en días pasados.** El 16/08 tiene 2.517,86 h bancadas. **El caso está resuelto en los datos.**

> ⛔ Por eso `supabase/recuperar_jornadas_sin_cerrar.sql` **ya no debe correrse**. Como no filtraba por fecha, agarraría las jornadas **de hoy** (en curso) y las cerraría bancando horas hasta las 7pm que nadie trabajó, inflando los pagos. Se le puso el guardia `round_date < current_date` en los bloques 3 y 4 (commit `eb2d3880`).

### Cola offline de los listeros

**Problema**: si un viaje fallaba por algo que no era falta de señal (el camión se borró, un dato quedó inválido), la cola se detenía ahí para siempre y todos los viajes posteriores quedaban atascados detrás.

**Arreglo**: se creó `src/lib/colaOfflinePolicy.ts` como decisión única compartida por las dos colas:

```ts
export type AccionCola = 'exito' | 'reintentar' | 'cuarentena';
export const MAX_INTENTOS_COLA = 3;
export function decidirAccionCola(x: { error?: string | null; intentos: number }): AccionCola {
  if (!x.error) return 'exito';
  if (esErrorDuplicado(x.error)) return 'exito';
  if (esErrorDeRed(x.error)) return 'reintentar';
  return (Number(x.intentos) || 0) + 1 >= MAX_INTENTOS_COLA ? 'cuarentena' : 'reintentar';
}
```

Y se reescribió `src/lib/viajesOfflineQueue.ts` con **cuarentena**: `QuarantinedViaje`, `QUARANTINE_KEY = 'viajes_offline_quarantine_v1'`, `subscribeViajesQuarantine`, `retryQuarantinedViajes`, `discardQuarantinedViaje`. El bucle de `flushViajesQueue` hace `continue` sobre lo puesto en cuarentena, así que la cola sigue avanzando.

**Probado empíricamente**: con el código viejo, 1 de 3 viajes sincronizaba después de 50 reintentos. Con el nuevo: 2 sincronizados + 1 en cuarentena.

### Reportes

- Se metieron las horas de máquinas paradas en el reporte del teléfono del inspector, y después, a pedido del cliente, se **quitaron los totales de horas de parada** de ambos documentos (tarjetas KPI, pie de sección y celda del pie de tabla).
- Se sincronizó el módulo Control con el Reporte por Empresa, sin tocar Inspectores ni Inspecciones.

### Catálogo → Reporte de maquinaria (lo último que se entregó)

- **Selección manual de máquinas** que salen en el PDF, con buscador y botones "✓ Marcar todas (N)" / "✕ Limpiar (N)". Si no se marca ninguna, salen todas.
- **Columnas Marca y Modelo** en la tabla del reporte.
- Opción de **separar por empresa** (salto de página y resumen de tipos por empresa).

Archivo: `src/screens/EquiposScreen.tsx`. Commits `46fe846e` y `3aa1cada` en `dev`, cherry-picked a `main` como `f631eb60` y `4c876ddb`.

> **Historia importante**: esto primero se intentó en **Reportes → Conteo de equipos** y salió mal (por el bug de `code` no único). El cliente pidió textualmente: *"revierte todos los cambios que hicimos en reportes conteo... y adapta en catálogo, reporte de maquinaria"*. Se revirtió con `git revert 672ad4ce`. **No volver a tocar Reportes → Conteo.**

### Obras Públicas

Se creó `src/screens/ObrasPublicasAsignacionScreen.tsx`: panel de administración **fuera** del módulo de Obras Públicas para asignarle máquinas a mano (no solo Liccioni/Golden). Tiene chips de multi-empresa, filtro por varios estados (operativa / averiada / en espera / inactiva), lista de checkboxes, asignación por lote e individual, y "Quitar".

Módulo `op_asignacion`, registrado en `src/lib/permissions.ts`, `src/navigation/index.tsx` (`ObrasPublicasAsignacion: 'obras-publicas-asignacion'`) y `src/screens/MoreScreen.tsx`. **Nace cerrado** — el cliente tiene que habilitar el permiso desde Usuarios.

---

## 8. Lo que queda pendiente

### 🔴 Acción del cliente

1. **Autorizar el MCP de Supabase**: `/mcp` → `supabase` → autorizar en el navegador. Sin eso el asistente no puede correr SQL. (Detalle en §9.)
2. **Habilitar el permiso `op_asignacion`** desde Usuarios para poder ver el panel de Obras Públicas.

### 🟡 SQL escrito pero sin correr

- `supabase/quitar_adopcion_automatica_placeholder.sql` — **Opción A** (quitar solo `assign-missing-to-placeholder`). Riesgo cero: ya se verificó que el cajón tiene 0 máquinas.
- `supabase/servicio_maquinaria_tabla_propia.sql` — crea `servicio_registros` (`origen 'taller'|'inspector'`, `source_request_id`, `estado 'pendiente'|'realizado'`), con RLS, realtime y bloques de verificación y deshacer. **Solo CREATE, ningún ALTER de tablas existentes.**
- `supabase/diagnostico_crons_y_jornadas_abiertas.sql` — ya no urge; su pregunta principal quedó respondida (el cron vive), pero sirve para confirmar la lista de `cron.job`.
- ⛔ `supabase/recuperar_jornadas_sin_cerrar.sql` — **NO CORRER.** Ver §7.

### 🟢 Trabajo de app en curso

Al cerrar esta sesión había **dos subagentes trabajando**, retomados tras cortarse. Hay que verificar en qué quedaron antes de seguir:

**A) Servicio de Maquinaria** — sobre `src/screens/MantenimientoMaquinariaScreen.tsx`:
- Quitar por completo el apartado de **"enviado a reparar"** del módulo Servicio (pestaña `'reparacion'`, modal de "Elige la máquina a reparar", modal de retorno, avisos de "en reparación"). Pedido textual: *"ese apartado de enviado a reparar no va"*.
- Agregar **"➕ Registrar avería"** y edición de avería pendiente, para usuarios con permiso de escritura.

**B) Compras — cuentas por pagar y cuentas por cobrar** (pedido textual: *"en compras hay que hacer el apartado o una forma de cuentas por pagar y cuentas por cobrar"*, sin más detalle):
- `supabase/cuentas_por_pagar_y_cobrar.sql` (solo CREATE, con RLS y bloque de deshacer)
- `src/screens/CuentasScreen.tsx` con pestañas "💸 Por pagar" y "💰 Por cobrar", buscador, totales, alta/edición/marcar pagada
- Registro del módulo cerrado + sección en el manual

### ⚙️ Detalle de arquitectura

`src/screens/MantenimientoMaquinariaScreen.tsx` (1.530 líneas) sirve **dos módulos** con una sola pantalla, vía la prop `seccion`:

- `seccion="mantenimiento"` → preventivo, por horómetro
- `seccion="servicio"` → correctivo, averías (lo envuelve `ServicioMaquinariaScreen.tsx`)

Dentro hay `const esServicio = seccion === 'servicio'`. La frontera de datos es `machinery_repairs.tipo` (`'correctivo'` en Servicio, `'preventivo'` en Mantenimiento). **Cualquier corte tiene que ir condicionado por `esServicio`, nunca borrado a secas**, o se rompe el otro módulo.

### Otro pendiente sin definir

`recuperar_jornadas_sin_cerrar.sql` existe en `dev` pero **falta en `main`** (se lo llevó el `git revert 672ad4ce`). Reponerlo en el próximo cherry-pick a producción.

---

## 9. Acceso a Supabase — situación real

Proyecto Supabase: ref **`ddcwqmuqdqnsrtpticpx`**.

El `.mcp.json` (idéntico en la carpeta externa y en la interna) es:

```json
{ "mcpServers": { "supabase": {
  "type": "http",
  "url": "https://mcp.supabase.com/mcp?project_ref=ddcwqmuqdqnsrtpticpx&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching"
}}}
```

Es **OAuth y sin token guardado**. El panel lo muestra "activo y en ejecución" porque el proceso conecta, pero **las herramientas quedan bloqueadas** hasta que alguien complete el login desde una sesión interactiva (`/mcp`). Una sesión no interactiva no puede hacerlo. En toda esta sesión **nunca estuvo disponible**, así que todo el trabajo de base se entregó como archivos `.sql` para correr a mano.

### Alternativa que sí funciona: leer por REST con la anon key

El `.env` de la carpeta interna tiene `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Con eso se puede **diagnosticar en solo lectura** desde node:

- **Legibles por anon**: `machine_rounds`, `machine_work_segments`. Alcanza para auditar jornadas, horas y cierres automáticos.
- **Bloqueadas por RLS** (devuelven `200 []`): `machinery`, `machine_inspectors`, `companies`, `machinery_repairs`, `profiles`. O sea que no se obtienen nombres de inspector ni códigos de máquina, solo `machinery_id`.

Dos trampas al escribir ese script:

1. **No declarar `const URL = ...`** — shadowea el `URL` global y `fetch` falla con "Failed to parse URL".
2. Los valores del `.env` traen `\r` (CRLF) y a veces comillas: hay que `.trim()` y quitar comillas.

Truco: consultar `machine_work_segments?source=eq.auto_close` agrupado por `round_date` **prueba si el cron `auto-close-jornadas` está vivo** sin necesidad de ver `cron.job`.

> Nota de seguridad que vale la pena revisar con calma: la anon key va embebida en el bundle web, así que es pública. Que `machine_rounds` y `machine_work_segments` sean legibles por anon significa que **cualquiera con la URL del sitio puede leer esas dos tablas**. Puede ser intencional, pero conviene confirmarlo.

---

## 10. Errores ya cometidos — para no repetirlos

| Error | Qué pasó | Cómo se evita |
|---|---|---|
| **`code` como identidad** | 5 filas "OXICORTE" aparecían sin marcar mientras el contador decía 16. Llaves duplicadas de React y selección cruzada. | Usar siempre `id`, nunca `code`. |
| **Backticks dentro de un template literal** | Un comentario CSS con backticks dentro de un `` ` `` de JS reventó el archivo con una cascada de TS1005. | No meter backticks en literales de plantilla. |
| **`.replace()` de node reemplaza solo la primera** | Al renombrar un parámetro quedó una segunda ocurrencia viva → TS2304. | Usar `Edit` con `replace_all`, o revisar todas las apariciones. |
| **Editar estando en `main`** | Se escribieron cambios en la rama equivocada. | `git rev-parse --abbrev-ref HEAD` antes de editar. Si ya pasó: `git stash push -- <archivo>`, `checkout dev`, `stash pop`. |
| **Secuenciador de cherry-pick trabado** | `git cherry-pick A B` se detuvo porque A ya estaba aplicado, y quedó `.git/sequencer`. | `git cherry-pick --quit` y volver a hacerlo solo con el commit que falta. |
| **Push rechazado (non-fast-forward)** | La compañera había empujado. | Nunca forzar. Rama de respaldo → `reset --hard origin/dev` → `git checkout <respaldo> -- <archivos>`. |
| **404 en `soslaguaira.com/version.json`** | El dominio sin `www` redirige con 301. | `curl -L` contra `www.soslaguaira.com`. |
| **Inferencia sin verificar** | Se afirmó que una diferencia de exactamente 102,00 h "descartaba" el cálculo en vivo. Falso: como todas las máquinas comparten el ancla de las 7am, las horas en vivo dan múltiplos limpios. | No usar la redondez de un número como prueba. |
| **Reescribir archivos con Python en Windows** | Ensucia el diff entero por CRLF. | Usar las herramientas de edición, no scripts de reescritura. |
| **PDFs con msedge headless** | La ruta `file://` necesita `C:` explícito o falla en silencio. | Siempre ruta absoluta con letra de unidad. |

---

## 11. Archivos clave

```
src/lib/hours.ts                  Fórmula única de horas (horasTurnoDelDia, MIN_WORKED_HOURS)
src/lib/inspectorReport.ts        Reporte del teléfono del inspector — lleva el guardia esDiaDeHoy
src/lib/colaOfflinePolicy.ts      Decisión compartida de las colas offline (éxito/reintentar/cuarentena)
src/lib/viajesOfflineQueue.ts     Cola de viajes de listeros, con cuarentena
src/lib/caracasDay.ts             caracasBusinessToday() y utilidades de día hábil
src/lib/permissions.ts            Módulos y niveles de permiso
src/lib/horometroAlertas.ts       Alertas de horómetro
src/navigation/index.tsx          Registro de pantallas
src/screens/EquiposScreen.tsx     Catálogo + reporte de maquinaria (selección, marca/modelo)
src/screens/MantenimientoMaquinariaScreen.tsx   Mantenimiento Y Servicio (prop `seccion`)
src/screens/ServicioMaquinariaScreen.tsx        Envoltorio de 19 líneas del anterior
src/screens/ObrasPublicasAsignacionScreen.tsx   Panel de asignación (nuevo)
src/screens/ComprasScreen.tsx     Compras (708 líneas) — base para cuentas por pagar/cobrar
src/screens/MoreScreen.tsx        Menú de módulos
src/screens/ManualScreen.tsx      Manual dentro de la app
docs/MANUAL-USUARIO.md            Manual — hay que actualizarlo con cada cambio
supabase/                         130 archivos .sql; editarlos NO los aplica
scripts/test-*.mjs                Los 4 tests
```

---

## 12. Cómo arrancar el chat nuevo

Pídele al asistente que, antes de tocar nada:

1. `git fetch --all --prune` y revise si la compañera empujó algo.
2. Confirme en qué rama está y que el árbol esté limpio.
3. Revise el estado de los dos trabajos en curso (Servicio y Compras) antes de rehacerlos.
4. Empuje `eb2d3880` a `origin/dev`, que está pendiente.
5. Lea este documento entero antes de proponer un plan.
