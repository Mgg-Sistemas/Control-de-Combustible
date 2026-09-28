/*
 * Test de la FICHA TÉCNICA del Catálogo (`src/lib/fichaTecnicaMaquina.ts`) —
 * 28-sep-2026.
 *
 * QUÉ PEDIDO CUBRE
 *   «en el catalogo de maquinaria, necesito tener un boton que me permita ver e
 *   imprimir la ficha tecnica de la maquinaria y que sea algo como eso que te
 *   envio en el pdf» — el ejemplo: FICHA TÉCNICA XCMG XPE0912 (trituradora),
 *   con estado operativo, especificaciones de placa, foto y anexo fotográfico.
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · LO VACÍO NO SALE. Muchas máquinas del catálogo no tienen peso ni
 *     dimensiones cargadas: un renglón sin dato se OMITE — imprimir «—» en
 *     media ficha la haría ver rota, e inventar un valor sería peor.
 *   · EL ANEXO SOLO CON FOTO DE PLACA. La página 2 del ejemplo es la foto de la
 *     placa; sin `photo_serial_url` no puede existir una página en blanco.
 *   · EL ESCAPE. Marca, encargado y compañía los escribe el usuario y terminan
 *     en el HTML del documento.
 *   · EL BOTÓN DEL CATÁLOGO usa el MISMO estado en vivo que las tarjetas
 *     (liveStatusOf): la ficha no puede decir «Operativa» donde la pantalla
 *     dice «Averiada».
 */
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
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const F = loadTs(path.join(ROOT, 'src/lib/fichaTecnicaMaquina.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

// ── 1) Los textos derivados ─────────────────────────────────────────────────
eq('nombre: marca y modelo', F.nombreDeMaquina({ marca: 'XCMG', modelo: 'XPE0912' }), 'XCMG · XPE0912');
eq('nombre: solo marca', F.nombreDeMaquina({ marca: 'CAT' }), 'CAT');
eq('nombre: cae al tipo histórico', F.nombreDeMaquina({ tipo: 'KOMATSU PC200' }), 'KOMATSU PC200');
eq('nombre: cae al código', F.nombreDeMaquina({ code: 'EXC-01' }), 'EXC-01');
eq('nombre: sin nada dice Equipo', F.nombreDeMaquina({}), 'Equipo');

eq('peso: toneladas y kilos', F.pesoTexto({ weight_ton: 70.83 }), '70,83 t (70.830 kg)');
eq('⭐ peso sin cargar NO se imprime (null, no «0 t»)', F.pesoTexto({}), null);
eq('peso 0 tampoco', F.pesoTexto({ weight_ton: 0 }), null);

eq('dimensiones completas', F.dimensionesTexto({ length_m: 9.43, width_m: 0.6, height_m: 2.95 }),
  'L 9,43 m × An 0,6 m × Al 2,95 m');
eq('⭐ dimensiones parciales: solo lo que hay', F.dimensionesTexto({ length_m: 9.43 }), 'L 9,43 m');
eq('sin dimensiones, null', F.dimensionesTexto({}), null);

eq('tapa doble', F.tapaTexto({ con_tapa: true, tapa_doble: true }), 'Con tapa doble');
eq('tapa sencilla', F.tapaTexto({ con_tapa: true, tapa_doble: false }), 'Con tapa sencilla');
eq('sin tapa', F.tapaTexto({ con_tapa: false }), 'Sin tapa');
eq('⭐ tapa sin dato no imprime renglón', F.tapaTexto({}), null);

eq('aceite: tipo y litros', F.aceiteTexto({ oil_type: '15W-40', oil_capacity_l: 25 }), '15W-40 · 25 L');
eq('aceite: solo tipo', F.aceiteTexto({ oil_type: '15W-40' }), '15W-40');
eq('aceite: nada, null', F.aceiteTexto({}), null);

// El próximo servicio se cuenta desde la BASE del último mantenimiento (+250 h),
// no desde la lectura de hoy — mismo criterio que el informe técnico y alertas.
eq('próximo servicio: base + 250', F.proximoServicioTexto({ last_horometro: 191.1, horometro_base: 100 }), '350 h');
eq('sin base usa la última lectura', F.proximoServicioTexto({ last_horometro: 191.1 }), '441,1 h');
eq('sin lecturas, null', F.proximoServicioTexto({}), null);

// ── 2) El documento ─────────────────────────────────────────────────────────
const XCMG = {
  code: 'BRITADOR-0022', marca: 'XCMG', modelo: 'XPE0912',
  clasificacion: 'Trituradora de Mandíbula Móvil',
  serial: 'XUG09120CSHS00022', weight_ton: 70.83,
  length_m: 9.43, width_m: 0.6, height_m: 2.95,
  companyName: 'GOLDEN TOUCH 1127 CA', companyRif: 'J-123456789',
  encargado: 'El Encargado', last_horometro: 191.1, horometro_base: 0,
  photo_url: 'https://x/equipo.jpg', photo_serial_url: 'https://x/placa.jpg',
};
const HTML = F.fichaTecnicaMaquinaHtml(XCMG, { estado: '✅ Operativa', fecha: '2026-09-28', emitidoPor: 'Sistemas' });

ok('la cabecera dice FICHA TÉCNICA con la clasificación y la insignia',
  HTML.includes('FICHA TÉCNICA') && HTML.includes('Trituradora de Mandíbula Móvil') && HTML.includes('XCMG · XPE0912'));
ok('el estado operativo trae las horas, el estado y el próximo servicio',
  HTML.includes('HORAS DE TRABAJO ACUMULADAS') && HTML.includes('191,1 h')
  && HTML.includes('ESTADO ACTUAL') && HTML.includes('✅ Operativa')
  && HTML.includes('PRÓXIMO SERVICIO (250 H)') && HTML.includes('250 h'));
ok('las especificaciones traen serial, peso y dimensiones del ejemplo',
  HTML.includes('XUG09120CSHS00022') && HTML.includes('70,83 t (70.830 kg)')
  && HTML.includes('L 9,43 m × An 0,6 m × Al 2,95 m'));
ok('la empresa sale con su RIF', HTML.includes('GOLDEN TOUCH 1127 CA (RIF: J-123456789)'));
ok('la foto del equipo sale con su leyenda',
  HTML.includes('https://x/equipo.jpg') && HTML.includes('condición exterior del equipo en terreno'));
ok('⭐ el anexo fotográfico va en PÁGINA APARTE con la foto de la placa',
  HTML.includes('page-break-before:always') && HTML.includes('ANEXO · REGISTRO FOTOGRÁFICO')
  && HTML.includes('https://x/placa.jpg') && HTML.includes('placa de identificación'));
ok('el pie dice quién y cuándo la generó',
  HTML.includes('28/09/2026') && HTML.includes('por Sistemas'));

// ⭐ LO VACÍO NO SALE: una máquina pelada imprime una ficha corta, sin renglones
// en blanco, sin foto y SIN anexo.
const PELADA = F.fichaTecnicaMaquinaHtml({ code: 'EXC-01', marca: 'CAT' });
ok('⭐ sin placa no hay renglón «Placa»', !PELADA.includes('>Placa<'));
ok('⭐ sin peso ni dimensiones no salen esos renglones',
  !PELADA.includes('Peso operativo') && !PELADA.includes('Dimensiones'));
ok('⭐ sin foto de placa NO existe el anexo (nada de página 2 en blanco)',
  !PELADA.includes('ANEXO') && !PELADA.includes('class="anexo"'));
ok('sin horómetro ni estado no sale la sección de estado operativo',
  !PELADA.includes('Estado operativo actual'));
ok('sin pie si no se pasa quién/cuándo', !PELADA.includes('Ficha generada'));

const NADA = F.fichaTecnicaMaquinaHtml({});
ok('una máquina sin nada lo dice, en vez de una tabla vacía',
  NADA.includes('no tiene características cargadas'));

// ⭐ CON LOS COLORES DEL SISTEMA (pedido de la misma tarde): el azul marino de
// todos los reportes (#16324F), no el negro/ámbar del documento de ejemplo.
ok('⭐ la ficha usa el azul del sistema, no el negro/ámbar del ejemplo',
  HTML.includes('#16324F') && !HTML.includes('#F59E0B') && !HTML.includes('#16181D'));

// ⭐ La MISMA ficha sirve para un VEHÍCULO: tanque y km/L salen, y lo que un
// vehículo no tiene (horómetro, aceite, tapa) no se inventa.
const VEH = F.fichaTecnicaMaquinaHtml(
  { code: 'CAMIONETA-01', marca: 'Toyota', modelo: 'Hilux', plate: 'A12BC3D',
    tank_capacity_l: 80, expected_kml: 9.5 },
  { estado: '✅ Activo', fallbackSubtitulo: 'Vehículo' });
ok('⭐ vehículo: capacidad del tanque y rendimiento km/L salen en la tabla',
  VEH.includes('Capacidad del tanque') && VEH.includes('80 L') && VEH.includes('9,5 km/L'));
ok('vehículo sin clasificación dice «Vehículo» en la cabecera', VEH.includes('Vehículo'));
ok('y sin horómetro no inventa horas ni próximo servicio',
  !VEH.includes('HORAS DE TRABAJO') && !VEH.includes('PRÓXIMO SERVICIO'));

// ⭐ Escape: marca, encargado y empresa los escribe el usuario.
const RARO = F.fichaTecnicaMaquinaHtml({
  marca: '<script>alert(1)</script>', encargado: '<img src=x onerror=1>',
  companyName: '"Golden" & Cía', serial: '<b>x</b>',
});
ok('⭐ el texto del usuario va escapado', !RARO.includes('<script>') && !RARO.includes('<img src=x'));
ok('⭐ el serial inyectado también', !RARO.includes('<b>x</b>'));

eq('nombre de archivo usa el código', F.nombreArchivoFichaTecnica(XCMG), 'Ficha tecnica BRITADOR-0022');
eq('sin código usa marca · modelo (limpio)',
  F.nombreArchivoFichaTecnica({ marca: 'XCMG', modelo: 'XPE0912' }), 'Ficha tecnica XCMG  XPE0912');

// ── 3) El botón del Catálogo ────────────────────────────────────────────────
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/EquiposScreen.tsx'), 'utf8');
ok('la tarjeta de la máquina tiene el botón 📄 Ficha técnica',
  scr.includes('📄 Ficha técnica') && /onPress=\{\(\) => fichaTecnica\(m\)\}/.test(scr));
// ⭐ Y TAMBIÉN en las listas que abren las tarjetas de estado (Operativas /
// Averiadas / Esperando / Retiradas): una retirada sigue teniendo ficha.
ok('⭐ el botón sale también en las listas por estado (dos apariciones)',
  (scr.match(/onPress=\{\(\) => fichaTecnica\(m\)\}/g) ?? []).length >= 2);
ok('⭐ los VEHÍCULOS también tienen su botón (misma ficha, subtítulo Vehículo)',
  /onPress=\{\(\) => fichaTecnicaVeh\(v\)\}/.test(scr) && /fallbackSubtitulo: 'Vehículo'/.test(scr));
ok('⭐ la ficha usa el MISMO estado en vivo que las tarjetas (liveStatusOf)',
  /estadoParaFicha[\s\S]*?liveStatusOf\(m\.id\)\.estado/.test(scr));
ok('la ficha lleva la empresa CON su RIF',
  /fichaTecnica = async[\s\S]*?companyRif: \(comp as any\)\?\.rif \?\? null/.test(scr));
ok('y se exporta con su nombre de archivo',
  /exportPdf\(html, nombreArchivoFichaTecnica\(m\)\)/.test(scr));
// El peso y las medidas se pueden CARGAR desde el mismo Catálogo (✏️ Editar):
// son las mismas columnas del módulo de Acarreo — un solo peso por máquina.
ok('el formulario del Catálogo edita peso y dimensiones de la ficha',
  scr.includes("key: 'weight_ton'") && scr.includes("key: 'length_m'")
  && scr.includes("key: 'width_m'") && scr.includes("key: 'height_m'"));

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('\nFICHA TÉCNICA DEL CATÁLOGO — documento y botón\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-ficha-tecnica-maquina · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
