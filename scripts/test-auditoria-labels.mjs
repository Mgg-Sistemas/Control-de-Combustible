/*
 * AUDITORÍA — nombres legibles de columnas y resumen de cambios.
 *
 * Blinda `src/lib/auditLabels.ts`, lo que hace que la bitácora diga
 * "En espera: no → sí" en vez de "en_espera: false → true". El caso que motivó
 * esto (18-ago-2026): no se veía quién retiraba una máquina ni quién la ponía
 * en espera, porque la pantalla mostraba el nombre crudo de la columna.
 *
 *   npm run test:auditoria   (o: node scripts/test-auditoria-labels.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// auditLabels.ts es PURO (sin imports) → transpila y evalúa directo.
const src = fs.readFileSync(path.join(ROOT, 'src/lib/auditLabels.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { fieldLabel, changesSummary, formatAuditTextValue, RESUMEN_MAX_CAMPOS } = mod.exports;

// Formateador equivalente al fmtVal de AuditScreen para lo que se prueba acá
// (booleano → sí/no, vacío → ∅). El de la pantalla además formatea fechas, pero
// eso es suyo: changesSummary lo recibe como parámetro justamente para no
// depender de zonas horarias.
const fmt = (x) => {
  if (x === null || x === undefined || x === '') return '∅';
  if (typeof x === 'boolean') return x ? 'sí' : 'no';
  return String(x);
};
const cambio = (de, a) => ({ de, a });

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

console.log('AUDITORÍA — etiquetas legibles y resumen de cambios\n');

// ── 1) Los dos casos que pidió el cliente ───────────────────────────────────
{
  const espera = changesSummary('UPDATE', { en_espera: cambio(false, true) }, fmt);
  ok('poner EN ESPERA se lee en cristiano', espera === 'En espera: no → sí', espera);

  const quitar = changesSummary('UPDATE', { en_espera: cambio(true, false) }, fmt);
  ok('quitar de EN ESPERA se lee en cristiano', quitar === 'En espera: sí → no', quitar);

  const retiro = changesSummary('UPDATE', { active: cambio(true, false) }, fmt);
  ok('RETIRAR una máquina se lee en cristiano', retiro === 'Activa: sí → no', retiro);
}

// ── 2) Ninguna etiqueta se queda en el nombre crudo de la columna ────────────
{
  const claves = ['en_espera', 'active', 'operational', 'exit_date', 'entry_date',
    'inactivated_at', 'inactivated_by', 'reactivated_at', 'reactivated_by', 'qr_blocked'];
  const crudas = claves.filter((k) => fieldLabel(k) === k);
  ok('todas las columnas de estado de máquina están traducidas', crudas.length === 0, crudas.join(', '));
  ok('ninguna etiqueta lleva guion bajo', !claves.some((k) => fieldLabel(k).includes('_')));
}

// ── 3) Una columna que no está en el mapa NO rompe: cae a su nombre ──────────
{
  ok('columna desconocida cae a su nombre original', fieldLabel('columna_nueva_2027') === 'columna_nueva_2027');
  const s = changesSummary('UPDATE', { columna_nueva_2027: cambio(1, 2) }, fmt);
  ok('y aun así se resume sin fallar', s === 'columna_nueva_2027: 1 → 2', s);
}

// ── 4) El corte a dos campos, y el "+N más" ─────────────────────────────────
{
  ok('el tope declarado sigue siendo 2', RESUMEN_MAX_CAMPOS === 2);

  const dos = changesSummary('UPDATE', { en_espera: cambio(false, true), active: cambio(true, false) }, fmt);
  ok('con 2 campos NO aparece el "+N más"', dos === 'En espera: no → sí  ·  Activa: sí → no', dos);

  const cuatro = changesSummary('UPDATE', {
    en_espera: cambio(false, true), active: cambio(true, false),
    zona: cambio('A', 'B'), notes: cambio('x', 'y'),
  }, fmt);
  ok('con 4 campos se cortan 2 y avisa "+2 más"', cuatro.endsWith('+2 más'), cuatro);
  ok('y el corte respeta el orden de llegada', cuatro.startsWith('En espera: no → sí'), cuatro);
}

// ── 5) Valores vacíos / nulos no ensucian la línea ──────────────────────────
{
  const s = changesSummary('UPDATE', { exit_date: cambio(null, '2026-08-18') }, fmt);
  ok('un valor nulo se muestra como ∅, no como "null"', s === 'Fecha de salida: ∅ → 2026-08-18', s);
}

// ── 6) Solo resume UPDATE: crear/borrar traen la fila entera, no un antes→después ──
{
  ok('INSERT no genera resumen', changesSummary('INSERT', { code: 'X' }, fmt) === null);
  ok('DELETE no genera resumen', changesSummary('DELETE', { code: 'X' }, fmt) === null);
  ok('sin changes no genera resumen', changesSummary('UPDATE', null, fmt) === null);
  ok('changes vacío no genera resumen', changesSummary('UPDATE', {}, fmt) === null);
  ok('un evento de app (SCAN) no genera resumen', changesSummary('SCAN', { a: 1 }, fmt) === null);
}

// ── 7) AGRUPAR POR MÓDULO ───────────────────────────────────────────────────
// El 07-sep-2026 los módulos se mudaron de este archivo a `src/lib/auditModulos.ts`
// y pasaron a ser las SECCIONES DE LA APP (Control, Inspecciones, Nómina…) en vez
// de once cajones por tabla. La cobertura —que ninguna tabla auditada caiga en
// "📁 Otro"— la vigila ahora `scripts/test-auditoria-modulos.mjs`, junto con el
// reparto por acción. Acá solo se comprueba que la mudanza no dejó a la pantalla
// decidiendo por su cuenta: si volviera a declarar su propia lista, habría DOS
// reglas y una de las dos se quedaría vieja sin que nadie lo note.
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/AuditScreen.tsx'), 'utf8');
  const vivo = scr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('la pantalla ya no declara su propia lista de módulos', !/const MODULES\s*:/.test(vivo));
  ok('los pide a la librería', /from '\.\.\/lib\/auditModulos'/.test(vivo));
  ok('y esa librería existe', fs.existsSync(path.join(ROOT, 'src/lib/auditModulos.ts')));
}

// ── 8) COMPRAS Y CUENTAS POR PAGAR — Etiquetas y limpieza de notas en Auditoría ──
{
  const clavesCompras = [
    'contraparte', 'solicitante_nombre', 'observaciones', 'nota',
    'inventory_requirement_id', 'comprobante_url', 'fecha_emision', 'fecha_vencimiento',
  ];
  const crudas = clavesCompras.filter((k) => fieldLabel(k) === k);
  ok('todas las columnas clave de Compras/Cuentas están traducidas', crudas.length === 0, crudas.join(', '));

  const sucio = 'Nota de compra urgente\n[SIN_EMPRESA_REQ]\n[RECIBO_PAGO: Url: https://x/1.jpg | Tipo: image | Nombre: pago1.jpg | Fecha: 2026-11-05 | Ref: 1234 | SubidoPor: Ana | SubidoAt: 2026-11-05T10:00:00Z]\n[[HISTORIAL_COMPRA:%5B%7B%22tipo%22%3A%22solicitud_creada%22%7D%5D:FIN_HISTORIAL]]';
  const limpio = formatAuditTextValue(sucio);
  ok('formatAuditTextValue oculta el JSON crudo [[HISTORIAL_COMPRA:...]]', !limpio.includes('HISTORIAL_COMPRA'), limpio);
  ok('formatAuditTextValue conserva la nota limpia', limpio.includes('Nota: "Nota de compra urgente"'), limpio);
  ok('formatAuditTextValue traduce [SIN_EMPRESA_REQ]', limpio.includes('Sin empresa asignada'), limpio);
  ok('formatAuditTextValue muestra quién subió el comprobante', limpio.includes('subido por Ana'), limpio);
}

// ── 9) HISTÓRICO DE COMPRAS — Reconstrucción desde audit_log (notas, empresa, beneficiario, comprobantes) ──
{
  const cache = new Map();
  const loadTsLib = (relName) => {
    if (!relName.startsWith('.')) return { Platform: { OS: 'web' }, Alert: { alert: () => {} } };
    const clean = relName.replace(/^\.\//, '').replace(/\.ts$/, '');
    if (cache.has(clean)) return cache.get(clean);
    const fullPath = path.join(ROOT, 'src/lib', `${clean}.ts`);
    if (!fs.existsSync(fullPath)) return {};
    const code = fs.readFileSync(fullPath, 'utf8');
    const out = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText;
    const m = { exports: {} };
    cache.set(clean, m.exports);
    new Function('exports', 'module', 'require', out)(m.exports, m, loadTsLib);
    return m.exports;
  };
  const { extraerCambiosLegiblesDeTextoCompra, construirTimelineExpediente } = loadTsLib('./comprasHistorico');

  const companies = [
    { id: 'c1', name: 'SOS LA GUAIRA' },
    { id: 'c2', name: 'GOLDEN TOUCH 1127 CA' },
  ];

  // Quitar empresa + editar nota + subir comprobante
  const diffs = extraerCambiosLegiblesDeTextoCompra(
    'Nota original\n[EMPRESA:c1:SOS LA GUAIRA]',
    'Nota corregida por tesorería\n[SIN_EMPRESA_REQ]\n[RECIBO_PAGO: Url: https://x/1.jpg | Tipo: image | Nombre: pago1.jpg | Fecha: 2026-11-05 | Ref: 554433 | SubidoPor: Carlos | SubidoAt: 2026-11-05T10:00:00Z | Metodo: Transferencia | Nota:  | Archivos: ]',
    companies,
  );
  ok('detecta edición de nota antes → después', diffs.frases.some((d) => d.includes('Nota modificada: «Nota original» → «Nota corregida por tesorería»')), diffs.frases.join(' | '));
  ok('detecta cuando se quita la empresa en las etiquetas', diffs.frases.some((d) => d.includes('Empresa quitada: «SOS LA GUAIRA» → «Sin empresa asignada»')), diffs.frases.join(' | '));
  ok('detecta cuando se sube un comprobante en las etiquetas', diffs.frases.some((d) => d.includes('Comprobante de pago subido') && d.includes('Carlos')), diffs.frases.join(' | '));

  // Reconstrucción de timeline con auditLogs (quitar empresa, cambiar beneficiario, editar abono)
  const timeline = construirTimelineExpediente({
    req: {
      id: 'req-1',
      code: 'REQ-0999',
      title: 'COMPRA DE REPUESTOS',
      status: 'en_proceso',
      created_at: '2026-11-05T10:00:00Z',
      observaciones: 'Nota final',
    },
    cuenta: {
      id: 'cta-1',
      inventory_requirement_id: 'req-1',
      documento: 'REQ-0999',
      concepto: 'COMPRA DE REPUESTOS',
      contraparte: 'PROVEEDOR NUEVO CA',
      monto: 500,
      moneda: 'USD',
      estado: 'parcial',
      created_at: '2026-11-05T10:05:00Z',
      nota: 'Nota final',
    },
    abonos: [],
    companies,
    auditLogs: [
      {
        id: 101,
        at: '2026-11-05T11:00:00Z',
        user_name: 'María Pérez',
        action: 'UPDATE',
        table_name: 'cuentas',
        row_id: 'cta-1',
        changes: {
          company_id: { de: 'c1', a: null },
          contraparte: { de: 'PROVEEDOR VIEJO CA', a: 'PROVEEDOR NUEVO CA' },
          nota: { de: 'Nota inicial', a: 'Nota final' },
        },
      },
      {
        id: 102,
        at: '2026-11-05T12:00:00Z',
        user_name: 'Pedro Gómez',
        action: 'DELETE',
        table_name: 'cuenta_abonos',
        row_id: 'abo-1',
        changes: {
          cuenta_id: 'cta-1',
          monto: 150,
          moneda: 'USD',
          metodo: 'Pago móvil',
          referencia: '987654',
          comprobante_url: 'https://x/comp.jpg',
        },
      },
    ],
  });
  ok('timeline reconstruye cambio de empresa, beneficiario y nota desde audit_log', timeline.some((ev) =>
    ev.by === 'María Pérez' &&
    ev.detalle &&
    ev.detalle.includes('SOS LA GUAIRA') &&
    ev.detalle.includes('Sin empresa asignada') &&
    ev.detalle.includes('Proveedor / Beneficiario') &&
    ev.detalle.includes('Nota modificada: «Nota inicial» → «Nota final»')
  ));
  ok('timeline reconstruye eliminación de abono/comprobante desde audit_log', timeline.some((ev) =>
    ev.by === 'Pedro Gómez' &&
    ev.titulo.includes('eliminado') &&
    ev.detalle && ev.detalle.includes('987654')
  ));
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLa bitácora muestra "En espera: no → sí", no "en_espera: false → true".`);
