# Centro de Operaciones — Fase 1: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo aislado «🏭 Centro de Operaciones»: sitios, flota (catálogo + propias), registro de entradas/internos/salidas y tres papeles PDF con todas sus opciones, sin escribir ni ser leído por ningún otro módulo.

**Architecture:** Cuatro capas. (1) Librería pura de cálculo `centroOperaciones.ts` sin React ni Supabase. (2) Librería pura de papeles `centroOperacionesPapel.ts` que arma el HTML. (3) Capa de datos `centroOperacionesDb.ts`, la única que toca Supabase y solo en tablas `cop_*`. (4) Pantalla con cinco pestañas, una por componente en `src/components/centroOperaciones/`. Las tablas, la RLS y el cambio en `module_level` se corren por MCP y **no van al git**.

**Tech Stack:** Expo / React Native + web, TypeScript, Supabase (Postgres + RLS), `pdfDocument`/`exportPdf` (`src/lib/pdf.ts`), `buildXlsx` (`src/lib/xlsx.ts`), pruebas `.mjs` con `typescript.transpileModule` (patrón de `scripts/test-reporte-personalizado.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-23-centro-operaciones-design.md`

## Global Constraints

- Todo en español (UI, mensajes, manuales, comentarios).
- Worktree `C:\Users\USUARIO\Desktop\proyect\Control-de-Combustible-main\wt-registro-cdt`, rama `feature/centro-operaciones` (sale de `origin/dev`). La copia principal tiene trabajo ajeno sin guardar: no se toca.
- **Ningún `.sql` al git**, ni datos reales (empresas, placas, cifras de los papeles de ejemplo) en código o pruebas: cifras y nombres sintéticos.
- Clave de módulo `centro_operaciones`; etiqueta «Centro de Operaciones»; icono 🏭; ruta `CentroOperaciones`; enlace web `centro-operaciones`; prefijo de tablas `cop_`.
- Archivos del módulo: `src/lib/centroOperaciones.ts`, `src/lib/centroOperacionesPapel.ts`, `src/lib/centroOperacionesDb.ts`, `src/screens/CentroOperacionesScreen.tsx`, `src/components/centroOperaciones/*`. Solo ellos escriben (y solo en `cop_*`); ningún `rpc`.
- Fuera del módulo, `cop_` solo puede aparecer en `src/types/database.ts`, `src/lib/auditModulos.ts` y `scripts/test-auditoria-modulos.mjs`.
- Fecha de jornada de 7am a 7am; «hoy» por defecto = `caracasBusinessToday()` (`src/lib/caracasDay.ts`).
- Números escritos a mano se leen con `leerNumero` (`src/lib/numeros.ts`); listados A→Z con `cmpText` (`src/lib/text.ts`); cifras impresas con `toLocaleString('es-VE')`.
- Papeles: lo oculto no deja rastro; opciones y filtros **no** se imprimen (van a `nombreArchivoCop`); membrete neutro; logos por defecto `{ golden: true, bcv: false, sos: false, renace: false, jhenzaen: false }`; `marcaTexto: false`.
- Toda escritura termina en `.select('id')` y se trata 0 filas como fallo (la RLS rechaza sin error).
- Manuales al día: `docs/MANUAL-USUARIO.md` y `src/screens/ManualScreen.tsx`.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antes de cada commit: `git status --short` y `git show --stat HEAD` después; nada de `git add -A`.

## Review Focus

1. **Texto del usuario con `<`, `>`, `&` o comillas** (observaciones, listas, títulos): el papel debe mostrarlo literal, nunca como HTML. → prueba en Task 2.
2. **Cifras escritas con coma o con miles** («12,34», «4.321,09», campo vacío): se leen bien y vacío es «sin dato», no 0. → prueba en Task 1.
3. **Período sin ningún registro**: los tres papeles salen con ceros y la leyenda «Sin registros en el período», sin dividir entre cero. → pruebas en Tasks 1 y 2.
4. **Una unidad dada de baja o un renglón sin unidad vinculada**: sus renglones siguen saliendo con su texto congelado en el corte y en el listado. → prueba en Task 1.
5. **El mismo nombre escrito distinto** («Transportista A» y « transportista a »): agrupa en una sola fila, mostrando la primera forma escrita. → prueba en Task 1.

---

### Task 0: Preparar el worktree

**Files:** ninguno del repositorio.

- [ ] **Step 1:** Enlazar las dependencias de la copia principal sin copiarlas:
  `cmd //c mklink /J node_modules ..\Control-de-Combustible-main\node_modules` (desde el worktree).
- [ ] **Step 2:** `git status --short` → no debe aparecer `node_modules`. Si aparece, agregar `node_modules` a `.git/info/exclude` del worktree (no al `.gitignore`).
- [ ] **Step 3:** Línea base: `npx tsc --noEmit -p .` y `for f in scripts/test-*.mjs; do node "$f" >/dev/null 2>&1 || echo "FALLA $f"; done`. Anotar las fallas previas (si hay) para no atribuírselas al módulo.

### Task 1: Librería pura de cálculo

**Files:**
- Create: `src/lib/centroOperaciones.ts`
- Test: `scripts/test-centro-operaciones.mjs` (se crea aquí; las tareas siguientes le agregan bloques)

**Interfaces:**
- Consumes: `cmpText`, `norm` (`./text`); nada más.
- Produces:
  - `type TipoMov = 'entrada' | 'interno' | 'salida' | 'otro'`
  - `type EstadoMov = 'confirmado' | 'por_confirmar' | 'esperando_pesaje'`
  - `type ClaseLista = 'transportista' | 'origen' | 'destino' | 'material' | 'terraza'`
  - `type Movimiento = { id: string; sitioId: string; fecha: string; hora: string | null; tipo: TipoMov; unidadId: string | null; unidadTexto: string; placa: string | null; transportista: string | null; transportistaId: string | null; origen: string | null; origenId: string | null; destino: string | null; destinoId: string | null; material: string | null; materialId: string | null; capacidadM3: number | null; viajes: number | null; toneladas: number | null; m3: number | null; estado: EstadoMov; observacion: string | null; creadoPor: string | null; creadoAt: string | null; editadoPor: string | null; editadoAt: string | null }`
  - `type Unidad = { id: string; sitioId: string; origen: 'catalogo' | 'propia'; machineryId: string | null; codigo: string; descripcion: string | null; placa: string | null; serial: string | null; marca: string | null; modelo: string | null; dueno: string | null; capacidadM3: number | null; activo: boolean; nota: string | null }`
  - `type Sitio = { id: string; nombre: string; nota: string | null; activo: boolean; ubicacionId: string | null }`
  - `type ItemLista = { id: string; sitioId: string | null; clase: ClaseLista; nombre: string; activo: boolean }`
  - `type RangoCop = { desde: string; hasta: string; corteHora?: string | null }`
  - `type FiltrosCop = { tipos?: TipoMov[]; unidadIds?: string[]; transportistas?: string[]; origenes?: string[]; destinos?: string[]; materiales?: string[]; estados?: EstadoMov[]; texto?: string }`
  - `numeroDeCampo(txt: string): number | null`
  - `momentoReal(fecha: string, hora: string | null): string | null` → `'YYYY-MM-DDTHH:MM'`
  - `enRango(m: Movimiento, r: RangoCop): boolean`
  - `m3De(m: Movimiento): number | null`
  - `filtrarMovimientos(movs: Movimiento[], r: RangoCop, f?: FiltrosCop): Movimiento[]`
  - `type Totales = { viajes: number; toneladas: number; m3: number; promedioTonViaje: number | null; pendientesSinNumero: number; porConfirmarViajes: number; renglones: number }`
  - `totalesDe(movs: Movimiento[]): Totales`
  - `textoViajes(t: Totales): string`
  - `type FilaTabla = { clave: string; viajes: number; pct: number; toneladas: number; m3: number }`
  - `tablaPor(movs: Movimiento[], eje: 'transportista' | 'origen' | 'destino' | 'material' | 'unidad', orden: 'cantidad' | 'az', unidadDe?: (m: Movimiento) => string): FilaTabla[]` (`unidadDe` = `unidadDeLosRenglones(base)`, armada UNA vez con la lista base, antes de filtrar)
  - `type ModeloConsolidado = { totales: Totales; porTransportista: FilaTabla[]; porOrigen: FilaTabla[]; internos: { origen: string; destino: string; capacidadM3: number | null; viajes: number; m3: number }[]; salidas: { material: string; destino: string; capacidadM3: number | null; estado: EstadoMov; viajes: number; toneladas: number; m3: number }[]; textoSalidas: string[]; vacio: boolean }`
  - `consolidadoSitio(movs: Movimiento[], orden: 'cantidad' | 'az'): ModeloConsolidado` (recibe ya filtrado)
  - `type FilaDiaCorte = { fecha: string; internos: number; salidas: Record<string, number>; pendiente: boolean; pendienteInternos: PendientesCop; pendienteSalidas: PendientesCop; observaciones: string[] }` (`PendientesCop = { pendientesSinNumero: number; porConfirmarViajes: number }`)
  - `type ModeloCorte = { unidad: string; placa: string | null; destinos: string[]; dias: FilaDiaCorte[]; totales: { internos: number; salidas: number; total: number; pendientesSinNumero: number; porConfirmarViajes: number }; diasEvaluados: number; vacio: boolean }`
  - `cortePorUnidad(movs: Movimiento[], r: RangoCop, claveUnidad: string, op: { columnasPorDestino: boolean; diasSinAnotacion: 'cero' | 'ocultar'; unidadDe?: (m: Movimiento) => string }, ficha?: { unidad: string; placa: string | null }): ModeloCorte` (`claveUnidad` = una clave de `unidadDeLosRenglones(base)`, no la de `claveUnidadDe`; `op.unidadDe` = esa misma regla armada UNA vez con la lista base, la que reciben `tablaPor` y `cuerpoListado`; `ficha` = la de la flota, para el encabezado)
  - `claveUnidadDe(m: Movimiento): string` (= `unidadId` o, si falta, `norm(placa || unidadTexto)`; es la clave PROPIA del renglón, no la de pertenencia)

- [ ] **Step 1: Escribir las pruebas que fallan** en `scripts/test-centro-operaciones.mjs` (cargador `loadTs` copiado de `scripts/test-reporte-personalizado.mjs`). Fixture sintético `MOVS`: 3 transportistas («Transportista A» 5 viajes/115,5 t, «Transportista B» 3 viajes/66 t, « transportista a » 1 viaje/23 t), 2 internos («Terraza 1»→«Terraza 2», 18 m³, 4 y 2 viajes), salidas («Triturado» → «Destino X»: 2 viajes de 18 m³ y 3 de 24 m³; «Acero» → «Destino Y», 1 viaje de 24 m³, `esperando_pesaje`), y para la unidad «U-1»: internos 06→08 (5, 0, 3), salida a «Destino Z» el 07 (2), un `por_confirmar` sin viajes el 08 y un `por_confirmar` con 4 viajes el 09.
  - `numeroDeCampo('12,34') === 12.34`, `numeroDeCampo('4.321,09') === 4321.09`, `numeroDeCampo('  ') === null`.
  - `momentoReal('2026-10-22', '06:30') === '2026-10-23T06:30'`; `momentoReal('2026-10-22', '18:00') === '2026-10-22T18:00'`; `momentoReal('2026-10-22', null) === null`.
  - Corte `{ desde: '2026-10-20', hasta: '2026-10-22', corteHora: '18:30' }`: fecha 22 hora `'18:00'` entra; fecha 22 hora `'19:00'` no entra; fecha 22 hora `'06:00'` **no** entra (es el 23 a las 6); fecha 22 sin hora entra; fecha 23 no entra.
  - `m3De` = `m3` si existe; si no, `viajes × capacidadM3`; si falta uno, `null`.
  - `tablaPor(MOVS entrada, 'transportista', 'cantidad')`: 2 filas; la primera `{ clave: 'Transportista A', viajes: 6, toneladas: 138.5 }`; `pct` suma 100 ± 0,1.
  - `totalesDe` de las entradas: `viajes 9`, `toneladas 204.5`, `promedioTonViaje ≈ 22.72`.
  - `textoViajes` del corte de U-1 para salidas: con un pendiente sin número y uno con 4 → `'2 (+1 pendiente, +4 por confirmar)'`; solo el sin número → `'2 (+1 pendiente)'`.
  - `consolidadoSitio`: `textoSalidas[0]` menciona `5 viajes` y `108 m³` del triturado (2×18 + 3×24); el acero sale con estado `esperando_pesaje` y queda fuera del promedio.
  - `cortePorUnidad` de U-1 del 06 al 09, `columnasPorDestino: true`, `diasSinAnotacion: 'cero'`: 4 días, `diasEvaluados 4`, `destinos ['Destino Z']`, el 08 `pendiente: true`, `totales.internos 8`.
  - Review Focus 4: un renglón de U-1 con `unidadId: null` y la misma placa entra en el mismo corte (lo decide `unidadDeLosRenglones`); un renglón con `unidadTexto` y unidad dada de baja sigue apareciendo.
  - Review Focus 3: `consolidadoSitio([], 'cantidad').vacio === true`, `promedioTonViaje === null`, sin `NaN` en ningún campo.
- [ ] **Step 2:** `node scripts/test-centro-operaciones.mjs` → falla porque el archivo no existe.
- [ ] **Step 3: Implementar** las firmas de arriba en `src/lib/centroOperaciones.ts`. Agrupar por `norm(texto)` y mostrar la primera forma escrita; redondear toneladas y m³ a 2 decimales al final, no por renglón; `pct` a 1 decimal. Un renglón `por_confirmar` nunca suma a `viajes`/`toneladas`/`m3`; `esperando_pesaje` suma viajes y m³, no entra al promedio.
- [ ] **Step 4:** `node scripts/test-centro-operaciones.mjs` → todo ✅.
- [ ] **Step 5:** Commit `feat(centro-operaciones): librería de cálculo pura`.

### Task 2: Papeles (HTML)

**Files:**
- Create: `src/lib/centroOperacionesPapel.ts`
- Test: `scripts/test-centro-operaciones.mjs` (bloque nuevo)

**Interfaces:**
- Consumes: todo lo de Task 1; `aplicarEdicionResumen`, `type EdicionResumen`, `type ResumenFrentes` (`./frentesReporte`).
- Produces:
  - `type SeccionConsolidado = 'presentacion' | 'tarjetas' | 'transportistas' | 'internos' | 'salidas' | 'origenes' | 'textoSalidas'`
  - `type ColumnaCop = 'pct' | 'toneladas' | 'm3' | 'placa' | 'transportista' | 'observaciones' | 'capacidad' | 'estado'`
  - `type OpcionesPapelCop = { titulo: string; subtitulo: string; presentacion: string; consideraciones: string; emitida: string; ocultosSecciones: string[]; ocultosColumnas: ColumnaCop[]; orden: 'cantidad' | 'az'; columnasPorDestino: boolean; diasSinAnotacion: 'cero' | 'ocultar'; agruparListado: 'dia' | 'unidad' | 'tipo'; logos: { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean } }`
  - `OPCIONES_PAPEL_POR_DEFECTO: OpcionesPapelCop` (logos de Global Constraints; nada oculto; `orden: 'cantidad'`; `columnasPorDestino: true`; `diasSinAnotacion: 'cero'`; `agruparListado: 'dia'`)
  - `resumenConsolidado(m: ModeloConsolidado): ResumenFrentes` (claves estables `viajes`, `toneladas`, `promedio`)
  - `cuerpoConsolidado(m: ModeloConsolidado, op: OpcionesPapelCop, ed: EdicionResumen | null, cabecera: { sitio: string; corte: string }): string`
  - `cuerpoCorte(c: ModeloCorte, op: OpcionesPapelCop, ed: EdicionResumen | null, periodo: string): string`
  - `cuerpoListado(movs: Movimiento[], op: OpcionesPapelCop, unidadDe?: (m: Movimiento) => string): string` (`unidadDe` = `unidadDeLosRenglones(base)`, la misma que recibe el corte)
  - `nombreArchivoCop(papel: 'consolidado' | 'corte' | 'listado', sitio: string, r: RangoCop, op: OpcionesPapelCop, filtros?: FiltrosCop): string`
  - `CSS_COP: string`
  - `escaparHtml(s: unknown): string`

- [ ] **Step 1: Pruebas que fallan:**
  - Con `ocultosSecciones: ['transportistas']`, el HTML no contiene el título «Recepción por empresa transportista» ni el nombre de ningún transportista; con `ocultosColumnas: ['pct']`, no contiene `%` ni «Participación».
  - `nombreArchivoCop('consolidado', 'Sitio 1', r, opConOcultos)` contiene «sin transportistas» y «sin %»; con opciones por defecto no contiene «sin ».
  - Ningún papel contiene `\\rightarrow` ni `$`; el interno se imprime `Terraza 1 → Terraza 2`.
  - Review Focus 1: una observación `'<b>x</b> & "y"'` aparece como `&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;` y nunca como `<b>x</b>`.
  - Review Focus 3: `cuerpoConsolidado` de un modelo vacío contiene «Sin registros en el período» y ninguna `NaN`.
  - El corte imprime `'2 (+1 pendiente)'` en la tarjeta de salidas cuando corresponde, y la celda del día pendiente dice «Por confirmar».
  - El subtítulo nunca nombra opciones ni filtros (no contiene «sin », «solo », «filtrado»).
- [ ] **Step 2:** correr → falla.
- [ ] **Step 3: Implementar.** Todo texto variable pasa por `escaparHtml`. Las secciones y columnas ocultas no se generan (ni encabezado vacío). Tablas con `page-break-inside: avoid` en filas y sin `div` vacío al final (para no dejar página en blanco). La fila de totales dice `100 %`.
- [ ] **Step 4:** correr → ✅.
- [ ] **Step 5:** Commit `feat(centro-operaciones): papeles consolidado, corte y listado`.

### Task 3: Base de datos (por MCP, fuera del git)

**Files:**
- Modify: `src/types/database.ts` (tipos `Row`/`Insert`/`Update` de las cinco tablas)

> Requiere el permiso del cliente, pedido en texto, antes de correr el DDL (es estructural y toca `module_level`).

- [ ] **Step 1:** Leer el cuerpo vigente: `select pg_get_functiondef('public.module_level(text)'::regprocedure)`.
- [ ] **Step 2:** Crear por MCP (`apply_migration`, nombre `centro_operaciones_fase1`) las tablas de la sección 7 del spec con estas restricciones: checks de `tipo`, `estado`, `origen` y `clase`; `viajes >= 0`, `toneladas >= 0`, `m3 >= 0`, `capacidad_m3 > 0`; `fecha` not null; únicos parciales `cop_sitios(lower(nombre)) where activo`, `cop_unidades(sitio_id, machinery_id) where activo and machinery_id is not null`, `cop_listas(coalesce(sitio_id::text,''), clase, lower(nombre)) where activo`, `cop_ajustes(coalesce(sitio_id::text,''), clave)`; FKs solo entre `cop_*` (`cop_movimientos.unidad_id → cop_unidades on delete set null`, `*_lista_id → cop_listas on delete set null`, `sitio_id → cop_sitios on delete restrict`); índices de 7.3. Trigger de sello `before insert or update` en las cinco (`created_by = auth.uid()`, `created_by_nombre` y `updated_by_nombre` desde `profiles`, `updated_at = now()`), con `set search_path to 'public'`. `create trigger trg_audit … execute function audit_row()` en las cinco (copiar la forma de `horometro_cambios`).
- [ ] **Step 3:** RLS: `enable row level security`; por tabla cuatro políticas `to authenticated`: `<t>_select` (`(select module_level('centro_operaciones')) <> 'none'`), `<t>_insert` y `<t>_update` (`in ('escritura','full')`), `<t>_delete` (`= 'full'`). `revoke all on <t> from anon`.
- [ ] **Step 4:** `create or replace function public.module_level` con el cuerpo leído en el Step 1 y `'centro_operaciones'` agregado a la lista del `case`.
- [ ] **Step 5: Verificar** dentro de `begin … rollback`, suplantando (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`): un usuario con rol fijo y sin fila del módulo → `select` devuelve 0 filas e `insert` falla; un admin → `insert … returning id` devuelve 1 fila y `created_by_nombre` viene lleno; `anon` → permiso denegado. `select module_level('viajes_camiones')` para un usuario cualquiera da lo mismo que antes del cambio.
- [ ] **Step 6:** `get_advisors` (security) sin avisos nuevos sobre `cop_*`.
- [ ] **Step 7:** Actualizar `src/types/database.ts`; `npx tsc --noEmit -p .` limpio. Commit `feat(centro-operaciones): tipos de las tablas cop_*` (sin ningún `.sql`).

### Task 4: Capa de datos

**Files:**
- Create: `src/lib/centroOperacionesDb.ts`
- Test: `scripts/test-centro-operaciones.mjs` (bloque nuevo)

**Interfaces:**
- Consumes: tipos de Task 1; `supabase`, `selectAllRows` (`./supabase`).
- Produces (todas `async`, lanzan `Error` con mensaje en español si falla o si 0 filas):
  - `filaAMovimiento(r: any): Movimiento`, `movimientoAFila(m: Partial<Movimiento>): Record<string, unknown>` (puras, sin columnas de sello)
  - `cargarSitios(): Promise<Sitio[]>`, `guardarSitio(s: Partial<Sitio>): Promise<string>`
  - `cargarUnidades(sitioId: string): Promise<Unidad[]>`, `guardarUnidad(u: Partial<Unidad>): Promise<string>`
  - `cargarListas(sitioId: string): Promise<ItemLista[]>`, `guardarItemLista(i: Partial<ItemLista>): Promise<string>`
  - `cargarAjustes(sitioId: string | null): Promise<Record<string, unknown>>`, `guardarAjuste(sitioId: string | null, clave: string, valor: unknown): Promise<void>`
  - `cargarMovimientos(sitioId: string, desde: string, hasta: string): Promise<Movimiento[]>`
  - `guardarMovimiento(m: Partial<Movimiento>): Promise<string>`, `borrarMovimiento(id: string): Promise<void>`, `vincularUnidad(ids: string[], unidadId: string): Promise<number>`
  - `sugerenciasDelSistema(): Promise<{ maquinas: { id: string; codigo: string; placa: string | null; serial: string | null; marca: string | null; modelo: string | null; empresa: string | null; descripcion: string | null }[]; frentes: string[]; obras: { id: string; nombre: string }[] }>` — lee `machinery` (+ `companies`), `viaje_frentes`, `ubicaciones_obra`; cada lectura con `.catch(() => [])`.

- [ ] **Step 1: Pruebas que fallan:** ida y vuelta `filaAMovimiento(movimientoAFila(m))` conserva todos los campos de `Movimiento` salvo los de sello; candado ⭐ estático sobre el texto de `centroOperacionesDb.ts`: cada `.from('…')` seguido de `insert|update|upsert|delete` nombra una tabla que empieza con `cop_`; no aparece `.rpc(`; las únicas tablas ajenas en `.from(` son `machinery`, `companies`, `viaje_frentes`, `ubicaciones_obra`, y solo con `.select(`.
- [ ] **Step 2:** correr → falla.
- [ ] **Step 3: Implementar.** Toda escritura con `.select('id')`; 0 filas → `throw new Error('No se guardó: no tienes permiso o se perdió la conexión.')`. `cargarMovimientos` con `selectAllRows` ordenado por `fecha, hora, created_at`.
- [ ] **Step 4:** correr → ✅.
- [ ] **Step 5:** Commit `feat(centro-operaciones): acceso a datos solo en tablas cop_*`.

### Task 5: Permiso, menú, navegación, auditoría y esqueleto de pantalla

**Files:**
- Modify: `src/lib/permissions.ts` (entrada en `MODULES` en orden; `'centro_operaciones'` en la condición de `defaultLevel` que devuelve `'none'`)
- Modify: `src/screens/MoreScreen.tsx` (item `{ label: 'Centro de Operaciones', route: 'CentroOperaciones', desc: 'Sitios, flota, entradas, movimientos y salidas, con sus reportes', icon: '🏭', module: 'centro_operaciones' }` en una sola línea, como las demás)
- Modify: `src/navigation/index.tsx` (`Stack.Screen name="CentroOperaciones"` junto a las demás del árbol con «Más»; `CentroOperaciones: 'centro-operaciones'` en el linking)
- Modify: `src/lib/auditModulos.ts` (sección `{ key: 'centro_operaciones', label: 'Centro de Operaciones', icon: '🏭' }` en orden alfabético; las cinco tablas `cop_*` → `'centro_operaciones'`; `export const AUDITADAS_FUERA_DEL_GIT = ['cop_sitios', 'cop_unidades', 'cop_movimientos', 'cop_listas', 'cop_ajustes']` con comentario de la fecha de verificación)
- Modify: `scripts/test-auditoria-modulos.mjs` (`centro_operaciones: 'centro_operaciones'` en `MENU_A_MODULO`; el conjunto `auditadas` suma `AUDITADAS_FUERA_DEL_GIT`)
- Create: `src/screens/CentroOperacionesScreen.tsx` (selector de sitio, oculto si hay uno solo; sin sitios: Full ve «Crea el primer sitio» y abre ⚙️, Lectura ve «Todavía no hay sitios»; pestañas ✍️ Cargar, 📋 Registros, 🚛 Flota, 📄 Reportes, ⚙️ Ajustes; cada pestaña por ahora un texto «En construcción»; Lectura no ve ✍️; ⚙️ y los botones de cambio de 🚛 solo con Full)

**Interfaces:**
- Consumes: `useAuth().moduleLevel('centro_operaciones')` y `levelMeets(have, need)` (`src/lib/permissions.ts`).
- Produces: `CentroOperacionesScreen` recibe `sitio: Sitio`, `nivel: PermLevel` y los pasa a cada pestaña como props `{ sitio, nivel }`.

- [ ] **Step 1:** Agregar al test del módulo el bloque de candados de aislamiento: (a) en `src/` y `scripts/`, fuera de los archivos del módulo y de la lista permitida de Global Constraints, ningún archivo contiene `cop_`; (b) ningún archivo del módulo contiene `.rpc(`; (c) `MoreScreen` y `permissions.ts` nombran `centro_operaciones`; `defaultLevel('centro_operaciones') === 'none'`.
- [ ] **Step 2:** correr el test del módulo y `node scripts/test-auditoria-modulos.mjs` → fallan.
- [ ] **Step 3:** Hacer los cambios de la lista **Files**.
- [ ] **Step 4:** Los dos tests ✅; `npx tsc --noEmit -p .` limpio; la suite completa sin fallas nuevas respecto de Task 0.
- [ ] **Step 5:** Commit `feat(centro-operaciones): permiso, menú, ruta y auditoría`.

### Task 6: Pestañas ⚙️ Ajustes y 🚛 Flota

**Files:**
- Create: `src/components/centroOperaciones/AjustesTab.tsx`, `src/components/centroOperaciones/FlotaTab.tsx`
- Modify: `src/screens/CentroOperacionesScreen.tsx` (montar las dos pestañas)

**Interfaces:**
- Consumes: Task 4 (`cargarSitios`, `guardarSitio`, `cargarListas`, `guardarItemLista`, `cargarAjustes`, `guardarAjuste`, `cargarUnidades`, `guardarUnidad`, `sugerenciasDelSistema`).
- Produces: nada nuevo para otras tareas; las listas las vuelve a leer cada pestaña al enfocarse.

- [ ] **Step 1:** Prueba estática en el test del módulo: `FlotaTab.tsx` y `AjustesTab.tsx` no importan `supabase` directo (solo `centroOperacionesDb`); `FlotaTab` ofrece «Del catálogo» y «Propia»; las unidades y sitios se desactivan (`activo: false`), nunca se borran (no llaman a ninguna función de borrar).
- [ ] **Step 2:** correr → falla.
- [ ] **Step 3: Implementar.** Ajustes: crear/renombrar/desactivar sitios; listas por clase (crear, renombrar, desactivar; A→Z); textos fijos `presentacion`, `consideraciones`, `titulo_consolidado`, `titulo_corte`, `logos` en `cop_ajustes` del sitio. Flota: lista A→Z con filtro por texto; «➕ Del catálogo» con buscador sobre `sugerenciasDelSistema().maquinas` por código, placa, serial y empresa (todo el catálogo), que copia los datos y queda editable; «🔄 Actualizar desde el catálogo» por unidad; «➕ Propia» con todos los campos de 7.2. Mensajes con `useToast`.
- [ ] **Step 4:** test ✅ y `tsc` limpio. Prueba manual en web (`npx expo start --web`): crear un sitio, una unidad del catálogo y una propia, desactivar una.
- [ ] **Step 5:** Commit `feat(centro-operaciones): sitios, listas, textos y flota`.

### Task 7: Pestañas ✍️ Cargar y 📋 Registros

**Files:**
- Create: `src/components/centroOperaciones/CargarTab.tsx`, `src/components/centroOperaciones/RegistrosTab.tsx`, `src/components/centroOperaciones/CampoSugerido.tsx` (texto libre con sugerencias de la lista del sitio y del sistema; devuelve `{ texto, listaId }`)
- Modify: `src/lib/centroOperaciones.ts` (agregar `sugerenciasOrigenDestino(tipo: TipoMov, listas: ItemLista[], frentes: string[]): { origen: string[]; destino: string[] }` y `unidadPorPlaca(placa: string, unidades: Unidad[]): Unidad | null`)
- Modify: `src/screens/CentroOperacionesScreen.tsx`

**Interfaces:**
- Consumes: Tasks 1 y 4; `DateField` (`../DateField`), `caracasBusinessToday`, `leerNumero` vía `numeroDeCampo`, `buildXlsx`.
- Produces: `CargarTab` acepta `movimientoAEditar?: Movimiento` (lo usa ✏️ de Registros).

- [ ] **Step 1: Pruebas que fallan** (lib): `sugerenciasOrigenDestino('entrada', …)` → origen = frentes + lista `origen`, destino = lista `terraza`; `'interno'` → terrazas en los dos; `'salida'` → origen terrazas, destino lista `destino`. `unidadPorPlaca(' a12-bc ', unidades)` encuentra la unidad activa con placa `A12BC` (normalizando espacios y guiones) e ignora las inactivas. Estático: `CargarTab` guarda un borrador con clave `cop_borrador_<sitioId>` dentro de `try/catch` y lo borra solo después de guardar con éxito.
- [ ] **Step 2:** correr → falla.
- [ ] **Step 3: Implementar.** Cargar: pastillas de tipo; fecha (defecto `caracasBusinessToday()`); hora opcional; unidad desde la flota o escrita (al escribir una placa que coincide con `unidadPorPlaca`, se vincula sola y lo muestra); `CampoSugerido` para transportista, origen, destino y material; capacidad (toma la de la unidad), viajes (defecto `'1'`), toneladas, m³ (muestra el calculado si se deja vacío), estado, observación. Validación: `viajes` obligatorio salvo `por_confirmar`. «Guardar» y «Guardar y otro» (conserva todo menos viajes, toneladas, m³ y observación). Debajo, lo del día con ✏️/🗑️. Registros: rango (pastillas hoy / semana / mes + desde–hasta con `DateField`), filtros de `FiltrosCop`, buscador, totales con `totalesDe` y `textoViajes`, ✏️ (abre Cargar con `movimientoAEditar`), 🗑️ solo Full con confirmación, selección múltiple + «Vincular a unidad», «📥 Excel» con `buildXlsx` (descarga en web como `downloadBytes` de `InventarioScreen`, copiada al componente).
- [ ] **Step 4:** test ✅, `tsc` limpio; prueba manual en web: cargar una entrada, «Guardar y otro», editar, borrar, exportar Excel.
- [ ] **Step 5:** Commit `feat(centro-operaciones): carga y registros`.

### Task 8: Pestaña 📄 Reportes

**Files:**
- Create: `src/components/centroOperaciones/ReportesTab.tsx`, `src/components/centroOperaciones/EditorResumen.tsx` (ocultar, renombrar, valor y nota por clave; hasta 6 tarjetas propias; mismo contrato `EdicionResumen`)
- Modify: `src/screens/CentroOperacionesScreen.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2 y 4; `Toggle` (`../CubicajeTab`), `DateField`, `pdfDocument`, `exportPdf`, `edicionAlCambiarDeDia`.

- [ ] **Step 1: Pruebas que fallan** (estáticas): `ReportesTab` llama a `pdfDocument` con `marcaTexto: false`, `logos` de las opciones y `emitida: emitidaCop(op)` (ya escapada: `pdfDocument` la pega tal cual, nunca `op.emitida` crudo); el nombre del PDF sale de `nombreArchivoCop`; las opciones se guardan en el equipo con clave `cop_opciones_<papel>` dentro de `try/catch`; al cambiar el rango se aplica `edicionAlCambiarDeDia`; el componente no contiene `insert`, `update`, `upsert`, `delete` ni `rpc` salvo `guardarAjuste` (el botón «Guardar como texto fijo»).
- [ ] **Step 2:** correr → falla.
- [ ] **Step 3: Implementar.** Pastillas de papel (Consolidado / Corte por unidad / Listado); rango con corte y hora; filtros; para el corte, elegir una o varias unidades (una hoja por unidad, separadas por salto de página); bloque «¿Qué se oculta?» con un `Toggle` por sección y por columna; logos; textos editables precargados desde `cop_ajustes` con «Guardar como texto fijo»; `EditorResumen`; orden y agrupación; vista previa con el aviso de lo apagado **solo en pantalla**; «📄 PDF» con `exportPdf(pdfDocument({...}), nombreArchivoCop(...))`.
- [ ] **Step 4:** test ✅, `tsc` limpio; prueba manual en web de los tres papeles con opciones apagadas.
- [ ] **Step 5:** Commit `feat(centro-operaciones): reportes con opciones`.

### Task 9: Manuales, verificación real y publicación

**Files:**
- Modify: `docs/MANUAL-USUARIO.md`, `src/screens/ManualScreen.tsx` (sección nueva «🏭 Centro de Operaciones»: para qué sirve, que no suma ni se cruza con Viajes, cada pestaña, los tres papeles y sus opciones, quién lo ve y cómo se le da el permiso)

- [ ] **Step 1:** Escribir las dos secciones de manual con el mismo contenido.
- [ ] **Step 2:** PDF real: generar los tres papeles con el fixture sintético a HTML en la carpeta temporal de la sesión y convertirlos con msedge headless (ruta `file:///C:/…`, ver la referencia de memoria); comprobar: sin página final en blanco, pie en su hoja, flechas `→`. Reproducir una vez **fuera del repositorio** las cifras reales de los dos papeles de ejemplo con un script en la carpeta temporal (las cifras viven solo ahí, nunca en el repositorio) y comprobar que cuadran.
- [ ] **Step 3:** `npx tsc --noEmit -p .` limpio y la suite completa sin fallas nuevas.
- [ ] **Step 4:** Commit `docs(centro-operaciones): manuales`. `git log --oneline origin/dev..HEAD` y `git show --stat` de cada commit: ningún `.sql`, ningún dato real, ningún archivo ajeno.
- [ ] **Step 5:** Merge a `dev` y push; cherry-pick de **solo** estos commits a `main`, `tsc` + suite otra vez en `main`, `git show --stat`, push. (El SQL de Task 3 ya está en producción antes de este paso.)
- [ ] **Step 6:** Quitar el enlace `node_modules` del worktree.
