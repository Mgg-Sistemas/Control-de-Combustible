/*
 * Test del PESO DE ROMANA en viajes de camiones (26-sep-2026).
 *
 * Pedido de la encargada del módulo: el listero teclea el PESO BRUTO en la
 * romana del CDT, el sistema resta la TARA de esa placa y arroja el PESO A
 * PAGAR (neto), con FOTO obligatoria como evidencia. En el ticket y en los
 * reportes, con los nombres del papel de muestra.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · el formato del papel es EXACTAMENTE el de la muestra (32.540,00 Kg)
 *   · el neto en vivo es el MISMO cálculo que hace la base (bruto − tara)
 *   · peso y foto obligatorios: sin ellos el registro se bloquea CON motivo
 *   · la tara se congela en el viaje y el neto NUNCA lo manda el teléfono
 *   · la foto viaja en la cola offline y se sube ANTES del insert
 *   · el escalón de compatibilidad no deja al listero sin registrar
 *   · lo nuevo entra APAGADO en ticket y reportes (regla de la casa)
 *
 *   node scripts/test-viajes-peso.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// `viajesPeso.ts` importa `./numeros`: se registra un cargador de .ts para que
// el require relativo resuelva y transpile en el momento.
Module._extensions['.ts'] = (m, filename) => {
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(js, filename);
};
const cargar = (rel) => require(path.join(ROOT, rel));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const P = cargar('src/lib/viajesPeso.ts');
const R = cargar('src/lib/viajesResumen.ts');

// ── 1) EL FORMATO DEL PAPEL, calcado de la muestra de la encargada ──────────
eq('⭐ bruto de la muestra', P.kgTexto(32540), '32.540,00 Kg');
eq('⭐ tara de la muestra', P.kgTexto(11340), '11.340,00 Kg');
eq('⭐ neto de la muestra', P.kgTexto(21200), '21.200,00 Kg');
eq('con decimales', P.kgTexto(1234.5), '1.234,50 Kg');
eq('millones', P.kgTexto(1234567.89), '1.234.567,89 Kg');
eq('chico, sin punto de miles', P.kgTexto(950), '950,00 Kg');
eq('negativo (no debería pasar, pero no miente)', P.kgTexto(-5), '-5,00 Kg');
eq('opcional: null se queda null (raya del ticket)', P.kgTextoOpcional(null), null);
eq('opcional: con valor, formatea', P.kgTextoOpcional(21200), '21.200,00 Kg');

// ── 2) LO TECLEADO → KILOS (misma regla única de leerNumero) ────────────────
eq('kilos pelados', P.pesoTecleadoAKg('32540', 'kg'), 32540);
// ⚠️ La regla única de leerNumero: UN punto UNA vez es DECIMAL («32.540» son
//    32,54 kg, no treinta y dos mil). No es un bug de acá: es la misma regla de
//    Compras, y el candado «el bruto tiene que superar la tara» ataja el caso
//    (32,54 kg nunca superan una tara real) ANTES de que se guarde nada.
eq('un solo punto es decimal (regla única de leerNumero)', P.pesoTecleadoAKg('32.540', 'kg'), 32.54);
ok('...y ese tecleo NO pasa el candado contra una tara real',
  P.motivoPesoInvalido({ brutoKg: P.pesoTecleadoAKg('32.540', 'kg'), taraKg: 11340, fotoLista: true }) != null);
eq('dos puntos SÍ separan miles (1.234.567)', P.pesoTecleadoAKg('1.234.567', 'kg'), 1234567);
eq('⭐ toneladas ×1000', P.pesoTecleadoAKg('32,54', 't'), 32540);
eq('toneladas enteras', P.pesoTecleadoAKg('14', 't'), 14000);
eq('vacío vale 0 (= falta el peso)', P.pesoTecleadoAKg('', 'kg'), 0);
eq('basura vale 0', P.pesoTecleadoAKg('abc', 'kg'), 0);
eq('negativo vale 0', P.pesoTecleadoAKg('-500', 'kg'), 0);

// ── 3) EL NETO EN VIVO = el cálculo de la base ──────────────────────────────
eq('⭐ neto de la muestra: 32540 − 11340', P.netoDe(32540, 11340), 21200);
eq('sin bruto no hay neto', P.netoDe(0, 11340), null);
eq('sin tara no hay neto', P.netoDe(32540, 0), null);
eq('nulls no revientan', P.netoDe(null, undefined), null);

// ── 4) OBLIGATORIO, con el motivo en el idioma del listero ─────────────────
eq('todo bien → null', P.motivoPesoInvalido({ brutoKg: 32540, taraKg: 11340, fotoLista: true }), null);
ok('falta el bruto', /peso bruto/i.test(P.motivoPesoInvalido({ brutoKg: 0, taraKg: 11340, fotoLista: true }) ?? ''));
ok('falta la tara → pide teclearla', /tara/i.test(P.motivoPesoInvalido({ brutoKg: 32540, taraKg: 0, fotoLista: true }) ?? ''));
ok('⭐ bruto que no supera la tara se bloquea', /no supera la tara/.test(P.motivoPesoInvalido({ brutoKg: 9000, taraKg: 11340, fotoLista: true }) ?? ''));
ok('bruto IGUAL a la tara también (neto 0)', P.motivoPesoInvalido({ brutoKg: 11340, taraKg: 11340, fotoLista: true }) != null);
ok('⭐ sin foto se bloquea y dice que es la evidencia', /foto/i.test(P.motivoPesoInvalido({ brutoKg: 32540, taraKg: 11340, fotoLista: false }) ?? ''));
// El orden de los avisos: primero los números, la foto de última — así el
// listero no toma la foto para enterarse después de que el bruto está malo.
ok('sin nada, el primer aviso es el bruto', /bruto/.test(P.motivoPesoInvalido({ brutoKg: 0, taraKg: 0, fotoLista: false }) ?? ''));

// ── 5) EL AVISO DE SOSPECHA no bloquea, avisa ───────────────────────────────
eq('un peso normal no avisa', P.avisoPesoSospechoso(32540, 11340), null);
ok('un bruto 100× la tara avisa', /Revisa/.test(P.avisoPesoSospechoso(1200000, 11340) ?? ''));
eq('sin datos no avisa', P.avisoPesoSospechoso(0, 0), null);

// ── 6) LOS TRES RENGLONES DEL TICKET ────────────────────────────────────────
eq('⭐ viaje con peso → los tres formateados',
  P.pesosParaTique({ pesoBrutoKg: 32540, pesoTaraKg: 11340, pesoNetoKg: 21200 }),
  { pesoBruto: '32.540,00 Kg', pesoTara: '11.340,00 Kg', pesoNeto: '21.200,00 Kg' });
eq('viaje viejo sin peso → nulls (el papel pinta rayas)',
  P.pesosParaTique({ pesoBrutoKg: null, pesoTaraKg: null, pesoNetoKg: null }),
  { pesoBruto: null, pesoTara: null, pesoNeto: null });
eq('si falta el neto guardado, se calcula igual que la base',
  P.pesosParaTique({ pesoBrutoKg: 32540, pesoTaraKg: 11340, pesoNetoKg: null }).pesoNeto,
  '21.200,00 Kg');

// ── 7) EL RESUMEN SUMA SOLO LOS NETOS QUE EXISTEN ──────────────────────────
{
  const rows = [
    { machineryId: 'a', machineCode: 'V1', listeroId: 'l1', listeroName: 'Ana', turno: 'day', pesoNetoKg: 21200 },
    { machineryId: 'a', machineCode: 'V1', listeroId: 'l2', listeroName: 'Beto', turno: 'day', pesoNetoKg: 20000 },
    { machineryId: 'a', machineCode: 'V1', listeroId: 'l1', listeroName: 'Ana', turno: 'night', pesoNetoKg: null }, // viaje viejo
  ];
  const cam = () => ({ companyId: 'e1', companyName: 'ACME', plate: 'X0000X', serial: null });
  const porEmpresa = R.resumirViajes(rows, cam, 'empresa');
  eq('⭐ total general de kilos: suma solo lo que existe', porEmpresa.netoKg, 41200);
  eq('el grupo lo trae', porEmpresa.empresas[0].netoKg, 41200);
  eq('y el camión también', porEmpresa.empresas[0].camiones[0].netoKg, 41200);
  const porListero = R.resumirViajes(rows, cam, 'listero');
  eq('⭐ agrupar por listero REPARTE el neto sin duplicarlo',
    porListero.empresas.reduce((a, g) => a + g.netoKg, 0), 41200);
  eq('...y el total general no cambia de eje', porListero.netoKg, 41200);
}

// ── 8) LA LIBRERÍA DE DATOS: congelar, escalón y foto ──────────────────────
const lib = sinComentarios(leer('src/lib/camionViajes.ts'));
ok('las columnas del peso, completas', /peso_bruto_kg, peso_tara_kg, peso_neto_kg, tara_manual, tara_manual_nombre, peso_foto_url/.test(lib));
ok('⭐ el NETO nunca lo manda el teléfono (columna generada)', !/peso_neto_kg:/.test(lib));
ok('el insert lleva bruto, tara, marca de manual y foto',
  /peso_bruto_kg: params\.pesoBrutoKg \?\? null/.test(lib)
  && /peso_tara_kg: params\.pesoTaraKg \?\? null/.test(lib)
  && /tara_manual: params\.taraManual === true/.test(lib)
  && /tara_manual_nombre: params\.taraManualNombre \?\? null/.test(lib));
ok('⭐ la foto se sube ANTES del insert y su fallo DEVUELVE error (a la cola)',
  lib.indexOf('subirFotoRomana(params.pesoFotoDataUrl') < lib.indexOf('const escalones')
  && /No se pudo subir la foto de la romana/.test(lib));
ok('la foto va con upsert y el nombre sale de la clave de idempotencia',
  /viajes-peso\/\$\{nombre\}\.jpg/.test(lib) && /upsert: true/.test(lib));
ok('el escalón de lectura pela el peso primero (lo más nuevo)',
  /hayColumnasDePeso !== false/.test(lib) && /faltaCorrerSqlDePeso/.test(lib));
ok('la corrección del bruto existe y NO toca la tara',
  /pesoBrutoKg\?: number;/.test(lib) && /patch\.peso_bruto_kg = cambios\.pesoBrutoKg/.test(lib)
  && !/patch\.peso_tara_kg/.test(lib));
ok('las taras: upsert con nombre congelado de quién la cargó',
  /from\('camion_taras'\)\.upsert\(/.test(lib) && /updated_by_nombre: userName/.test(lib));
ok('quitar la tara distingue «no había fila»', /Ese camión no tenía tara cargada/.test(lib));
// camion_taras NO tiene columna `id`: si listTaras no le dice al paginador que
// ordene por machinery_id, el order('id') por defecto revienta con 42703 y la
// pantalla miente «falta correr el SQL» (pasó el 26-sep-2026). Las DOS lecturas
// (con y sin columnas de exención) tienen que llevar el orden explícito.
ok('listTaras ordena por machinery_id (camion_taras no tiene id) en ambas lecturas',
  (lib.match(/selectAllRows\('camion_taras'[^)]*'machinery_id'\)/g) ?? []).length === 2);

// ── 9) LA FOTO LOCAL NO SUBE NADA ───────────────────────────────────────────
const foto = sinComentarios(leer('src/lib/photo.ts'));
{
  const i = foto.indexOf('export async function capturarFotoLocal');
  const cuerpo = i >= 0 ? foto.slice(i, foto.indexOf('export async function', i + 10)) : '';
  ok('capturarFotoLocal existe', i >= 0);
  ok('⭐ ...y NO sube al bucket (la foto espera al viaje)', cuerpo.length > 100 && !/upload|uploadToMachinery/.test(cuerpo));
}

// ── 10) EL TICKET: tres campos nuevos, apagados de fábrica ─────────────────
const TC = cargar('src/lib/tiqueConfig.ts');
ok('los tres campos existen con los nombres del papel de muestra',
  TC.CAMPOS_TIQUE.some((c) => c.k === 'pesoBruto' && /Peso entrada \(bruto\)/.test(c.label))
  && TC.CAMPOS_TIQUE.some((c) => c.k === 'pesoTara' && /Peso salida \(tara\)/.test(c.label))
  && TC.CAMPOS_TIQUE.some((c) => c.k === 'pesoNeto' && /Peso a pagar \(neto\)/.test(c.label)));
eq('⭐ apagados de fábrica (regla de la casa: lo nuevo no cambia el papel de nadie)',
  [TC.CONFIG_POR_DEFECTO.campos.pesoBruto, TC.CONFIG_POR_DEFECTO.campos.pesoTara, TC.CONFIG_POR_DEFECTO.campos.pesoNeto],
  [false, false, false]);
eq('una config vieja guardada SIN las claves nuevas las recibe apagadas',
  (() => { const c = TC.normalizarConfig({ campos: { folio: true, fecha: true } }); return [c.campos.pesoBruto, c.campos.pesoTara, c.campos.pesoNeto]; })(),
  [false, false, false]);
{
  const TD = cargar('src/lib/tiqueDocumento.ts');
  const conPeso = TC.normalizarConfig({ campos: { pesoBruto: true, pesoTara: true, pesoNeto: true } });
  const renglones = TD.renglonesDelTique({ pesoBruto: '32.540,00 Kg', pesoTara: '11.340,00 Kg', pesoNeto: '21.200,00 Kg' }, conPeso);
  ok('encendidos, el papel lleva los tres renglones con su valor',
    renglones.some((r) => r.k === 'P. entrada' && r.v === '32.540,00 Kg')
    && renglones.some((r) => r.k === 'P. salida' && r.v === '11.340,00 Kg')
    && renglones.some((r) => r.k === 'P. a pagar' && r.v === '21.200,00 Kg'));
  ok('un viaje viejo sale con raya, no con cero',
    TD.renglonesDelTique({}, conPeso).filter((r) => /^P\./.test(r.k)).every((r) => r.v === '—'));
}

// ── 11) LOS REPORTES: interruptor apagado = el papel de siempre ────────────
const C = cargar('src/lib/cubicaje.ts');
eq('el interruptor existe y entra apagado', C.OPCIONES_POR_DEFECTO.peso, false);
{
  const off = { ...C.OPCIONES_POR_DEFECTO };
  const on = { ...C.OPCIONES_POR_DEFECTO, peso: true };
  ok('apagado, el detallado no tiene ni rastro del peso',
    C.columnasDetalle(off).every((c) => !/peso/i.test(c.key)));
  eq('⭐ encendido, el detallado suma las tres columnas del papel de muestra',
    C.columnasDetalle(on).filter((c) => /^peso/.test(c.key)).map((c) => c.head),
    ['P. entrada (Kg)', 'P. salida (Kg)', 'P. a pagar (Kg)']);
  eq('el resumido solo lleva el peso a pagar (bruto y tara son de cada viaje)',
    C.columnasResumen(on).filter((c) => /^peso/.test(c.key)).map((c) => c.head),
    ['Peso a pagar (Kg)']);
  ok('«solo camiones» no lleva peso ni encendido (papel sin cantidades)',
    C.columnasCamiones(on).every((c) => !/peso/i.test(c.key)));
  ok('con el peso encendido, el resumido SÍ tiene cifras',
    C.reporteSinCifras({ ...on, viajes: false, m3: false }, true) === false);
}

// ── 12) LA PANTALLA: obligatorio, congelado y limpio ────────────────────────
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('⭐ valida el peso ANTES de tocar la red', scr.indexOf('motivoPesoInvalido({ brutoKg, taraKg, fotoLista: !!fotoPeso })') < scr.indexOf("if (!isOnline())"));
// Desde la exención de romana (26-sep tarde), el payload dice explícitamente
// que un camión exento manda nulls — y el que no, sus valores congelados.
ok('el payload congela bruto, tara, marca de manual y la foto cruda',
  /pesoBrutoKg: exentoDeRomana \? null : brutoKg,\s*pesoTaraKg: exentoDeRomana \? null : taraKg,\s*taraManual: usaTaraManual,\s*taraManualNombre: usaTaraManual \? listeroName : null,\s*pesoFotoDataUrl: exentoDeRomana \? null : fotoPeso,/.test(scr));
ok('🚫 exento: la tarjeta del peso NI SE PINTA y la validación se salta',
  /\{!camionExentoRomana \? \(/.test(scr) && /if \(!exentoDeRomana\) \{\s*const motivoPeso = motivoPesoInvalido/.test(scr));
ok('🚫 el interruptor vive en la lista de taras y PREGUNTA antes de marcar',
  /toggleExentoRomana/.test(scr) && /No pasa por romana · tocar para que vuelva a pasar/.test(scr)
  && /¿Lo marcas\?/.test(scr));
ok('cambiar de camión limpia el peso (dos sitios: buscador y fuera de catálogo)',
  (scr.match(/limpiarPeso\(\);/g) || []).length >= 2);
ok('la cola de pantalla también enseña el peso (queued y stuck)',
  (scr.match(/pesoNetoKg: netoDe\(q\.payload\.pesoBrutoKg, q\.payload\.pesoTaraKg\)/g) || []).length === 2);
ok('el ticket de la pantalla usa los pesos congelados', /\.\.\.pesosParaTique\(row\)/.test(scr));
ok('la foto es un botón obligatorio con cámara', /Foto de la romana \(obligatoria\)/.test(scr) && /tomarFotoPeso/.test(scr));
ok('la tara de la placa se enseña con quién la cargó', /Tara de esta placa/.test(scr) && /la cargó \$\{taraSeleccion\.updatedByNombre\}/.test(scr) || /la cargó \$\{/.test(scr) || /la cargó /.test(scr));
ok('sin tara cargada, el listero la teclea y queda como manual', /Este camión no tiene tara cargada/.test(scr));
ok('kilos y toneladas', /UNIDADES_PESO\.map/.test(scr));
ok('la administración de taras vive en ⚙️ Configuración', /TARA DE ROMANA POR CAMIÓN \(KG\)/.test(scr) && /borrarTara/.test(scr) && /saveTara/.test(scr));
ok('quitar la tara PREGUNTA y explica lo congelado', /¿Quitar la tara de \$\{code\}\?/.test(scr) && /conservan la suya/.test(scr));
ok('la corrección del bruto solo con full y sin tocar la tara', /PESO BRUTO \(KG\) · tara congelada/.test(scr) && /tara congelada de este viaje/.test(scr));
ok('el PDF detallado lleva las tres columnas con sus totales',
  /pesoBruto: kgOpc\(r\.pesoBrutoKg\)/.test(scr) && /kgPie\(netoDeFilas\(filteredRangeRows\)\)/.test(scr));
ok('el resumido suma el peso a pagar por camión, grupo y total',
  /pesoNeto: kgPie\(c\.netoKg\)/.test(scr) && /peso a pagar \$\{kgPie\(resumenViajes\.netoKg\)\}/.test(scr));
ok('la fila del viaje enseña bruto/tara/neto y abre la foto',
  /⚖️ Bruto /.test(scr) && /Ver foto ›/.test(scr));
ok('si falta el SQL del peso, se dice (registro y taras)',
  /faltaCorrerSqlDePeso\(\)/.test(scr) && /tarasMissing \?/.test(scr));

// ── 13) LA VISTA PREVIA DE CONFIGURACIÓN usa el ejemplo de la muestra ───────
ok('el ejemplo del configurador cuadra (bruto − tara = neto)',
  /pesoBruto:\s*'32\.540,00 Kg'/.test(leer('src/components/TiqueConfigCard.tsx'))
  && /pesoNeto:\s*'21\.200,00 Kg'/.test(leer('src/components/TiqueConfigCard.tsx')));

// ── 14) LOS MANUALES lo cuentan ─────────────────────────────────────────────
ok('el manual .md tiene la sección', /⚖️ Peso de romana: bruto, tara y peso a pagar \(26\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /⚖️ PESO DE ROMANA: BRUTO, TARA Y PESO A PAGAR \(26\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-peso · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
