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

// 4. Componentes base (ui.tsx, ListScreen.tsx, RList.tsx) y pantallas generales adaptadas a teléfono (~360px)
const uiSrc = fs.readFileSync(path.join(root, 'src/components/ui.tsx'), 'utf8');
const combustibleSrc = fs.readFileSync(path.join(root, 'src/screens/CombustibleScreen.tsx'), 'utf8');
const tanksSrc = fs.readFileSync(path.join(root, 'src/screens/redesign/TanksShowcase.tsx'), 'utf8');
const inventarioSrc = fs.readFileSync(path.join(root, 'src/screens/InventarioScreen.tsx'), 'utf8');
const equiposSrc = fs.readFileSync(path.join(root, 'src/screens/EquiposScreen.tsx'), 'utf8');
const airesSrc = fs.readFileSync(path.join(root, 'src/screens/AiresAcondicionadosTab.tsx'), 'utf8');
const fletesSrc = fs.readFileSync(path.join(root, 'src/screens/ServicioFletesScreen.tsx'), 'utf8');

assert.match(
  uiSrc,
  /export function ExpandableCard[\s\S]*?<View style=\{\{\s*flex:\s*1,\s*minWidth:\s*0\s*\}\}>\{summary\}<\/View>/,
  'ExpandableCard en ui.tsx debe tener minWidth: 0 en el contenedor de summary para que los hijos con flexWrap no desborden en teléfono'
);
assert.match(
  combustibleSrc,
  / Barra de sub-pestañas [\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap'/,
  'Las 9 sub-pestañas de CombustibleScreen deben envolver con flexWrap: wrap en teléfono'
);
assert.match(
  tanksSrc,
  /flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*marginTop:\s*spacing\.md,\s*gap:\s*spacing\.sm[\s\S]*?Chips de filtro[\s\S]*?flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*padding:\s*spacing\.sm,\s*gap:\s*spacing\.xs/,
  'Los KPIs y chips de filtro de TanksShowcase deben envolver con flexWrap: wrap en pantallas angostas'
);
assert.match(
  inventarioSrc,
  /flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*paddingHorizontal:\s*spacing\.xs,\s*paddingVertical:\s*6,\s*gap:\s*6,\s*width:\s*'100%'/,
  'Las 7 pestañas de InventarioScreen deben envolver con flexWrap: wrap en teléfono'
);
assert.match(
  equiposSrc,
  /Filtrar por clasificación<\/Text>\s*<View style=\{\{\s*flexDirection:\s*'row',\s*flexWrap:\s*'wrap'/,
  'Los chips de clasificación en EquiposScreen deben envolver con flexWrap: wrap en teléfono'
);
assert.match(
  airesSrc,
  /Filtro rápido por Área \/ Ubicación \/ Frente[\s\S]*?<View style=\{\{\s*flexDirection:\s*'row',\s*flexWrap:\s*'wrap'/,
  'Los chips de área en AiresAcondicionadosTab deben envolver con flexWrap: wrap en teléfono'
);
assert.match(
  fletesSrc,
  /Empresa Contratista<\/Text>\s*<View style=\{\{\s*flexDirection:\s*'row',\s*flexWrap:\s*'wrap',\s*gap:\s*6\s*\}\}>/,
  'Los chips de Empresa Contratista en ServicioFletesScreen deben envolver con flexWrap: wrap en teléfono'
);

console.log('✅ Todas las pruebas de vista móvil en todo el sistema pasaron correctamente.');

