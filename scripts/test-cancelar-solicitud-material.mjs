// 🧪 Test de verificación automatizada: Cancelación de Solicitudes en Pedir Material / Repuesto
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cache = new Map();
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => {
    if (id === 'react-native') return { Platform: { OS: 'web' } };
    if (id === 'expo-print' || id === 'expo-sharing' || id === 'expo-file-system') return {};
    if (id.startsWith('.')) {
      const cleanId = id.replace(/\.ts$/, '');
      return loadTs(path.join(path.dirname(srcPath), `${cleanId}.ts`));
    }
    return origRequire(id);
  };
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const {
  formatCancellationNote,
  isCancelledNote,
  parseCancelacionNote,
  extraerCancelacionCompra,
  parseRejectionNote,
  puedeCancelarSolicitudStock,
  puedeCancelarSolicitudCompra,
  agruparSolicitudesStock,
  MOTIVOS_CANCELACION_RAPIDOS,
} = loadTs(path.join(ROOT, 'src/lib/solicitudMaterial.ts'));

const { calcularEstadoRequerimiento } = loadTs(path.join(ROOT, 'src/lib/requerimientoFlujo.ts'));

const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`  ✗ ${name}`);
  }
};

console.log('🧪 Iniciando pruebas de Cancelación de Solicitudes (Almacén y Compra Técnica)...\n');

// 1. Formato y parseo de nota de cancelación
const nota = formatCancellationNote('Osma Taller', 'Ya no se necesita — Se reparó en prensa');
ok('1.1 formatCancellationNote genera prefijo estructurado', nota.startsWith('[Cancelado por solicitante: Osma Taller · '));
ok('1.2 isCancelledNote detecta nota de cancelación', isCancelledNote(nota) === true);
ok('1.3 isCancelledNote devuelve false para un rechazo normal de almacén', isCancelledNote('[Rechazado por: Jefe Almacén · 28/10/2026]: Sin stock') === false);

const parsed = parseCancelacionNote(nota);
ok('1.4 parseCancelacionNote extrae autor y motivo correctamente',
  parsed.isCancelled === true &&
  parsed.cancelledBy === 'Osma Taller' &&
  parsed.note === 'Ya no se necesita — Se reparó en prensa'
);

const rejCompat = parseRejectionNote(nota);
ok('1.5 parseRejectionNote distingue isCancelled = true',
  rejCompat.isCancelled === true &&
  rejCompat.rejectedBy === 'Osma Taller' &&
  rejCompat.note === 'Ya no se necesita — Se reparó en prensa'
);

// 2. Permisos y reglas para cancelar Solicitudes de Existencia (Almacén)
const itemPendiente = {
  id: 'st-1',
  code: 'SOL-0100',
  status: 'pendiente',
  created_by: 'user-osma',
  solicitante_nombre: 'Osma Taller',
};
const itemDespachado = {
  id: 'st-2',
  code: 'SOL-0101',
  status: 'despachado',
  created_by: 'user-osma',
  solicitante_nombre: 'Osma Taller',
};

ok('2.1 El creador puede cancelar su solicitud de almacén pendiente',
  puedeCancelarSolicitudStock(itemPendiente, 'user-osma', 'Osma Taller', false).ok === true
);
ok('2.2 Otro usuario sin rol admin NO puede cancelar solicitud ajena',
  puedeCancelarSolicitudStock(itemPendiente, 'user-otro', 'Pedro Perez', false).ok === false
);
ok('2.3 Un administrador SÍ puede cancelar solicitud pendiente',
  puedeCancelarSolicitudStock(itemPendiente, 'user-admin', 'Admin', true).ok === true
);
ok('2.4 BLOQUEA cancelar solicitud que ya fue despachada por almacén',
  puedeCancelarSolicitudStock(itemDespachado, 'user-osma', 'Osma Taller', true).ok === false
);

// Pedido agrupado parcial (1 despachado + 2 pendientes)
const grupoParcial = agruparSolicitudesStock([
  { ...itemDespachado, reason: '[ORDEN: SOL-0100]', created_at: '2026-10-29T10:00:00Z' },
  { ...itemPendiente, id: 'st-3', code: 'SOL-0102', reason: '[ORDEN: SOL-0100]', created_at: '2026-10-29T10:00:05Z' },
  { ...itemPendiente, id: 'st-4', code: 'SOL-0103', reason: '[ORDEN: SOL-0100]', created_at: '2026-10-29T10:00:10Z' },
])[0];

const permParcial = puedeCancelarSolicitudStock(grupoParcial, 'user-osma', 'Osma Taller', false);
ok('2.5 En pedido parcial permite cancelar únicamente los 2 ítems pendientes',
  permParcial.ok === true && permParcial.pendientesCount === 2
);

// Pedido totalmente cancelado por el usuario
const grupoCancelado = agruparSolicitudesStock([
  {
    ...itemPendiente,
    status: 'rechazado',
    rejection_note: nota,
    reason: '[ORDEN: SOL-0200]',
    created_at: '2026-10-29T11:00:00Z',
  },
])[0];
ok('2.6 agruparSolicitudesStock marca todoCanceladoPorUsuario = true cuando todos fueron cancelados por el solicitante',
  grupoCancelado.todoCanceladoPorUsuario === true && grupoCancelado.canceladosCount === 1
);

// 3. Permisos y reglas para cancelar Solicitudes de Compra Técnica (Requerimientos)
const reqPendiente = {
  id: 'req-1',
  code: 'REQ-0500',
  status: 'pendiente',
  requested_by: 'user-osma',
  solicitante_nombre: 'Osma Taller',
  items: [{ name: 'Bomba Hidráulica', qty: 1, unit: 'UND' }],
};
const reqAclaratoria = {
  ...reqPendiente,
  id: 'req-2',
  status: 'aclaratoria_solicitada',
};
const reqAprobado = {
  ...reqPendiente,
  id: 'req-3',
  status: 'aprobado',
};
const reqPagado = {
  ...reqPendiente,
  id: 'req-4',
  status: 'esperando_recepcion',
  pagado: true,
};
const reqRecibido = {
  ...reqPendiente,
  id: 'req-5',
  status: 'recibido',
};

ok('3.1 Permite cancelar solicitud de compra en estado pendiente al solicitante',
  puedeCancelarSolicitudCompra(reqPendiente, 'user-osma', 'Osma Taller', false).ok === true
);
ok('3.2 Permite cancelar solicitud de compra en estado aclaratoria_solicitada',
  puedeCancelarSolicitudCompra(reqAclaratoria, 'user-osma', 'Osma Taller', false).ok === true
);
ok('3.3 Bloquea cancelar solicitud de compra a usuario ajeno no admin',
  puedeCancelarSolicitudCompra(reqPendiente, 'user-ajeno', 'Otro', false).ok === false
);
ok('3.4 Bloquea cancelar solicitud de compra ya aprobada, pagada o recibida',
  !puedeCancelarSolicitudCompra(reqAprobado, 'user-osma', 'Osma Taller', true).ok &&
  !puedeCancelarSolicitudCompra(reqPagado, 'user-osma', 'Osma Taller', true).ok &&
  !puedeCancelarSolicitudCompra(reqRecibido, 'user-osma', 'Osma Taller', true).ok
);

// 4. Flujo de estado en requerimientoFlujo.ts
const reqCancelada = {
  ...reqPendiente,
  status: 'rechazado',
  decision_note: nota,
};
const estadoFlujo = calcularEstadoRequerimiento(reqCancelada, 1, null);
ok('4.1 calcularEstadoRequerimiento muestra "🚫 Cancelada por Solicitante" cuando fue cancelada por el usuario',
  estadoFlujo.icon === '🚫' &&
  estadoFlujo.short === 'Cancelada' &&
  estadoFlujo.label.includes('Cancelada por Solicitante')
);
ok('4.2 extraerCancelacionCompra recupera autor y motivo de la cancelación',
  extraerCancelacionCompra(reqCancelada).isCancelled === true &&
  extraerCancelacionCompra(reqCancelada).cancelledBy === 'Osma Taller'
);

// 5. Verificación de integración en SolicitudMaterialScreen.tsx
const screen = leer('src/screens/SolicitudMaterialScreen.tsx');
ok('5.1 SolicitudMaterialScreen incluye modal y función confirmarCancelacion',
  screen.includes('confirmarCancelacion') && screen.includes('MODAL 4: CONFIRMAR CANCELACIÓN DE SOLICITUD')
);
ok('5.2 Incluye chips rápidos de motivo en 1 toque',
  MOTIVOS_CANCELACION_RAPIDOS.length >= 4 && screen.includes('MOTIVOS_CANCELACION_RAPIDOS')
);
ok('5.3 Protege contra condiciones de carrera (.eq("status", "pendiente") y .select("id"))',
  screen.includes(".eq('status', 'pendiente')") &&
  screen.includes(".in('status', ['pendiente', 'aclaratoria_solicitada'])") &&
  screen.includes(".select('id')")
);
ok('5.4 No envía columna inexistente updated_at a inventory_requirements',
  !screen.slice(screen.indexOf('const confirmarCancelacion'), screen.indexOf('const confirmarCancelacion') + 3800).includes('updated_at')
);

console.log(`\n🎉 Resultado: ${pass} OK · ${fail} FALLO(S)`);
if (fail > 0) {
  process.exit(1);
}

