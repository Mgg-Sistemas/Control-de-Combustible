// 🔧 Candados de los filtros de Fabricación (Mangueras) — 13-oct-2026.
//
// Pedido: «hace falta poder seleccionar por empresa, por maquinaria individual
// y por rango de fecha» (la maquinaria individual ya existía). Reglas vigiladas:
// los filtros alcanzan lista, total y PDF; nacen apagados; y el papel DECLARA
// lo filtrado en su subtítulo (un filtro cambia el total, no se esconde).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const scr = leer('src/screens/ManguerasScreen.tsx');
// Empresa.
ok('🏢 el filtro de empresa existe y corta por la DUEÑA de la máquina (catálogo)',
  scr.includes("machineryMap[h.machinery_id]?.companyName === empresaFilter"));
ok('🏢 con empresa elegida, las externas quedan fuera (y la pantalla lo dice)',
  scr.includes('!h.is_external && !!h.machinery_id && machineryMap') && scr.includes('las externas quedan fuera'));
ok('🏢 tocar «Externas» suelta la empresa (serían filtros contradictorios)',
  scr.includes("setMachineFilterId(''); setMachineQuery(''); setEmpresaFilter('');"));
ok('🏢 nace apagado: empresaFilter arranca vacío', scr.includes("const [empresaFilter, setEmpresaFilter] = useState('');"));
// Fechas.
ok('📅 el rango corta por service_date, ambos extremos inclusive',
  scr.includes(".filter((h) => !conFechas || (String(h.service_date ?? '').slice(0, 10) >= fDesde && String(h.service_date ?? '').slice(0, 10) <= fHasta))"));
ok('📅 nace apagado (conFechas = false): sin tocar, todo sale igual', scr.includes('const [conFechas, setConFechas] = useState(false);'));
ok('📅 por defecto propone del 1.º del mes a hoy (día de Caracas)',
  scr.includes("caracasToday().slice(0, 8) + '01'") && scr.includes('useState(() => caracasToday())'));
ok('📅 usa el calendario de la casa (DateField), no texto libre',
  scr.includes("import { DateField } from '../components/DateField';") && scr.includes('<DateField value={fDesde} onChange={setFDesde} />'));
ok('📅 avisa si «hasta» quedó antes de «desde»', scr.includes('«Hasta» no puede ser antes de «desde».'));
// El PDF los respeta y los declara.
ok('⭐ el PDF sale de las filas FILTRADAS (shown), como siempre', scr.includes('rows: shown,'));
ok('⭐ el PDF declara empresa y rango en el subtítulo',
  scr.includes('empresaFilterLabel: empresaFilter || undefined,') && scr.includes('rangoLabel: conFechas ?'));
// El total sigue sobre lo filtrado.
ok('el total invertido se calcula sobre shown (lo filtrado)', scr.includes('const total = shown.reduce((s, h) => s + (Number(h.cost_usd) || 0), 0);'));
// La pantalla sigue sin escribir nada nuevo por estos filtros (son memos de cliente).
ok('los filtros son de pantalla: no agregan ninguna consulta nueva a la base',
  !/empresaFilter[\s\S]{0,200}from\(/.test(scr));

const rep = leer('src/lib/hoseServiceReport.ts');
ok('⭐ el reporte acepta y declara Empresa y rango',
  rep.includes('empresaFilterLabel?: string;') && rep.includes('rangoLabel?: string;')
  && rep.includes('`Empresa: ${esc(opts.empresaFilterLabel)}`') && rep.includes('`Del ${esc(opts.rangoLabel)}`'));
ok('la máquina filtrada se sigue declarando (lo de siempre)', rep.includes('`Máquina: ${esc(machineFilterLabel)}`'));

console.log(`\n🔧 Mangueras filtros: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Empresa, máquina y fechas: filtran todo y el papel lo dice.');
