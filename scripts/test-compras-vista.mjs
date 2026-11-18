// 🧪 Pruebas unitarias de vistas de Compras (Actual · Kanban · Lista) (18-nov-2026)
// Verifica:
// 1. Cobertura 100% de estados en Solicitudes, Requerimientos y Por Pagar (0 órdenes huérfanas).
// 2. Cuadre exacto de conteos y totales USD/Saldo por columna con el total filtrado.
// 3. Detección y priorización de órdenes urgentes.
// 4. Persistencia de preferencia de vista por contexto y usuario (con fallback seguro a 'actual').

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-compras-vista-'));

function transpile(rel) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const dest = path.join(TMP, path.basename(rel, '.ts') + '.mjs');
  fs.writeFileSync(dest, out, 'utf8');
  return dest;
}

const vistaMod = await import(pathToFileURL(transpile('src/lib/comprasVista.ts')).href);
const {
  MODO_VISTA_DEFAULT,
  COLUMNAS_SOLICITUDES,
  COLUMNAS_REQUERIMIENTOS,
  COLUMNAS_POR_PAGAR,
  normalizarModoVista,
  obtenerVistaPreferidaCompras,
  guardarVistaPreferidaCompras,
  esOrdenUrgente,
  resolverColumnaSolicitud,
  resolverColumnaRequerimiento,
  resolverColumnaPorPagar,
  construirColumnasKanban,
  construirFilasLista,
} = vistaMod;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name);
    console.error(`  ✗ ${name}`);
  }
};

console.log('\n🗂️ Probando lógica pura de Compras (Actual / Kanban / Lista):\n');

// 1. Cobertura total de estados en Requerimientos (11 CodigoEstadoDinamico + RequirementStatus)
const estadosReq = [
  'esperando_proveedor',
  'esperando_cotizacion',
  'esperando_aprobacion_gg',
  'esperando_pago',
  'aprobado',
  'esperando_recepcion',
  'recibido',
  'despachado',
  'entrega_directa',
  'rechazado',
  'aclaratoria_solicitada',
  'pendiente',
  'pagado',
  'cancelado',
];
const colIdsReq = new Set(COLUMNAS_REQUERIMIENTOS.map((c) => c.id));
for (const st of estadosReq) {
  const col = resolverColumnaRequerimiento({ estadoCodigo: st, status: st });
  ok(`Requerimientos: estado "${st}" cae en columna válida (${col})`, colIdsReq.has(col));
}

// 2. Cobertura total de estados en Solicitudes (convertidas y sin convertir)
const colIdsSol = new Set(COLUMNAS_SOLICITUDES.map((c) => c.id));
for (const yaConv of [false, true]) {
  for (const st of estadosReq) {
    const col = resolverColumnaSolicitud({
      estadoCodigo: st,
      status: st,
      yaConvertido: yaConv,
      requiereAprobacionGG: st === 'esperando_aprobacion_gg',
    });
    ok(
      `Solicitudes (convertido=${yaConv}): estado "${st}" cae en columna válida (${col})`,
      colIdsSol.has(col),
    );
  }
}

// 3. Cobertura total de estados en Por Pagar (situacion × aprobacionEstado)
const situaciones = ['vencida', 'por_vencer', 'pendiente', 'pagada', 'anulada'];
const aprobaciones = ['esperando_aprobacion', 'esperando_pago', 'pagada', 'no_aplica'];
const colIdsCxp = new Set(COLUMNAS_POR_PAGAR.map((c) => c.id));
for (const sit of situaciones) {
  for (const aprob of aprobaciones) {
    const col = resolverColumnaPorPagar({ situacion: sit, aprobacionEstado: aprob });
    ok(`Por Pagar (${sit} × ${aprob}) cae en columna válida (${col})`, colIdsCxp.has(col));
  }
}

// 4. Cuadre exacto de totales y conteos en Kanban y Lista
const mockItems = [
  {
    id: '1', origen: 'requerimientos', codigo: 'REQ-001', titulo: 'Filtros',
    empresaNombre: 'GT', solicitanteNombre: 'Juan', proveedorNombre: 'Prov A',
    maquinariaTexto: 'CAT 320 · Placa: S/P', itemsCount: 2,
    estadoCodigo: 'esperando_proveedor', estadoLabel: 'Falta Prov', estadoTono: 'warning',
    columnaId: resolverColumnaRequerimiento({ estadoCodigo: 'esperando_proveedor' }),
    montoUsd: 100.15, saldoUsd: 100.15, monedaBadge: 'USD', montoBsTexto: null,
    prioridad: 'alta', ...esOrdenUrgente({ prioridad: 'alta' }),
    fechaIso: '2026-11-18T10:00:00Z', fechaCorta: '18/11', raw: {},
  },
  {
    id: '2', origen: 'requerimientos', codigo: 'REQ-002', titulo: 'Aceite',
    empresaNombre: 'SOS', solicitanteNombre: 'Pedro', proveedorNombre: 'Prov B',
    maquinariaTexto: 'VOLTEO · Placa: A06CW8J', itemsCount: 1,
    estadoCodigo: 'aprobado', estadoLabel: 'Por Pagar', estadoTono: 'info',
    columnaId: resolverColumnaRequerimiento({ estadoCodigo: 'aprobado' }),
    montoUsd: 250.35, saldoUsd: 150.20, monedaBadge: 'BS', montoBsTexto: 'Bs 15.000',
    prioridad: 'media', ...esOrdenUrgente({ prioridad: 'media' }),
    fechaIso: '2026-11-18T12:00:00Z', fechaCorta: '18/11', raw: {},
  },
  {
    id: '3', origen: 'requerimientos', codigo: 'REQ-003', titulo: 'Cauchos',
    empresaNombre: 'GT', solicitanteNombre: 'Ana', proveedorNombre: 'Prov C',
    maquinariaTexto: null, itemsCount: 4,
    estadoCodigo: 'recibido', estadoLabel: 'Recibido', estadoTono: 'success',
    columnaId: resolverColumnaRequerimiento({ estadoCodigo: 'recibido' }),
    montoUsd: 840.50, saldoUsd: 0, monedaBadge: 'USDT', montoBsTexto: null,
    prioridad: null, ...esOrdenUrgente({ prioridad: null }),
    fechaIso: '2026-11-17T08:00:00Z', fechaCorta: '17/11', raw: {},
  },
];

const kanban = construirColumnasKanban('requerimientos', mockItems);
const sumaCount = kanban.columnas.reduce((s, c) => s + c.count, 0);
const sumaUsd = Math.round(kanban.columnas.reduce((s, c) => s + c.totalUsd, 0) * 100) / 100;
const sumaSaldo = Math.round(kanban.columnas.reduce((s, c) => s + c.totalSaldoUsd, 0) * 100) / 100;
const sumaUrg = kanban.columnas.reduce((s, c) => s + c.urgentesCount, 0);

ok('Kanban suma de conteos cuadra con totalItems (3)', sumaCount === 3 && kanban.resumen.totalItems === 3);
ok('Kanban suma de montos USD cuadra exacto (1191.00)', sumaUsd === 1191 && kanban.resumen.totalUsd === 1191);
ok('Kanban suma de saldos USD cuadra exacto (250.35)', sumaSaldo === 250.35 && kanban.resumen.totalSaldoUsd === 250.35);
ok('Kanban suma de urgentes cuadra (1)', sumaUrg === 1 && kanban.resumen.totalUrgentes === 1);

const lista = construirFilasLista(mockItems);
ok('Lista ordena urgentes primero (REQ-001)', lista.filas[0].codigo === 'REQ-001');
ok('Lista mantiene exactamente los mismos totales que Kanban', lista.resumen.totalUsd === kanban.resumen.totalUsd);

const kanbanVacio = construirColumnasKanban('por_pagar', []);
ok('Kanban vacío mantiene columnas con count 0', kanbanVacio.columnas.length === COLUMNAS_POR_PAGAR.length && kanbanVacio.resumen.totalItems === 0);

// 5. Urgencia en todos los contextos
ok('Urgente por prioridad=alta', esOrdenUrgente({ prioridad: 'alta' }).esUrgente === true);
ok('Urgente por urgency=urgente', esOrdenUrgente({ urgency: 'urgente' }).esUrgente === true);
ok('Urgente por situacion=vencida', esOrdenUrgente({ situacion: 'vencida' }).esUrgente === true);
ok('No urgente si media/normal/pendiente', esOrdenUrgente({ prioridad: 'media', urgency: 'normal', situacion: 'pendiente' }).esUrgente === false);

// 6. Persistencia local por contexto y usuario
const mapSt = new Map();
const mockStorage = {
  getItem: (k) => mapSt.get(k) ?? null,
  setItem: (k, v) => mapSt.set(k, v),
};
ok('Vista por defecto es actual', MODO_VISTA_DEFAULT === 'actual');
ok('Normaliza valor corrupto a actual', normalizarModoVista('invalido') === 'actual');
ok('Sin guardar retorna actual', obtenerVistaPreferidaCompras('requerimientos', 'u1', mockStorage) === 'actual');
guardarVistaPreferidaCompras('requerimientos', 'kanban', 'u1', mockStorage);
ok('Guarda kanban para requerimientos de u1', obtenerVistaPreferidaCompras('requerimientos', 'u1', mockStorage) === 'kanban');
ok('No contamina solicitudes de u1', obtenerVistaPreferidaCompras('solicitudes', 'u1', mockStorage) === 'actual');
ok('No contamina requerimientos de otro usuario u2', obtenerVistaPreferidaCompras('requerimientos', 'u2', mockStorage) === 'actual');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nResultado: ${pass} OK · ${fail} FALLO(S)\n`);
if (fail > 0) process.exit(1);
