// Prueba de la máquina de apoyo y del horómetro en el parte diario del Surtidor (02-nov-2026).
// Transpila src/lib/combustibleApoyo.ts con typescript y revisa la fuente de las pantallas.
// Datos sintéticos. Uso: node scripts/test-comb-apoyo.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import ts from 'typescript';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const fuente = leer('src/lib/combustibleApoyo.ts');
const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = path.join(raiz, 'scripts', `.tmp-comb-apoyo-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
let L;
try {
  L = await import(pathToFileURL(tmp).href);
} finally {
  fs.unlinkSync(tmp);
}

let ok = 0, fallas = 0;
const check = (nombre, cond) => {
  if (cond) ok++;
  else { fallas++; console.log('FALLA:', nombre); }
};

// Interruptor apagado hasta que exista la base
check('APOYO_ACTIVO encendido (columnas creadas el 02-nov)', L.APOYO_ACTIVO === true);

// esDeApoyo
check('apoyo sin máquina ni vehículo', L.esDeApoyo({ machinery_id: null, vehicle_id: null, apoyo_nombre: 'Retro prestada' }));
check('con machinery_id no es apoyo', !L.esDeApoyo({ machinery_id: 'm1', apoyo_nombre: 'X' }));
check('sin nombre no es apoyo', !L.esDeApoyo({ machinery_id: null, apoyo_nombre: '   ' }));
check('null no es apoyo', !L.esDeApoyo(null));

// claveApoyo: acentos, mayúsculas, espacios y guiones de placa no separan
const a = L.claveApoyo({ apoyo_nombre: 'Excavadora  Azul', apoyo_placa: 'AB-12 3' });
const b = L.claveApoyo({ apoyo_nombre: 'excavadora azul', apoyo_placa: 'ab123' });
check('clave normaliza nombre y placa', a === b);
check('placa distinta separa', a !== L.claveApoyo({ apoyo_nombre: 'Excavadora Azul', apoyo_placa: 'ZZ999' }));
check('acentos', L.normalizarApoyo('Grúa Pequeña') === 'grua pequena');

// etiquetaEquipo
const maq = [{ id: 'm1', code: 'EQ-001' }];
const veh = [{ id: 'v1', name: 'Camioneta Prueba' }];
check('etiqueta máquina', L.etiquetaEquipo({ machinery_id: 'm1' }, maq, veh) === 'EQ-001');
check('etiqueta vehículo', L.etiquetaEquipo({ vehicle_id: 'v1' }, maq, veh) === 'Camioneta Prueba');
check('etiqueta apoyo', L.etiquetaEquipo({ apoyo_nombre: ' Retro prestada ' }, maq, veh) === '🆘 Retro prestada');
check('etiqueta General', L.etiquetaEquipo({}, maq, veh) === 'General');

// validarApoyo
check('sin nombre falla', typeof L.validarApoyo({ nombre: '', litros: 10 }) === 'string');
check('nombre corto falla', typeof L.validarApoyo({ nombre: 'ab', litros: 10 }) === 'string');
check('litros 0 falla', typeof L.validarApoyo({ nombre: 'Retro', litros: 0 }) === 'string');
check('litros NaN falla', typeof L.validarApoyo({ nombre: 'Retro', litros: NaN }) === 'string');
check('válido', L.validarApoyo({ nombre: 'Retro', litros: 12.5 }) === null);

// armarFilaApoyo
const fila = L.armarFilaApoyo({
  nombre: ' Retro prestada ', placa: '', serial: 'SER-1', empresa: 'Empresa Ejemplo',
  fotosMaquina: ['u1', '', 'u2'], fotosSurtido: ['s1'], litros: 40, tankId: 't1', fecha: '2030-01-02T10:00:00',
  contadorIni: 100, contadorFin: 140, horometro: 0, autorizadoPor: 'Persona Prueba', creadoPor: 'uid',
  precioLitro: 0.5, nota: ' nota ', conNota: true,
});
check('asset_kind maquinaria', fila.asset_kind === 'maquinaria');
check('machinery_id null', fila.machinery_id === null && fila.vehicle_id === null);
check('nombre recortado', fila.apoyo_nombre === 'Retro prestada');
check('placa vacía = null', fila.apoyo_placa === null);
check('fotos de la máquina sin vacíos', JSON.stringify(fila.apoyo_fotos) === '["u1","u2"]');
check('fotos del surtido en photos', JSON.stringify(fila.photos) === '["s1"]');
check('litros manuales', fila.liters === 40 && fila.tank_id === 't1');
check('contadores', fila.fuel_start === 100 && fila.fuel_end === 140);
check('horómetro 0 = null', fila.hourmeter_h === null);
check('fecha recortada', fila.dispatch_date === '2030-01-02');
check('monto', fila.total_amount === 20);
check('nota con interruptor', fila.notes === 'nota');
const sinNota = L.armarFilaApoyo({ nombre: 'Retro', litros: 5, tankId: null, fecha: '2030-01-02', nota: 'x', conNota: false });
check('sin columna notes no la nombra', !('notes' in sinNota));

// agruparApoyo
const g = L.agruparApoyo([
  { id: '1', apoyo_nombre: 'Retro', apoyo_placa: 'A1', liters: 10 },
  { id: '2', apoyo_nombre: 'retro', apoyo_placa: 'a-1', liters: 5.5, apoyo_empresa: 'Empresa Ejemplo' },
  { id: '3', apoyo_nombre: 'Grúa', liters: 30 },
  { id: '4', machinery_id: 'm1', liters: 99 },
]);
check('dos grupos (ignora catálogo)', g.length === 2);
check('mayor consumo primero', g[0].nombre === 'Grúa' && g[0].litros === 30);
check('suma del grupo', g[1].litros === 15.5 && g[1].surtidos.length === 2);
check('empresa tomada del grupo', g[1].empresa === 'Empresa Ejemplo');

// Fuente: SurtidorMovil
const sm = leer('src/components/combustible/SurtidorMovil.tsx');
check('opción apoyo detrás del interruptor', /\{APOYO_ACTIVO && \(\s*<TouchableOpacity/.test(sm));
check('fotos de la máquina con cámara y galería', sm.includes("subirFotoApoyo('camara')") && sm.includes("subirFotoApoyo('galeria')"));
check('insert usa armarFilaApoyo', sm.includes('armarFilaApoyo({'));
check('parte diario: horómetro de inspectores', sm.includes('cargarHorometros(') && sm.includes('horometroIni: h?.inicial ?? null'));
check('parte diario: horas del horómetro, no del contador', sm.includes('const horas = horasHorometro(h);') && !/Number\(d\.fuel_end\) - Number\(d\.fuel_start\)/.test(sm));
check('parte diario: final cae a hourmeter_h', sm.includes('h?.final ?? (d.hourmeter_h'));
check('nunca escribe en machine_rounds', !/from\('machine_rounds'\)/.test(sm));
check('apoyo_* solo dentro de lib o detrás del interruptor (no en select)', !/select\([^)]*apoyo_/.test(sm));

// Fuente: panel y pestaña
const panel = leer('src/components/combustible/MaquinasApoyoPanel.tsx');
check('panel no consulta con interruptor apagado', /if \(!APOYO_ACTIVO\) return;/.test(panel));
check('panel usa select(*)', panel.includes(".select('*')") && !/select\('[^*][^']*apoyo_/.test(panel));
check('panel update con select(id)', panel.includes(".select('id')") && panel.includes('No se guardó'));
check('panel full en consumos', panel.includes("levelMeets(moduleLevel('consumos'), 'full')"));
check('panel cámara y galería', panel.includes("agregarFoto('camara')") && panel.includes("agregarFoto('galeria')"));
check('panel modales con zIndex 9999', (panel.match(/zIndex: 9999/g) || []).length >= 2);
const cs = leer('src/screens/CombustibleScreen.tsx');
check('pestaña apoyo', cs.includes("key: 'apoyo'") && cs.includes("t.key === 'apoyo' && canSee('consumos')"));

// Manuales
check('manual md', leer('docs/MANUAL-USUARIO.md').includes('máquinas de apoyo y horómetro en el parte diario'));
check('manual app', leer('src/screens/ManualScreen.tsx').includes('MÁQUINAS DE APOYO Y HORÓMETRO EN EL PARTE DIARIO'));

console.log(`${ok} ok, ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
