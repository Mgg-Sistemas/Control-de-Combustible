# Servicio de Maquinaria — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para llevar la cuenta.

**Meta:** que el encargado del taller registre lo que se le hizo a cada máquina —interno o externo, con sus repuestos— y lo saque en PDF con la ficha técnica adelante y las reparaciones atrás.

**Arquitectura:** lógica pura en `src/lib/machineService.ts` (validación, armado y guardado con el cliente Supabase **inyectado**, que es lo que hace posible probar la frontera); el PDF como función pura en `src/lib/machineServiceReport.ts`; la pantalla como componente aparte (`ServicioRegistroTab.tsx`) para no engordar más las 1.697 líneas de `MantenimientoMaquinariaScreen.tsx`. Aparte, se cortan las 7 escrituras que hoy los módulos del taller hacen fuera de su territorio.

**Tecnologías:** Expo v56 · React Native · TypeScript · Supabase (PostgREST) · `expo-print` para el PDF · pruebas `.mjs` que transpilan el `.ts` en memoria.

**Spec:** [`docs/superpowers/specs/2026-08-18-servicio-maquinaria-design.md`](../specs/2026-08-18-servicio-maquinaria-design.md)

---

## Restricciones globales

Aplican a **todas** las tareas. No son sugerencias.

- **Este módulo NO lleva dinero.** Sin costos, sin pagos, sin autorizaciones. Decisión explícita del cliente.
- **No se modifica ningún registro existente.** Ni horas de jornada, ni cuadres de nómina, ni rondas. Prohibido todo `update`/`delete` sobre tablas que ya tienen datos.
- **La frontera:** los módulos de Servicio y Mantenimiento **leen todo, escriben solo en lo suyo**. Prohibido escribir en `machinery` o en `maintenance_requests` desde estos módulos. **Única excepción:** `machinery.horometro_base` y `horometro_maint_pending` (línea 402), que el cliente pidió conservar.
- **No se toca** el cálculo del estado «averiada» (los 12 lugares que leen `maintenance_requests` pendientes), ni Obras Públicas, ni el Inspector SOS.
- **Identidad de máquina:** todo lo que muestre o imprima una máquina usa `machineLabel()` de `src/lib/machineLabel.ts`; los nombres de archivo, `machineFileLabel()`. Nunca solo `code` — hay tres máquinas llamadas `RETROEXCAVADORA`.
- **GitFlow:** se trabaja en `feature/servicio-maquinaria` (ya creada desde `dev`). A `main` solo por cherry-pick, nunca merge.
- **Compatibilidad con la compañera:** en `package.json` se **agrega** el script nuevo y se conservan los suyos. Si hay conflicto, se quedan los dos.
- **Antes de declarar algo terminado:** `npx tsc --noEmit` limpio **y** las 11 suites en verde. Compilar no es probar.
- **El SQL** (`supabase/servicio_maquinaria.sql`) lo corre el cliente a mano. Editarlo no lo aplica.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/machineService.ts` | **Crear.** Tipos, validación, limpieza de repuestos y guardado. El cliente Supabase entra **como parámetro** — es lo que permite probar la frontera. |
| `src/lib/machineServiceReport.ts` | **Crear.** El PDF. Función pura: recibe datos ya cargados, no consulta Supabase. |
| `src/screens/ServicioRegistroTab.tsx` | **Crear.** La pestaña 🧾 Servicios: lista, formulario, filtros y botón de PDF. |
| `src/types/database.ts` | **Modificar.** Interfaces `MachineryServiceOrder` y `MachineryServicePart`; campos de lubricación en `Machinery`. |
| `src/screens/MantenimientoMaquinariaScreen.tsx` | **Modificar.** Monta la pestaña; se le quitan las 7 escrituras hacia afuera. |
| `src/screens/ControlMaquinariaScreen.tsx` | **Modificar.** Campos de lubricación en la ficha de la máquina. |
| `scripts/test-servicio.mjs` | **Crear.** Suite `test:servicio`. |
| `src/screens/ManualScreen.tsx` | **Modificar.** El módulo nuevo y el cambio de comportamiento. |
| `supabase/servicio_maquinaria.sql` | **Ya creado y commiteado.** Pendiente de correr. |

---

## Tarea 1 · La lógica pura y su blindaje

**Archivos:**
- Crear: `src/lib/machineService.ts`
- Crear: `scripts/test-servicio.mjs`
- Modificar: `package.json` (scripts `test:servicio` y `test:all`)

**Interfaces:**
- Consume: nada.
- Produce: `ServiceOrigen`, `Intervencion`, `INTERVENCION_LABEL`, `ESTADOS_REPUESTO`, `ServicePartInput`, `ServiceOrderInput`, `validarServicio()`, `limpiarRepuestos()`, `filaServicio()`, `quienLoHizo()`, `guardarServicio()`.

---

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `scripts/test-servicio.mjs`:

```js
/*
 * SERVICIO DE MAQUINARIA — el registro de lo que se le hizo a cada máquina.
 *
 * Blinda `src/lib/machineService.ts`. Lo más importante que se prueba acá es LA
 * FRONTERA: guardar un servicio NO puede escribir en `machinery` ni en
 * `maintenance_requests`. Es un pedido explícito del cliente (18-ago-2026): los
 * módulos del taller reciben los avisos pero no mueven el estado de las máquinas,
 * para que la acumulación de reportes pendientes no arrastre a la flota.
 *
 *   npm run test:servicio   (o: node scripts/test-servicio.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// machineService.ts es PURO (sin imports) → transpila y evalúa directo.
const src = fs.readFileSync(path.join(ROOT, 'src/lib/machineService.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const {
  validarServicio, limpiarRepuestos, filaServicio, quienLoHizo, guardarServicio,
  INTERVENCION_LABEL, ESTADOS_REPUESTO,
} = mod.exports;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

const BASE = {
  machineryId: 'maq-1', serviceDate: '2026-08-18', origen: 'interno',
  technician: 'José Pérez', workDone: 'Cambio de manguera',
};

console.log('SERVICIO DE MAQUINARIA\n');

// ── 1) ⭐ LA FRONTERA: guardar no toca nada de afuera ──────────────────────
{
  // Cliente Supabase falso que anota CADA tabla que alguien intenta tocar.
  const tocadas = [];
  const fakeDb = {
    from(tabla) {
      tocadas.push(tabla);
      return {
        insert: (rows) => ({
          select: () => ({
            single: async () => ({ data: { id: 'orden-1', ...(Array.isArray(rows) ? rows[0] : rows) }, error: null }),
          }),
          then: (res) => res({ error: null }),   // insert sin .select()
        }),
        update: () => { throw new Error(`PROHIBIDO: update sobre ${tabla}`); },
        delete: () => { throw new Error(`PROHIBIDO: delete sobre ${tabla}`); },
      };
    },
  };

  const r = await guardarServicio(fakeDb, { ...BASE, maintenanceRequestId: 'av-1' }, [
    { quantity: 2, description: 'Manguera 3/4"', estado: 'Nuevo' },
  ]);

  ok('⭐ guarda sin error', !r.error, r.error);
  ok('⭐ NO toca `machinery`', !tocadas.includes('machinery'), tocadas.join(', '));
  ok('⭐ NO toca `maintenance_requests`', !tocadas.includes('maintenance_requests'), tocadas.join(', '));
  ok('solo toca sus dos tablas',
    tocadas.every((t) => t === 'machinery_service_orders' || t === 'machinery_service_parts'),
    tocadas.join(', '));
  ok('enlazar una avería NO la modifica', !tocadas.includes('maintenance_requests'));
}

// ── 2) Sin repuestos no se toca la tabla de repuestos ─────────────────────
{
  const tocadas = [];
  const fakeDb = { from(t) { tocadas.push(t); return {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'o1' }, error: null }) }),
                     then: (res) => res({ error: null }) }) }; } };
  await guardarServicio(fakeDb, BASE, []);
  ok('sin repuestos → no inserta en machinery_service_parts',
    !tocadas.includes('machinery_service_parts'), tocadas.join(', '));
}

// ── 3) Validación ─────────────────────────────────────────────────────────
{
  ok('un servicio bien armado pasa', validarServicio(BASE) === null, String(validarServicio(BASE)));
  ok('sin máquina no pasa', validarServicio({ ...BASE, machineryId: '' }) !== null);
  ok('sin fecha no pasa', validarServicio({ ...BASE, serviceDate: '' }) !== null);
  ok('interno sin técnico no pasa', validarServicio({ ...BASE, technician: '' }) !== null);
  ok('interno con técnico pasa', validarServicio({ ...BASE, technician: 'Ana' }) === null);
  ok('externo sin proveedor no pasa',
    validarServicio({ ...BASE, origen: 'externo', technician: null, provider: '' }) !== null);
  ok('externo con proveedor pasa',
    validarServicio({ ...BASE, origen: 'externo', technician: null, provider: 'Taller Pérez' }) === null);
  ok('sin problema NI acciones no pasa (registro vacío no sirve)',
    validarServicio({ ...BASE, workDone: '', problem: '' }) !== null);
  ok('con problema pero sin acciones sí pasa',
    validarServicio({ ...BASE, workDone: '', problem: 'Manguera reventada' }) === null);
  ok('el error es texto en cristiano, no un código',
    typeof validarServicio({ ...BASE, machineryId: '' }) === 'string');
}

// ── 4) Repuestos: limpieza y orden ────────────────────────────────────────
{
  const limpios = limpiarRepuestos([
    { quantity: '2', description: 'Manguera 3/4"', estado: 'Nuevo' },
    { quantity: null, description: '   ', estado: 'Usado' },      // vacío → se descarta
    { quantity: 1, description: 'Filtro de aceite', estado: null },
  ]);
  ok('descarta los renglones sin descripción', limpios.length === 2, String(limpios.length));
  ok('conserva el orden de carga', limpios[0].position === 0 && limpios[1].position === 1);
  ok('la cantidad en texto se vuelve número', limpios[0].quantity === 2, String(limpios[0].quantity));
  ok('el segundo renglón es el filtro', limpios[1].description === 'Filtro de aceite');
  ok('sin repuestos devuelve lista vacía', limpiarRepuestos([]).length === 0);
  ok('diez renglones entran los diez',
    limpiarRepuestos(Array.from({ length: 10 }, (_, i) => ({ description: `R${i}` }))).length === 10);
}

// ── 5) La fila que se guarda ──────────────────────────────────────────────
{
  const fila = filaServicio({ ...BASE, intervenciones: ['mecanica', 'mangueras'], photos: ['u1'] });
  ok('intervenciones va como arreglo', Array.isArray(fila.intervenciones) && fila.intervenciones.length === 2);
  ok('sin intervenciones va arreglo vacío, no null',
    Array.isArray(filaServicio(BASE).intervenciones) && filaServicio(BASE).intervenciones.length === 0);
  ok('sin fotos va arreglo vacío, no null', Array.isArray(filaServicio(BASE).photos));
  ok('los textos vacíos se guardan como null, no como ""', filaServicio({ ...BASE, notes: '   ' }).notes === null);
  ok('sin avería enlazada va null', filaServicio(BASE).maintenance_request_id === null);
  ok('con avería enlazada la conserva',
    filaServicio({ ...BASE, maintenanceRequestId: 'av-9' }).maintenance_request_id === 'av-9');
  ok('la fila NO trae ningún campo de dinero',
    !Object.keys(fila).some((k) => /cost|price|amount|monto|pago/i.test(k)), Object.keys(fila).join(','));
}

// ── 6) Quién lo hizo, en una línea ────────────────────────────────────────
{
  ok('interno muestra al técnico',
    quienLoHizo({ origen: 'interno', technician: 'José Pérez' }).includes('José Pérez'));
  ok('externo muestra al taller',
    quienLoHizo({ origen: 'externo', provider: 'Taller Pérez' }).includes('Taller Pérez'));
  ok('interno y externo se distinguen a simple vista',
    quienLoHizo({ origen: 'interno', technician: 'X' }) !== quienLoHizo({ origen: 'externo', provider: 'X' }));
  ok('sin nombre no rompe ni dice "undefined"',
    !/undefined|null/.test(quienLoHizo({ origen: 'interno' })));
}

// ── 7) Las etiquetas del formulario de papel ──────────────────────────────
{
  ok('las cuatro intervenciones del formulario están',
    ['mecanica', 'electricidad', 'mangueras', 'servicio'].every((k) => !!INTERVENCION_LABEL[k]));
  ok('mangueras se muestra como en el papel',
    INTERVENCION_LABEL.mangueras === 'Mangueras / Hidráulica', INTERVENCION_LABEL.mangueras);
  ok('los estados de repuesto son cuatro', ESTADOS_REPUESTO.length === 4, ESTADOS_REPUESTO.join(','));
}

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nEl taller registra lo suyo y no mueve el estado de ninguna máquina.`);
```

- [ ] **Paso 2: Correr la prueba para verificar que falla**

```bash
node scripts/test-servicio.mjs
```

Esperado: **FALLA** con `ENOENT: no such file or directory ... src/lib/machineService.ts`.

- [ ] **Paso 3: Escribir la implementación mínima**

Crear `src/lib/machineService.ts`. **Sin imports** — es lo que permite transpilarlo suelto en la prueba.

```ts
// ============================================================================
// SERVICIO DE MAQUINARIA — el registro de lo que se le hizo a una máquina.
//
// Sigue el formulario en papel del cliente: datos generales, tipo de
// intervención, descripción del problema, acciones realizadas y repuestos.
//
// ⚠️ SIN DINERO. Este módulo no lleva costos, pagos ni autorizaciones —
//    decisión explícita del cliente (18-ago-2026).
//
// ⚠️ LA FRONTERA. `guardarServicio` recibe el cliente Supabase COMO PARÁMETRO,
//    no lo importa. No es un capricho: es lo que permite que
//    `scripts/test-servicio.mjs` le pase un cliente falso y compruebe que
//    guardar un servicio NO escribe en `machinery` ni en
//    `maintenance_requests`. Esa prueba es la razón de ser de este archivo.
//
//    Los módulos del taller reciben los avisos de avería pero no mueven el
//    estado de la flota: quien saca una máquina de averiada es el coordinador
//    por QR o Control de Maquinaria, que son los que de verdad la ven.
//
// Blindado por `scripts/test-servicio.mjs` (`npm run test:servicio`).
// ============================================================================

/** Quién hizo el trabajo: el equipo de la empresa, o alguien de afuera. */
export type ServiceOrigen = 'interno' | 'externo';

/** «2. Tipo de intervención» del formulario. Se puede marcar más de una. */
export type Intervencion = 'mecanica' | 'electricidad' | 'mangueras' | 'servicio';

export const INTERVENCION_LABEL: Record<Intervencion, string> = {
  mecanica: 'Mecánica',
  electricidad: 'Electricidad',
  mangueras: 'Mangueras / Hidráulica',
  servicio: 'Servicio',
};

/** Lo que ofrece el selector. La base NO tiene `check` sobre esta columna a
 *  propósito: si mañana hace falta otro estado, se agrega acá y ya. */
export const ESTADOS_REPUESTO = ['Nuevo', 'Usado', 'Reparado', 'Reacondicionado'];

export type ServicePartInput = {
  quantity?: number | string | null;
  description: string;
  estado?: string | null;
};

export type ServiceOrderInput = {
  machineryId: string;
  serviceDate: string;              // AAAA-MM-DD
  origen: ServiceOrigen;
  technician?: string | null;       // obligatorio si origen = 'interno'
  provider?: string | null;         // obligatorio si origen = 'externo'
  intervenciones?: Intervencion[] | null;
  problem?: string | null;
  workDone?: string | null;
  photos?: string[] | null;
  notes?: string | null;
  /** La avería que este trabajo atiende. OPCIONAL, y apuntar a ella NO la modifica. */
  maintenanceRequestId?: string | null;
  createdBy?: string | null;
};

/** Lo mínimo del cliente Supabase que este archivo necesita. Se recibe como
 *  parámetro para que la prueba pueda inyectar uno falso. */
export type SupabaseLike = { from: (tabla: string) => any };

const txt = (v: unknown): string => String(v ?? '').trim();
const txtOrNull = (v: unknown): string | null => txt(v) || null;
const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return isFinite(n) && txt(v) !== '' ? n : null;
};

/**
 * ¿Se puede guardar? Devuelve el primer problema EN CRISTIANO, o `null` si está bien.
 * El texto va tal cual a la pantalla: quien lo lee es el encargado del taller.
 */
export function validarServicio(inp: ServiceOrderInput): string | null {
  if (!txt(inp.machineryId)) return 'Falta la máquina.';
  if (!txt(inp.serviceDate)) return 'Selecciona la fecha del servicio.';
  if (inp.origen !== 'interno' && inp.origen !== 'externo') return 'Indica si el servicio fue interno o externo.';
  if (inp.origen === 'interno' && !txt(inp.technician)) return 'Indica quién lo hizo (operador / técnico).';
  if (inp.origen === 'externo' && !txt(inp.provider)) return 'Indica el nombre de la persona o taller externo.';
  // Un registro sin problema ni acciones no sirve de nada: no dice qué pasó.
  if (!txt(inp.problem) && !txt(inp.workDone)) return 'Escribe al menos el problema o lo que se hizo.';
  return null;
}

/**
 * Deja los repuestos listos para guardar: descarta los renglones en blanco (el
 * formulario siempre tiene uno vacío al final) y numera el orden, porque sin
 * `position` Postgres los devuelve en cualquier orden y la lista se ve distinta
 * cada vez que se abre.
 */
export function limpiarRepuestos(
  parts: ServicePartInput[] | null | undefined
): { quantity: number | null; description: string; estado: string | null; position: number }[] {
  return (parts ?? [])
    .filter((p) => txt(p?.description) !== '')
    .map((p, i) => ({
      quantity: num(p.quantity),
      description: txt(p.description),
      estado: txtOrNull(p.estado),
      position: i,
    }));
}

/** Arma la fila de `machinery_service_orders`. PURA: no escribe nada. */
export function filaServicio(inp: ServiceOrderInput): Record<string, any> {
  return {
    machinery_id: inp.machineryId,
    maintenance_request_id: txtOrNull(inp.maintenanceRequestId),
    service_date: inp.serviceDate,
    origen: inp.origen,
    technician: inp.origen === 'interno' ? txtOrNull(inp.technician) : null,
    provider: inp.origen === 'externo' ? txtOrNull(inp.provider) : null,
    intervenciones: inp.intervenciones ?? [],
    problem: txtOrNull(inp.problem),
    work_done: txtOrNull(inp.workDone),
    photos: inp.photos ?? [],
    notes: txtOrNull(inp.notes),
    created_by: txtOrNull(inp.createdBy),
  };
}

/** Quién hizo el trabajo, en una línea, para listas y PDF. */
export function quienLoHizo(o: { origen: ServiceOrigen; technician?: string | null; provider?: string | null }): string {
  return o.origen === 'externo'
    ? `🤝 Externo${txt(o.provider) ? ` · ${txt(o.provider)}` : ''}`
    : `🏭 Interno${txt(o.technician) ? ` · ${txt(o.technician)}` : ''}`;
}

/**
 * Guarda el servicio y sus repuestos. **Solo escribe en las dos tablas del
 * módulo.** Si alguna vez alguien agrega acá un `update` a `machinery` o a
 * `maintenance_requests`, la prueba de la frontera lo va a atrapar.
 */
export async function guardarServicio(
  db: SupabaseLike,
  inp: ServiceOrderInput,
  parts: ServicePartInput[] = []
): Promise<{ error?: string; id?: string }> {
  const problema = validarServicio(inp);
  if (problema) return { error: problema };

  const { data, error } = await db
    .from('machinery_service_orders')
    .insert(filaServicio(inp))
    .select('id')
    .single();
  if (error) return { error: error.message };

  const id = data?.id as string;
  const limpios = limpiarRepuestos(parts);
  if (limpios.length) {
    const { error: ep } = await db
      .from('machinery_service_parts')
      .insert(limpios.map((p) => ({ ...p, service_order_id: id })));
    // El servicio ya quedó guardado; si fallan los repuestos se avisa pero no
    // se borra nada — perder el registro del trabajo sería peor.
    if (ep) return { id, error: `El servicio se guardó, pero los repuestos no: ${ep.message}` };
  }
  return { id };
}
```

- [ ] **Paso 4: Correr las pruebas para verificar que pasan**

```bash
node scripts/test-servicio.mjs
npx tsc --noEmit
```

Esperado: `N OK · 0 FALLO(S)` y `tsc` sin salida.

- [ ] **Paso 5: Registrar el script**

En `package.json`, **agregar** (sin tocar los scripts de la compañera):

```json
"test:servicio": "node scripts/test-servicio.mjs"
```

Y **añadir al final** de `test:all`: ` && node scripts/test-servicio.mjs`

Verificar: `npm run test:all` → las 11 suites en verde.

- [ ] **Paso 6: Commit**

```bash
git add src/lib/machineService.ts scripts/test-servicio.mjs package.json
git commit -m "feat(servicio)+test: registro de servicios con la frontera blindada"
```

---

## Tarea 2 · Los tipos de base de datos

**Archivos:**
- Modificar: `src/types/database.ts`

**Interfaces:**
- Consume: `ServiceOrigen`, `Intervencion` de la Tarea 1.
- Produce: `MachineryServiceOrder`, `MachineryServicePart`; campos de lubricación en `Machinery`.

- [ ] **Paso 1: Agregar las interfaces**

Junto a `HoseService` (~línea 1032), siguiendo esa misma forma:

```ts
// Módulo de Servicio de Maquinaria — registro de lo que se le hizo a una máquina.
// Sin dinero: este módulo no lleva costos ni pagos (pedido del cliente, 18-ago-2026).
export type MachineryServiceOrigen = 'interno' | 'externo';

export interface MachineryServiceOrder {
  id: string;
  machinery_id: string;
  /** La avería que atiende. Apuntar a ella NO la modifica: el módulo no escribe
   *  en `maintenance_requests`. Ver la frontera en `machineService.ts`. */
  maintenance_request_id: string | null;
  service_date: string;            // YYYY-MM-DD
  origen: MachineryServiceOrigen;
  technician: string | null;       // «Operador / Técnico» (interno)
  provider: string | null;         // persona o taller externo
  /** 'mecanica' | 'electricidad' | 'mangueras' | 'servicio' — se puede marcar varias. */
  intervenciones: string[];
  problem: string | null;
  work_done: string | null;
  photos: string[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MachineryServicePart {
  id: string;
  service_order_id: string;
  quantity: number | null;
  description: string;
  estado: string | null;
  /** Conserva el orden en que se cargaron los renglones. */
  position: number;
}
```

- [ ] **Paso 2: Agregar la lubricación a `Machinery`**

Buscar `export interface Machinery` y agregar, con comentario:

```ts
  /** Ficha técnica — tipo de aceite recomendado del motor. */
  oil_type?: string | null;
  /** Ficha técnica — cantidad de aceite requerida, en litros. */
  oil_capacity_l?: number | null;
  /** Ficha técnica — nota libre, para lo que no se mide en litros. */
  oil_notes?: string | null;
```

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 4: Commit**

```bash
git add src/types/database.ts
git commit -m "types(servicio): ordenes, repuestos y lubricacion de la ficha"
```

---

## Tarea 3 · El PDF

**Archivos:**
- Crear: `src/lib/machineServiceReport.ts`
- Modificar: `scripts/test-servicio.mjs` (bloque nuevo al final, antes del resumen)

**Interfaces:**
- Consume: `machineLabel`, `machineFileLabel` de `src/lib/machineLabel.ts`; `pdfDocument`, `exportPdf` de `src/lib/pdf.ts`; `quienLoHizo`, `INTERVENCION_LABEL` de la Tarea 1.
- Produce: `MaquinaFicha`, `ServicioImprimible`, `buildMachineServiceReportHtml()`, `generateMachineServiceReport()`.

- [ ] **Paso 1: Escribir la prueba que falla**

En `scripts/test-servicio.mjs`, **antes** del bloque `if (fail)`, agregar. Nota: este archivo **sí** tiene imports, así que se transpila con un `require` de mentira que devuelve las funciones reales de `machineLabel` y stubs de `pdf`.

```js
// ── 8) El PDF ─────────────────────────────────────────────────────────────
{
  const rep = fs.readFileSync(path.join(ROOT, 'src/lib/machineServiceReport.ts'), 'utf8');
  const repJs = ts.transpileModule(rep, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;

  // machineLabel.ts es puro → se carga de verdad. `pdf.ts` y `machineService.ts`
  // se sustituyen por lo mínimo que el reporte usa.
  const lblSrc = fs.readFileSync(path.join(ROOT, 'src/lib/machineLabel.ts'), 'utf8');
  const lblJs = ts.transpileModule(lblSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const lblMod = { exports: {} };
  new Function('exports', 'module', lblJs)(lblMod.exports, lblMod);

  const fakeRequire = (id) => {
    if (id.includes('machineLabel')) return lblMod.exports;
    if (id.includes('machineService')) return mod.exports;
    if (id.includes('pdf')) return {
      pdfDocument: (o) => `<html><title>${o.title}</title>${o.body}</html>`,
      exportPdf: async () => true,
      nowStamp: () => '18 ago. 2026, 12:00 p. m.',
      dateRangeLabel: () => 'del 01 al 18',
    };
    throw new Error('import inesperado: ' + id);
  };
  const repMod = { exports: {} };
  new Function('exports', 'module', 'require', repJs)(repMod.exports, repMod, fakeRequire);
  const { buildMachineServiceReportHtml } = repMod.exports;

  const R053 = {
    code: 'RETROEXCAVADORA', identifier: '053', serial: '5YN02894',
    plate: 'SLP214TSWE0471955', marca: 'CAT', modelo: '320',
    photo_url: 'https://x/foto.jpg', companyName: 'Golden Touch 1127 C.A.',
    oil_type: '15W-40', oil_capacity_l: 18, last_horometro: 1240, horometro_base: 1100,
  };
  const SRV = {
    id: 's1', service_date: '2026-08-18', origen: 'interno', technician: 'José Pérez',
    intervenciones: ['mecanica', 'mangueras'], problem: 'Manguera reventada',
    work_done: 'Cambio de manguera y filtro',
    parts: [{ quantity: 2, description: 'Manguera 3/4"', estado: 'Nuevo' }],
  };

  // Una sola máquina → LLEVA ficha técnica
  const unaHtml = buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [SRV] }] });
  ok('⭐ una máquina → sale la ficha técnica', /FICHA T[ÉE]CNICA/i.test(unaHtml));
  ok('la ficha muestra la PLACA, que es lo que usan para asignar',
    unaHtml.includes('SLP214TSWE0471955'));
  ok('la ficha trae la foto de la máquina', unaHtml.includes('https://x/foto.jpg'));
  ok('la ficha trae la lubricación del documento del cliente',
    unaHtml.includes('15W-40') && unaHtml.includes('18'));
  ok('hay salto de página entre la ficha y las reparaciones',
    /page-break-after\s*:\s*always/.test(unaHtml));
  ok('el servicio sale con su repuesto', unaHtml.includes('Manguera 3/4"'));
  ok('el servicio dice quién lo hizo', unaHtml.includes('José Pérez'));
  ok('las intervenciones salen con su nombre de papel',
    unaHtml.includes('Mangueras / Hidráulica'));
  ok('hay líneas de firma', /Firma del T[ée]cnico/i.test(unaHtml) && /Firma Supervisor/i.test(unaHtml));
  ok('⭐ el PDF NO habla de dinero',
    !/costo|precio|monto|\$|bs\b|pagar/i.test(unaHtml.replace(/<[^>]+>/g, ' ')));

  // Varias máquinas → SIN ficha
  const R008 = { code: 'RETROEXCAVADORA', identifier: '008', serial: '92543.0', plate: null };
  const variasHtml = buildMachineServiceReportHtml({
    maquinas: [{ m: R053, servicios: [SRV] }, { m: R008, servicios: [SRV] }],
  });
  ok('⭐ varias máquinas → NO sale la ficha técnica', !/FICHA T[ÉE]CNICA/i.test(variasHtml));
  ok('las dos RETROEXCAVADORAS se distinguen en el PDF',
    variasHtml.includes('SLP214TSWE0471955') && variasHtml.includes('92543.0'));

  // Casos de borde
  ok('máquina sin servicios no rompe',
    typeof buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [] }] }) === 'string');
  ok('sin máquinas no rompe',
    typeof buildMachineServiceReportHtml({ maquinas: [] }) === 'string');
  const sinFoto = buildMachineServiceReportHtml({
    maquinas: [{ m: { code: 'VOLTEO', plate: 'A1' }, servicios: [SRV] }],
  });
  ok('máquina sin foto no deja un <img> roto', !/<img[^>]*src=["']["']/.test(sinFoto));
  ok('máquina sin lubricación no imprime "undefined"', !/undefined|null/.test(sinFoto));

  // Registro anterior
  const viejo = { ...SRV, id: 'v1', esRegistroAnterior: true, parts: [], technician: null };
  const mixto = buildMachineServiceReportHtml({ maquinas: [{ m: R053, servicios: [SRV, viejo] }] });
  ok('los registros viejos salen marcados como tales', /registro anterior/i.test(mixto));
}
```

- [ ] **Paso 2: Correr para verificar que falla**

```bash
node scripts/test-servicio.mjs
```

Esperado: **FALLA** con `ENOENT ... src/lib/machineServiceReport.ts`.

- [ ] **Paso 3: Escribir la implementación**

Crear `src/lib/machineServiceReport.ts`:

```ts
// ============================================================================
// REPORTE DE SERVICIOS DE MAQUINARIA (PDF).
//
// Reproduce el documento que trajo el cliente («Ficha técnica Jumbo con martillo
// 0488»): la ficha técnica de la máquina en la primera página, y sus reparaciones
// a partir de la segunda, con las dos firmas al pie.
//
// Función PURA: recibe los datos ya cargados por la pantalla, no consulta
// Supabase. Mismo contrato que `hoseServiceReport.ts`.
//
// EL MODO LO DECIDE EL REPORTE, no un botón: si el filtro dejó UNA sola máquina
// imprime su ficha; si dejó varias, agrupa sin ficha (serían decenas de páginas).
//
// ⚠️ SIN DINERO: acá no se imprime ningún costo. El módulo no los lleva.
// ============================================================================
import { pdfDocument, exportPdf } from './pdf';
import { machineLabel, machineFileLabel, MaquinaIdentificable } from './machineLabel';
import { quienLoHizo, INTERVENCION_LABEL, Intervencion, ServiceOrigen } from './machineService';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const nOrDash = (v: any) => (v == null || v === '' ? '—' : String(v));

export type MaquinaFicha = MaquinaIdentificable & {
  tipo?: string | null; marca?: string | null; modelo?: string | null;
  photo_url?: string | null; companyName?: string | null; encargado?: string | null;
  oil_type?: string | null; oil_capacity_l?: number | null; oil_notes?: string | null;
  last_horometro?: number | null; horometro_base?: number | null;
};

export type ServicioImprimible = {
  id: string;
  service_date: string;
  origen: ServiceOrigen;
  technician?: string | null;
  provider?: string | null;
  intervenciones?: string[] | null;
  problem?: string | null;
  work_done?: string | null;
  parts?: { quantity: number | null; description: string; estado: string | null }[];
  /** Texto de la avería que atiende, si la hay. */
  averia?: string | null;
  /** Expediente viejo de `machinery_repairs`: trae menos datos y se marca como tal,
   *  para que no parezca un formulario llenado a medias. */
  esRegistroAnterior?: boolean;
};

const CSS = `
  .sv-head{display:flex;gap:18px;align-items:center;margin:6px 0 4px}
  .sv-photo{width:150px;height:120px;object-fit:cover;border:3px solid #1E3A5F;border-radius:10px;background:#EEF2F7}
  .sv-name{font-size:22px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .sv-sub{font-size:13px;color:#374151;font-weight:700;margin-top:3px}
  h3.sec{margin:16px 0 4px;font-size:13px;color:#1E3A5F;border-top:2px solid #1E3A5F;padding-top:8px}
  table.ft{width:100%;border-collapse:collapse;font-size:12px}
  table.ft td{border:1px solid #D7E3F4;padding:5px 9px;vertical-align:top}
  table.ft td.k{background:#EAF1FB;color:#374151;width:42%;font-weight:700}
  .corte{page-break-after:always}
  .srv{border:1px solid #D7E3F4;border-radius:8px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}
  .srv .top{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:800;color:#1E3A5F}
  .srv .tags span{display:inline-block;background:#EAF1FB;border:1px solid #D7E3F4;border-radius:10px;padding:1px 8px;font-size:10px;margin-right:4px}
  .srv .kv{font-size:12px;margin-top:4px}
  .srv .kv b{color:#374151}
  .viejo{background:#FFFBEB;border-color:#FDE68A}
  table.rep{width:100%;border-collapse:collapse;font-size:11px;margin-top:5px}
  table.rep th{background:#1E3A5F;color:#fff;padding:4px 7px;text-align:left}
  table.rep td{border:1px solid #D7E3F4;padding:4px 7px}
  .grupo{font-size:15px;font-weight:800;color:#1E3A5F;margin:14px 0 6px;border-bottom:2px solid #1E3A5F}
  .firmas{display:flex;gap:60px;margin-top:56px;page-break-inside:avoid}
  .firmas div{flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;font-weight:700}
`;

function filas(pairs: [string, any][]): string {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
}

/** Página 1: la ficha técnica de la máquina, como el documento del cliente. */
export function fichaTecnicaHtml(m: MaquinaFicha): string {
  const horas = m.last_horometro != null && m.horometro_base != null
    ? Math.max(0, Number(m.last_horometro) - Number(m.horometro_base))
    : null;
  const foto = m.photo_url ? `<img class="sv-photo" src="${esc(m.photo_url)}"/>` : '';
  return `<div class="corte">
    <h3 class="sec">FICHA TÉCNICA DE MAQUINARIA</h3>
    <div class="sv-head">${foto}
      <div><div class="sv-name">${esc(machineLabel(m))}</div>
        <div class="sv-sub">${esc(m.companyName ?? '')}</div></div>
    </div>
    <h3 class="sec">🚜 Información general</h3>
    <table class="ft"><tbody>${filas([
      ['Tipo de equipo', m.tipo], ['Marca', m.marca], ['Modelo', m.modelo],
      ['Número de serial', m.serial], ['Placa', m.plate], ['Identificador', m.identifier],
      ['Empresa', m.companyName], ['Encargado', m.encargado],
    ])}</tbody></table>
    <h3 class="sec">🛢️ Información de lubricación</h3>
    <table class="ft"><tbody>${filas([
      ['Tipo de aceite recomendado (motor)', m.oil_type],
      ['Cantidad requerida (motor)', m.oil_capacity_l != null ? `${m.oil_capacity_l} L` : null],
      ['Nota', m.oil_notes],
    ]) || '<tr><td class="k">Sin datos de lubricación</td><td>—</td></tr>'}</tbody></table>
    <h3 class="sec">⏱️ Horómetro</h3>
    <table class="ft"><tbody>${filas([
      ['Última lectura', m.last_horometro != null ? `${m.last_horometro} h` : null],
      ['Lectura del último mantenimiento', m.horometro_base != null ? `${m.horometro_base} h` : null],
      ['Horas acumuladas desde entonces', horas != null ? `${horas} h` : null],
    ]) || '<tr><td class="k">Sin lecturas</td><td>—</td></tr>'}</tbody></table>
  </div>`;
}

/** Una reparación, como la hoja «Reporte de mantenimiento / reparación». */
export function servicioCardHtml(s: ServicioImprimible): string {
  const tags = (s.intervenciones ?? [])
    .map((k) => `<span>${esc(INTERVENCION_LABEL[k as Intervencion] ?? k)}</span>`).join('');
  const reps = (s.parts ?? []).length
    ? `<table class="rep"><thead><tr><th>Cant.</th><th>Descripción del repuesto / insumo</th><th>Estado</th></tr></thead><tbody>${
        (s.parts ?? []).map((p) =>
          `<tr><td>${esc(nOrDash(p.quantity))}</td><td>${esc(p.description)}</td><td>${esc(nOrDash(p.estado))}</td></tr>`
        ).join('')}</tbody></table>`
    : '';
  return `<div class="srv${s.esRegistroAnterior ? ' viejo' : ''}">
    <div class="top"><span>${esc(dmy(s.service_date))} · ${esc(quienLoHizo(s))}</span>
      <span class="tags">${tags}${s.esRegistroAnterior ? '<span>Registro anterior</span>' : ''}</span></div>
    ${s.problem ? `<div class="kv"><b>Problema:</b> ${esc(s.problem)}</div>` : ''}
    ${s.work_done ? `<div class="kv"><b>Se hizo:</b> ${esc(s.work_done)}</div>` : ''}
    ${s.averia ? `<div class="kv"><b>Atiende:</b> ${esc(s.averia)}</div>` : ''}
    ${reps}
  </div>`;
}

const FIRMAS = `<div class="firmas"><div>Firma del Técnico</div><div>Firma Supervisor</div></div>`;

/** El documento completo. PURA — devuelve el HTML, no imprime nada. */
export function buildMachineServiceReportHtml(opts: {
  maquinas: { m: MaquinaFicha; servicios: ServicioImprimible[] }[];
  desde?: string; hasta?: string;
}): string {
  const { maquinas, desde, hasta } = opts;
  const unaSola = maquinas.length === 1;   // ← acá se decide el modo
  const rango = desde && hasta ? `${dmy(desde)} — ${dmy(hasta)}` : '';

  const cuerpo = maquinas.map(({ m, servicios }) => {
    const lista = servicios.length
      ? servicios.map(servicioCardHtml).join('')
      : '<div class="srv">Sin servicios registrados en el período.</div>';
    return unaSola
      ? fichaTecnicaHtml(m) + `<h3 class="sec">🔧 Reparaciones${rango ? ` · ${esc(rango)}` : ''}</h3>` + lista
      : `<div class="grupo">${esc(machineLabel(m))}</div>` + lista;
  }).join('');

  const total = maquinas.reduce((a, x) => a + x.servicios.length, 0);
  return pdfDocument({
    title: unaSola ? 'Ficha técnica y reparaciones' : 'Reparaciones de maquinaria',
    subtitle: `${total} servicio(s)${rango ? ` · ${rango}` : ''}`,
    body: cuerpo + FIRMAS,
    extraCss: CSS,
  });
}

/** Genera y exporta el PDF. @returns true si el usuario confirmó (imprimió/guardó). */
export async function generateMachineServiceReport(opts: {
  maquinas: { m: MaquinaFicha; servicios: ServicioImprimible[] }[];
  desde?: string; hasta?: string;
}): Promise<boolean> {
  const nombre = opts.maquinas.length === 1
    ? `Servicios - ${machineFileLabel(opts.maquinas[0].m)}`
    : 'Reparaciones de maquinaria';
  return exportPdf(buildMachineServiceReportHtml(opts), nombre);
}
```

- [ ] **Paso 4: Correr para verificar que pasa**

```bash
node scripts/test-servicio.mjs
npx tsc --noEmit
```

- [ ] **Paso 5: Commit**

```bash
git add src/lib/machineServiceReport.ts scripts/test-servicio.mjs
git commit -m "feat(servicio)+test: PDF de ficha tecnica e historial de reparaciones"
```

---

## Tarea 4 · La pestaña 🧾 Servicios

**Archivos:**
- Crear: `src/screens/ServicioRegistroTab.tsx`
- Modificar: `src/screens/MantenimientoMaquinariaScreen.tsx:59` (tipo `Tab`), `:744` (lista de pestañas), y el cuerpo donde se renderiza cada pestaña.

**Interfaces:**
- Consume: `guardarServicio`, `validarServicio`, `limpiarRepuestos`, `quienLoHizo`, `INTERVENCION_LABEL`, `ESTADOS_REPUESTO` (Tarea 1); `generateMachineServiceReport` (Tarea 3); `machineLabel`, `machineMatches` (`machineLabel.ts`); `captureAndUploadPhoto(machineryId, folder)` (`photo.ts`).
- Produce: `export default function ServicioRegistroTab(props)` con
  `props: { machines: Mach[]; reqs: Req[]; canWrite: boolean; uid: string | null }`.

- [ ] **Paso 1: Crear el componente**

`ServicioRegistroTab.tsx` recibe lo que la pantalla madre ya cargó — **no vuelve a consultar `machinery` ni `maintenance_requests`**. Carga solo lo suyo:

```ts
const cargar = async () => {
  const { data } = await supabase
    .from('machinery_service_orders')
    .select('*, parts:machinery_service_parts(*)')
    .order('service_date', { ascending: false });
  setOrdenes(data ?? []);
};
```

Estructura, siguiendo los componentes del proyecto (`Screen`, `Card`, `SectionTitle`, `EmptyState`, `useTheme`, `useToast`):

1. Filtros: máquina (buscable con `machineMatches`), desde, hasta.
2. Botón `📄 Exportar PDF` → arma `maquinas[]` con sus servicios y llama `generateMachineServiceReport`.

   **Los expedientes viejos entran acá.** El PDF junta los `machinery_repairs` correctivos con las órdenes nuevas, ordenados por fecha, marcando los viejos para que no parezcan formularios llenados a medias:

```ts
const { data: viejos } = await supabase
  .from('machinery_repairs')
  .select('id, machinery_id, out_at, work_done')
  .eq('tipo', 'correctivo');

const comoServicio = (r: any): ServicioImprimible => ({
  id: r.id,
  service_date: r.out_at,
  origen: 'interno',            // los viejos no distinguían; se asume interno
  technician: null,
  intervenciones: [],
  problem: null,
  work_done: r.work_done,
  parts: [],
  esRegistroAnterior: true,     // ← esto es lo que los marca en el PDF
});

const servicios = [...ordenes.map(aImprimible), ...(viejos ?? []).map(comoServicio)]
  .filter((s) => dentroDelRango(s.service_date, desde, hasta))
  .sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
```
3. Botón `➕ Registrar servicio` (solo si `canWrite`) → modal con el formulario.
4. Lista de servicios, cada uno con `machineLabel` y `quienLoHizo`.
5. Si el servicio enlaza una avería, **las dos verdades juntas**:

```tsx
{o.maintenance_request_id ? (
  <>
    <Text style={{ color: colors.successSoftText, fontSize: 11, fontWeight: '800' }}>
      ✅ Atendida en taller
    </Text>
    {reqs.find((r) => r.id === o.maintenance_request_id)?.status === 'pendiente' ? (
      <Text style={{ color: colors.warningSoftText, fontSize: 11 }}>
        ⏳ El sistema la sigue viendo pendiente
      </Text>
    ) : null}
  </>
) : null}
```

El formulario sigue el orden del papel: datos generales → origen → intervenciones → problema (+ selector de avería) → acciones (+ fotos) → repuestos.

Al guardar:

```ts
const problema = validarServicio(inp);
if (problema) return toast.error(problema);
const r = await guardarServicio(supabase, inp, repuestos);
if (r.error) return toast.error(r.error);
toast.success('Servicio registrado. (No cambia el estado de la máquina.)');
```

El texto entre paréntesis **es obligatorio**: es la frontera dicha en el momento en que importa.

- [ ] **Paso 2: Montar la pestaña**

En `MantenimientoMaquinariaScreen.tsx`:

Línea 59 — agregar `'servicios'` al tipo:
```ts
type Tab = 'averias' | 'reparacion' | 'historial' | 'horometros' | 'reporte' | 'servicios';
```

Línea ~744 — agregar la pestaña **solo en Servicio**:
```ts
? [['averias', `⏳ Averías (${pendientes})`], ['servicios', '🧾 Servicios'], ['historial', '✓ Historial'], ['reporte', '📊 Reporte']]
```

Y donde se renderizan las pestañas:
```tsx
{tab === 'servicios' ? (
  <ServicioRegistroTab machines={machines} reqs={reqs} canWrite={canWrite} uid={uid} />
) : null}
```

- [ ] **Paso 3: Verificar**

```bash
npx tsc --noEmit
npm run test:all
```

- [ ] **Paso 4: Commit**

```bash
git add src/screens/ServicioRegistroTab.tsx src/screens/MantenimientoMaquinariaScreen.tsx
git commit -m "feat(servicio): pestana de registro con el formato del formulario"
```

---

## Tarea 5 · La lubricación en la ficha de la máquina

**Archivos:**
- Modificar: `src/screens/ControlMaquinariaScreen.tsx`

**Interfaces:**
- Consume: los campos de la Tarea 2.
- Produce: nada que otras tareas usen.

- [ ] **Paso 1: Agregar los tres campos**

Donde ya se editan `marca` y `modelo`, agregar `oil_type` (texto), `oil_capacity_l` (decimal, con `onlyDecimal`) y `oil_notes` (texto), con las etiquetas del documento del cliente: «Tipo de aceite (motor)», «Cantidad requerida (L)», «Nota de lubricación».

Incluirlos en el `select` de `machinery` y en el `update` del guardado de la ficha.

- [ ] **Paso 2: Verificar**

```bash
npx tsc --noEmit
```

- [ ] **Paso 3: Commit**

```bash
git add src/screens/ControlMaquinariaScreen.tsx
git commit -m "feat(maquinas): lubricacion en la ficha, para la ficha tecnica"
```

---

## Tarea 6 · La frontera: cortar las 7 escrituras

⚠️ **Esta tarea cambia el comportamiento que la gente ve hoy.** Hacerla completa o no hacerla; a medias deja el sistema incoherente.

**Archivos:**
- Modificar: `src/screens/MantenimientoMaquinariaScreen.tsx` líneas 427, 428, 440, 585, 629, 630, 631

- [ ] **Paso 1: Quitar las dos escrituras a `machinery.operational`**

Línea 585 (enviar al taller) — quitar `supabase.from('machinery').update({ operational: false })`.
Línea 629 (retorno operativo) — quitar `supabase.from('machinery').update({ operational: true, en_espera: false })`.

**Conservar** el `update` a `machinery_repairs` de la línea 628: esa es tabla del módulo.

- [ ] **Paso 2: Quitar las cinco escrituras a `maintenance_requests.status`**

Líneas 427, 428, 440, 630 y 631. La línea 443 es solo `setState` local — **se conserva**, es lo que hace que la lista responda.

Reemplazar el «marcar realizado» de la línea 440 por un registro de servicio, o dejar el botón mostrando a dónde ir. La pantalla debe decirlo:

> «Esto no cambia el estado de la máquina. Para reactivarla, Control de Maquinaria o el panel QR del coordinador.»

- [ ] **Paso 3: Dejar la excepción por escrito**

Sobre la línea 402 (`horometro_base`), agregar:

```ts
// ⚠️ EXCEPCIÓN DELIBERADA A LA FRONTERA (pedido del cliente, 18-ago-2026:
// «lo de los horómetros que sí funcione»). Este módulo NO escribe en `machinery`
// salvo acá: confirmar un mantenimiento reinicia el contador de horas acumuladas
// de la máquina, que es la lógica del ciclo. Lo lee `machineHoursReport.ts:72`
// y el panel de Supervisión. Todo lo demás — operational, en_espera, las averías —
// se dejó de tocar a propósito. Ver docs/superpowers/specs/2026-08-18-servicio-maquinaria-design.md
```

- [ ] **Paso 4: Verificar que no quedó ninguna**

```bash
grep -n "from('machinery')" src/screens/MantenimientoMaquinariaScreen.tsx
grep -n "status: 'realizado'" src/screens/MantenimientoMaquinariaScreen.tsx
```

Esperado: del primero **solo** las líneas 235 (select), 402 (la excepción) y 451 (select). Del segundo, **nada**.

```bash
npx tsc --noEmit && npm run test:all
```

- [ ] **Paso 5: Commit**

```bash
git add src/screens/MantenimientoMaquinariaScreen.tsx
git commit -m "refactor(taller): los modulos dejan de mover el estado de las maquinas"
```

---

## Tarea 7 · Manual y cierre

**Archivos:**
- Modificar: `src/screens/ManualScreen.tsx`
- Crear: `docs/backups/servicio-maquinaria-2026-08-18/`

- [ ] **Paso 1: Respaldo del módulo**

```bash
mkdir -p docs/backups/servicio-maquinaria-2026-08-18
cp src/screens/MantenimientoMaquinariaScreen.tsx src/screens/ServicioMaquinariaScreen.tsx \
   src/screens/ServicioRegistroTab.tsx src/lib/machineService.ts \
   src/lib/machineServiceReport.ts supabase/servicio_maquinaria.sql \
   docs/backups/servicio-maquinaria-2026-08-18/
git tag respaldo/servicio-maquinaria-2026-08-18
```

Con un `README.md` que explique qué se cambió y cómo volver atrás.

- [ ] **Paso 2: Manual**

Agregar la sección del módulo con: cómo registrar un servicio, qué significa interno/externo, cómo sacar el PDF, y **el cambio de comportamiento en las palabras de quien lo usa**:

> «Registrar un servicio deja constancia del trabajo, pero **no** pone la máquina operativa ni quita la avería. Para eso, Control de Maquinaria o el panel QR del coordinador. Se hizo así a propósito: que el taller no arrastre el estado de la flota.»

- [ ] **Paso 3: Verificación final**

```bash
npx tsc --noEmit
npm run test:all
```

Las 11 suites en verde. **Compilar no es probar** — probar la pestaña de verdad en la app antes de decir que está lista.

- [ ] **Paso 4: Commit**

```bash
git add docs/backups/servicio-maquinaria-2026-08-18 src/screens/ManualScreen.tsx
git commit -m "docs(servicio): manual y respaldo del modulo"
```

---

## Antes de subir a producción

1. El cliente corre `supabase/servicio_maquinaria.sql` (bloques 2 a 6) y pega el resultado del bloque 7. **Sin eso, la pestaña no funciona** — las tablas no existen.
2. `git fetch origin && git rebase origin/dev` — reconciliar con la compañera, nunca sobreescribir.
3. `npx tsc --noEmit` y `npm run test:all`.
4. Merge a `dev`. A `main`, solo cherry-pick.
5. Verificar el despliegue: `curl -L https://www.soslaguaira.com/version.json`.
