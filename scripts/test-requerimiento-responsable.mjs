// 📦 Candado: el RESPONSABLE (almacenista) del requerimiento — 17-oct-2026.
//
// Pedido: «en los nuevos requerimientos debería poder colocar un almacenista como
// encargado o responsable; saldría el que lo creó automáticamente, y el responsable
// sería elegible entre los del rol almacenista, y a esa persona le debe salir un
// aviso cuando tenga ese requerimiento; el encargado es opcional, colócalo sin que
// diga opcional».
// Reglas vigiladas:
//  · quien lo crea sale solo (requested_by_name, como siempre);
//  · el responsable se elige entre usuarios cuyo ROL dinámico contiene «almacen»
//    (mismo criterio que esAlmacenista en Compras);
//  · el rótulo dice «Responsable» a secas — SIN «(opcional)», aunque lo sea;
//  · al elegido le llega un aviso a SU campana (recipient_id), y la campana ahora
//    existe para no-admin cuando tiene avisos propios (el admin sigue viendo todo);
//  · el nombre se guarda aparte (responsable_nombre) para sobrevivir si el usuario
//    se elimina (misma regla que supervisor_name);
//  · si el SQL de la columna no se ha corrido, el requerimiento SE GUARDA IGUAL
//    (reintento sin esos campos) y se avisa — nunca se cae el formulario;
//  · el PDF dice el responsable junto a «Solicita».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const scr = leer('src/screens/RequerimientoTab.tsx');
const bell = leer('src/components/NotificationBell.tsx');
const pdf = leer('src/lib/requerimiento.ts');

// ── El formulario ────────────────────────────────────────────────────────────
ok('👤 los almacenistas salen del ROL dinámico que contiene «almacen»',
  scr.includes("/almacen/i.test(String(p.app_role?.name ?? ''))"));
ok('🏷 el rótulo dice «Responsable» a secas',
  scr.includes('>Responsable</Text>'));
ok('🏷 …y NO dice «(opcional)» en ese rótulo',
  !/Responsable \(opcional\)|Responsable \(OPCIONAL\)/i.test(scr));
ok('✍️ quien lo crea sigue saliendo solo (requested_by_name)',
  scr.includes('requested_by: uid, requested_by_name: reqName'));
ok('📦 el responsable viaja con id Y nombre (sobrevive si el usuario se borra)',
  scr.includes('responsable_id: respId, responsable_nombre: respNombre'));

// ── El aviso al responsable: LO MANDA LA BASE, NO LA APP ─────────────────────
// (18-oct-2026) La política notif_insert exige is_staff() y los almacenistas son
// rol base 'conductor': un insert desde el cliente se les caía EN SILENCIO. El
// trigger trg_notify_requirement_responsable (SECURITY DEFINER) lo manda siempre,
// al crear con responsable y al cambiarlo en Editar.
ok('🔔 la app NO inserta el aviso del responsable (lo hace el trigger de la base)',
  !scr.includes('recipient_id: respId') &&
  scr.includes('trg_notify_requirement_responsable'));
ok('🔔 …y el porqué queda escrito (el insert del cliente fingía éxito)',
  scr.includes('se les caía EN SILENCIO'));

// ── La campana para no-admin ─────────────────────────────────────────────────
ok('🔔 los no-admin ven SOLO sus avisos propios',
  bell.includes("if (role !== 'admin') q = q.eq('recipient_id', uid);"));
ok('🔔 sin avisos propios, la campana no existe para no-admin',
  bell.includes("if (role !== 'admin' && items.length === 0) return null;"));

// ── Tolerancia al SQL pendiente ──────────────────────────────────────────────
ok('🧯 si falta la columna, se reintenta SIN el responsable y no se cae',
  scr.includes('faltaColResp(error.message)) { respCampos = {}; respFaltaSql = true; intento--; continue; }'));
ok('🧯 …y el flujo de EDITAR tiene el mismo paracaídas',
  scr.includes('if (error && faltaColResp(error.message))'));

// ── Dónde se ve ──────────────────────────────────────────────────────────────
ok('👁 el detalle de la lista dice el responsable',
  scr.includes('📦 Resp.: ${r.responsable_nombre}'));
ok('📄 el PDF dice el responsable junto a «Solicita» (los 3 formatos)',
  (pdf.match(/· Responsable: ' \+ esc\(d\.responsable\)/g) ?? []).length === 3);

console.log(`\n📦 Requerimiento con responsable: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Quien lo crea sale solo; el almacenista elegido se entera por su campana.');
