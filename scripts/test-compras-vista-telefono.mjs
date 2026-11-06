import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const cuentasSrc = fs.readFileSync(path.join(root, 'src/screens/CuentasScreen.tsx'), 'utf8');
const comprasSrc = fs.readFileSync(path.join(root, 'src/screens/ComprasScreen.tsx'), 'utf8');
const solicitudesSrc = fs.readFileSync(path.join(root, 'src/screens/SolicitudesCompraTab.tsx'), 'utf8');
const requerimientoSrc = fs.readFileSync(path.join(root, 'src/screens/RequerimientoTab.tsx'), 'utf8');
const historicoSrc = fs.readFileSync(path.join(root, 'src/screens/HistoricoComprasTab.tsx'), 'utf8');

// 1. ComprasScreen: las sub-pestañas superiores deben envolver (flexWrap: 'wrap') y adaptarse a teléfono (isPhone)
assert.match(
  comprasSrc,
  /const isPhone = viewportW < 768/,
  'ComprasScreen debe detectar vista de teléfono (viewportW < 768)'
);
assert.match(
  comprasSrc,
  /flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*paddingHorizontal:\s*isPhone/,
  'La barra superior de sub-pestañas de Compras debe usar flexWrap: wrap para que ninguna pestaña quede cortada en teléfono'
);

// 2. CuentasScreen (Por Pagar / Por Cobrar):
// - Fila de botones de cabecera con flexShrink: 1 y maxWidth: '100%'
assert.match(
  cuentasSrc,
  /flexDirection:\s*'row',\s*gap:\s*spacing\.xs,\s*alignItems:\s*'center',\s*flexWrap:\s*'wrap',\s*flexShrink:\s*1,\s*maxWidth:\s*'100%'/,
  'La fila de botones de cabecera en CuentasScreen debe tener flexShrink: 1 y maxWidth: 100% para envolver en teléfono'
);

// - Tarjetas Quick con flexWrap: 'wrap' y minWidth: 100
assert.match(
  cuentasSrc,
  /minWidth:\s*100,\s*borderWidth:\s*1,\s*borderColor:\s*colors\.border/,
  'Las tarjetas KPI Quick de CuentasScreen deben tener minWidth para adaptarse en pantallas angostas'
);

// - Fichas de Empresa, Estados y Fechas en CuentasScreen envuelven con flexWrap: 'wrap' sin recortarse a la derecha
assert.match(
  cuentasSrc,
  /Fichas rápidas siempre accesibles y visibles sin recorte en teléfono[\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap'/,
  'Las fichas rápidas de Empresa en CuentasScreen deben usar flexWrap: wrap'
);
assert.match(
  cuentasSrc,
  /Filtros de estados prioritarios de Por Pagar[\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap'/,
  'Los filtros de estado de Por Pagar deben usar flexWrap: wrap para no cortarse en teléfono'
);
assert.match(
  cuentasSrc,
  /📅 Filtrar por Fecha:[\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*gap:\s*6,\s*width:\s*'100%',\s*flexShrink:\s*1/,
  'Los botones de Filtrar por Fecha en CuentasScreen deben usar flexWrap: wrap y width: 100%'
);

// 3. SolicitudesCompraTab, RequerimientoTab e HistoricoComprasTab: chips de empresa, estado y fecha con flexWrap: 'wrap'
assert.match(
  solicitudesSrc,
  /Chips de filtro por estado[\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*gap:\s*6,\s*marginBottom:\s*spacing\.md,\s*width:\s*'100%'/,
  'Los chips de estado en SolicitudesCompraTab deben usar flexWrap: wrap'
);
assert.match(
  requerimientoSrc,
  /flexDirection:\s*'row',\s*gap:\s*spacing\.xs,\s*alignItems:\s*'center',\s*flexWrap:\s*'wrap',\s*flexShrink:\s*1,\s*maxWidth:\s*'100%'/,
  'Los botones superiores de RequerimientoTab deben tener flexShrink: 1 y maxWidth: 100%'
);
assert.match(
  historicoSrc,
  /Chips de tipo de movimiento[\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*gap:\s*6/,
  'Los chips de tipo de movimiento en HistoricoComprasTab deben usar flexWrap: wrap'
);

console.log('✅ Todas las pruebas de vista móvil en Compras y Por Pagar pasaron correctamente.');

