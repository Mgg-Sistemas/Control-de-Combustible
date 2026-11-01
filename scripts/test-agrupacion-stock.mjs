import { agruparSolicitudesStock } from '../src/lib/solicitudMaterial.ts';

let pass = 0, fail = 0;
const assert = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
};

console.log('🧪 Iniciando pruebas de agrupación de solicitudes de stock...');

// Caso 1: Lote nuevo con tag explícito [ORDEN: SOL-0002]
const loteNuevo = [
  {
    id: '1',
    code: 'SOL-0002',
    item_id: 'i1',
    item_name: 'Filtro de Aceite',
    qty: 2,
    unit: 'UND',
    urgency: 'alta',
    status: 'pendiente',
    solicitante_nombre: 'Neylur Aguilera',
    area: 'FABRICACIÓN DE CONTENEDORES',
    created_at: '2026-10-25T15:00:00Z',
    reason: '[ORDEN: SOL-0002] [Destino: Fabricación]',
  },
  {
    id: '2',
    code: 'SOL-0003',
    item_id: 'i2',
    item_name: 'Filtro de Combustible',
    qty: 1,
    unit: 'UND',
    urgency: 'alta',
    status: 'pendiente',
    solicitante_nombre: 'Neylur Aguilera',
    area: 'FABRICACIÓN DE CONTENEDORES',
    created_at: '2026-10-25T15:00:01Z',
    reason: '[ORDEN: SOL-0002] [Destino: Fabricación]',
  },
  {
    id: '3',
    code: 'SOL-0004',
    item_id: 'i3',
    item_name: 'Aceite 15W40',
    qty: 4,
    unit: 'GAL',
    urgency: 'normal',
    status: 'pendiente',
    solicitante_nombre: 'Neylur Aguilera',
    area: 'FABRICACIÓN DE CONTENEDORES',
    created_at: '2026-10-25T15:00:02Z',
    reason: '[ORDEN: SOL-0002] [Destino: Fabricación]',
  },
];

const grupos1 = agruparSolicitudesStock(loteNuevo);
assert('Agrupa 3 registros con tag de orden en 1 solo grupo', grupos1.length === 1);
assert('El código de lote es SOL-0002 … SOL-0004', grupos1[0].codigoLote.includes('SOL-0002') && grupos1[0].codigoLote.includes('SOL-0004'));
assert('El total de ítems es 3', grupos1[0].totalItems === 3);
assert('El estado consolidado es pendiente', grupos1[0].estadoGrupo === 'pendiente');
assert('Limpia el tag de razón para que no se muestre [ORDEN: ...]', !grupos1[0].items[0].cleanReason?.includes('[ORDEN:'));

// Caso 2: Solicitudes históricas sin tag [ORDEN: ...] del mismo solicitante y tiempo cercano (< 10 min)
const historicas = [
  {
    id: 'h1',
    code: 'SOL-0010',
    item_id: 'i10',
    item_name: 'Disco de Corte',
    qty: 10,
    unit: 'UND',
    urgency: 'normal',
    status: 'pendiente',
    solicitante_nombre: 'Osma Taller',
    machinery_id: 'mach-1',
    created_at: '2026-10-25T10:00:00Z',
    reason: 'Para reparación de brazo',
  },
  {
    id: 'h2',
    code: 'SOL-0011',
    item_id: 'i11',
    item_name: 'Electrodos 7018',
    qty: 5,
    unit: 'KG',
    urgency: 'normal',
    status: 'despachado',
    solicitante_nombre: 'Osma Taller',
    machinery_id: 'mach-1',
    created_at: '2026-10-25T10:01:00Z',
    reason: 'Para soldadura',
  },
];

const grupos2 = agruparSolicitudesStock(historicas);
assert('Agrupa solicitudes históricas con mismo solicitante y destino dentro de 10 min', grupos2.length === 1);
assert('Detecta estado parcial cuando 1 está despachado y 1 pendiente', grupos2[0].estadoGrupo === 'parcial');
assert('Registra 1 despachado de 2 en el resumen', grupos2[0].despachados === 1 && grupos2[0].totalItems === 2);

// Caso 3: Solicitudes de diferentes solicitantes o tiempos lejanos
const separadas = [
  {
    id: 's1',
    code: 'SOL-0020',
    solicitante_nombre: 'Persona A',
    created_at: '2026-10-25T08:00:00Z',
    status: 'pendiente',
  },
  {
    id: 's2',
    code: 'SOL-0021',
    solicitante_nombre: 'Persona B',
    created_at: '2026-10-25T08:00:00Z',
    status: 'pendiente',
  },
  {
    id: 's3',
    code: 'SOL-0022',
    solicitante_nombre: 'Persona A',
    created_at: '2026-10-25T16:00:00Z', // 8 horas después
    status: 'pendiente',
  },
];

const grupos3 = agruparSolicitudesStock(separadas);
assert('No mezcla solicitudes de diferentes solicitantes ni tiempos distantes', grupos3.length === 3);

console.log(`\nResultado: ${pass} OK · ${fail} FALLOS`);
if (fail > 0) process.exit(1);
