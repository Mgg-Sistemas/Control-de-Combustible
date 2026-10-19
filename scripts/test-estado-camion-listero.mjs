// 🚦 ESTADO DEL CAMIÓN DESDE EL TELÉFONO DEL LISTERO (19-oct-2026).
//
// La librería es casi toda Supabase, así que esta suite vigila el CONTRATO en
// el código fuente (mismo estilo que test-viajes-estado-no-bloquea.mjs):
// qué puede tocar, qué no, y que la pantalla respete las puertas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:"'])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}`); } };

const lib = leer('src/lib/estadoCamionListero.ts');
const libSin = sinComentarios(lib);
const pantalla = leer('src/screens/ViajesCamionesScreen.tsx');
const caja = leer('src/components/EstadoCamionPermisosBox.tsx');

console.log('\n🚦 ESTADO DEL CAMIÓN DESDE EL TELÉFONO DEL LISTERO\n');

// ── La librería: solo tickets, nunca la ficha ───────────────────────────────
ok('⭐ la librería NUNCA escribe en machinery (solo la LEE para las guardas)',
  !/from\('machinery'\)\s*\.\s*(update|insert|upsert|delete)/.test(libSin)
  && /from\('machinery'\)\.select/.test(libSin.replace(/\s+/g, '')) || /from\('machinery'\)[\s\S]{0,40}\.select/.test(libSin));
ok('⭐ …y escribe SOLO en maintenance_requests y viajes_estado_permisos',
  (libSin.match(/from\('([a-z_]+)'\)/g) || []).every((t) =>
    ["from('machinery')", "from('maintenance_requests')", "from('viajes_estado_permisos')"].includes(t)));
ok('⭐ en espera y retirada/transferida se RECHAZAN antes de tocar nada',
  /en_espera\)/.test(libSin) && /EN ESPERA DE INSTRUCCIONES/.test(lib) && /operational === false/.test(libSin) && /RETIRADO o TRANSFERIDO/.test(lib));
ok('⭐ el motivo es obligatorio para avería y parada',
  /estado !== 'operativo' && !motivoTxt/.test(libSin) && /Escribe el motivo/.test(lib));
ok('⭐ operativo = resolver pendientes con resolved_by/resolved_at (marcador Y averías)',
  /status: 'realizado'/.test(libSin) && /resolved_by/.test(libSin) && /resolved_at/.test(libSin)
  && /\.eq\('material', MARCADOR_PARADA\)/.test(libSin) && /\.neq\('material', MARCADOR_PARADA\)/.test(libSin));
ok('⭐ avería = la avería real MÁS su marcador (como el inspector)',
  /pon\('otro', false\)/.test(libSin) && /pon\(MARCADOR_PARADA, true\)/.test(libSin));
ok('⭐ actualiza-o-inserta: nunca duplica un pendiente (contaría doble)',
  /previas\?\.length/.test(libSin) && /NUNCA duplicar/i.test(lib));
ok('⭐ todos los escritos piden filas de vuelta (la RLS rechaza sin error)',
  // Cada update/insert/upsert/delete de la librería lleva su .select(...) en la
  // misma cadena (a lo sumo 200 caracteres después).
  (libSin.match(/\.(update|insert|upsert|delete)\(/g) || []).length > 0
  && !(/\.(update|insert|upsert|delete)\((?![\s\S]{0,200}?\.select\()/.test(libSin)));
ok('⭐ otorgar/quitar avisan cuando la base dice que no (0 filas = no eres full)',
  /solo quien tiene control total en Viajes/.test(lib));

// ── La pantalla: puertas y refresco ─────────────────────────────────────────
ok('⭐ el botón solo sale con el permiso (full o fila otorgada)',
  /puedoCambiarEstado = canFull \|\| permisoEstado/.test(pantalla)
  && /puedoCambiarEstado && selectedTruck\.id !== FUERA_CATALOGO_ID/.test(pantalla));
ok('⭐ el camión fuera de catálogo NO ofrece cambiar estado', /selectedTruck\.id !== FUERA_CATALOGO_ID/.test(pantalla));
ok('⭐ tras cambiar, refresca a mano (el realtime no escucha maintenance_requests)',
  /loadTrucks\(\);\s*\}/.test(pantalla.slice(pantalla.indexOf('const aplicarEstado'), pantalla.indexOf('const aplicarEstado') + 1600)));
ok('⭐ la caja de otorgar recibe SOLO los listeros de rol', /EstadoCamionPermisosBox listeros=\{listerosDeRol\}/.test(pantalla));
ok('la caja del full existe y alterna con la librería', /listarPermisosEstado/.test(caja) && /otorgarPermisoEstado/.test(caja) && /quitarPermisoEstado/.test(caja));

// ── El guardián viejo sigue en pie ──────────────────────────────────────────
const camionViajes = sinComentarios(leer('src/lib/camionViajes.ts'));
ok('⭐ camionViajes.ts sigue SIN escribir en maintenance_requests', !/maintenance_requests/.test(camionViajes));

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n✗ estado camión listero: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ estado camión listero: ${pass} pruebas ok`);
