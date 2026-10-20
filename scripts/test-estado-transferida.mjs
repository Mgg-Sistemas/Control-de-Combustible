// 🔁 Candados del estado TRANSFERIDA A OTROS — 14-oct-2026.
//
// Pedido: «uno nuevo de esos, del estilo de retirado, que sería TRANSFERIDO A
// OTROS: se colocan como las retiradas, pero no están retiradas sino
// transferidas» + «que no lo tome en cuenta ahí [flota disponible], como las
// retiradas». Diseño: la transferida TAMBIÉN lleva operational=false (así todo
// lo que ya excluye retiradas — inspectores, jornadas, crons, QR, flota, mapa —
// la excluye igual sin tocar nada), más la marca `transferida` que la cuenta y
// lista aparte, con su `transferida_a` (a quién, obligatorio).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const lib = leer('src/lib/machineLiveStatus.ts');
ok('⭐ transferida = operational false + marca (hermana de retirada)',
  lib.includes('const transferidaMachines = machines.filter((m) => !m.operational && m.transferida === true);'));
ok('⭐ las retiradas EXCLUYEN a las transferidas (cubos excluyentes)',
  lib.includes('const retiradaMachines = machines.filter((m) => !m.operational && m.transferida !== true);'));

const scr = leer('src/screens/EquiposScreen.tsx');
ok('🔁 el cubo «Transferido a otros» existe y abre su detalle',
  scr.includes("abrirDetalle('transferida')") && scr.includes('Transferido a otros'));
ok('🚫 NO suma a la flota disponible (sigue siendo op + av + esp)',
  scr.includes('const disponible = nOp + nAv + nEsp;'));
ok('🔁 marcar transferida exige el DESTINO y deja operational=false',
  scr.includes('operational: false, transferida: true, transferida_a: dest,'));
ok('⭐ el update es honesto: pide filas y 0 filas = aviso de permiso',
  /transferida_a: dest,[\s\S]{0,400}\.select\('id'\)/.test(scr));
ok('✅ reactivar (Activar) limpia la marca de transferida',
  scr.includes('transferida: false, transferida_a: null }'));
ok('📄 la ficha técnica dice «Transferida a otros» (y a quién)',
  scr.includes('🔁 Transferida a otros'));
// 20-oct-2026: la regla vive en la lib (estadoConteoDe) y el Catálogo la importa —
// el conteo de Reportes usa LA MISMA, por eso ya no puede estar copiada en la pantalla.
ok('📊 el conteo separa transferida de retirada (regla compartida en la lib)',
  lib.includes("return m.transferida ? 'transferida' : 'retirada';")
  && scr.includes('estadoConteoDe(m, liveStatusOf(m.id).estado)'));
// El modal del destino va AL FINAL (gana el último montado): detalle < retiro < transfer.
{
  const iDetalle = scr.indexOf('<Modal visible={!!detailStatus}');
  const iRetiro = scr.indexOf('<Modal visible={!!retireFor}');
  const iTrans = scr.indexOf('<Modal visible={!!transferFor}');
  ok('🪟 el modal de transferir monta DESPUÉS del detalle y del retiro',
    iDetalle > -1 && iRetiro > iDetalle && iTrans > iRetiro);
}

const dash = leer('src/screens/DashboardScreen.tsx');
ok('🏠 el Inicio trae el mismo cubo (mismos buckets que el Catálogo)',
  dash.includes("{ key: 'transferida', n: states?.tra,") && dash.includes('tra: transferidaMachines.length'));
ok('🏠 …y su consulta pide la columna transferida', dash.includes("select('id, operational, en_espera, active, transferida')"));

console.log(`\n🔁 Transferida a otros: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Fuera de servicio como retirada, contada aparte y con su destino.');
