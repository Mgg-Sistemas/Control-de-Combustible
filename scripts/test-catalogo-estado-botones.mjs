// 📁⬛ Candados del detalle por estado del Catálogo — 14-oct-2026.
//
// Pedidos: (1) «en operativo o en cualquier estado, todas las opciones deben
// estar plegadas por defecto»; (2) «trato de cambiar el estado de la maquinaria
// o sacarla de ahí y no me deja» — eran TRES fallas juntas: el modal del motivo
// de retiro montaba ANTES del modal del detalle (en web gana el último montado:
// se abría DETRÁS y no se veía), los updates de machinery no pedían filas (la
// RLS rechazaba con 0 filas SIN error = éxito fingido) y el banner de error
// vivía en la pantalla de fondo (invisible con el modal abierto).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/EquiposScreen.tsx'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

// 📁 Plegado por defecto en TODOS los estados; buscar abre; el toque manda.
ok('📁 todos los estados nacen colapsados (y el ?? deja mandar al toque)',
  scr.includes('const open = detailExpanded[g.key] ?? !!detailNq;'));
ok('📁 la regla vieja (operativas/averiadas abiertas) NO volvió',
  !scr.includes("detailNq ? true : (detailStatus !== 'retirada'"));

// 📁 Lo MISMO en el catálogo principal (19-oct-2026, a pedido: «que todos los
//    apartados de las empresas no estén desplegadas, que estén cerradas para yo
//    poder desplegarlas»). Buscar sigue abriéndolas, si no los resultados
//    quedarían escondidos detrás de los encabezados.
ok('📁 el catálogo también nace con TODAS las empresas plegadas',
  scr.includes('const open = expanded[g.key] ?? !!q;'));
ok('📁 …y ya no se auto-despliega al filtrar por empresa o clasificación',
  !scr.includes("expanded[g.key] ?? (companyFilter !== '__all__' || typeFilter !== '__all__')"));

// ⬛ El modal del motivo de retiro monta DESPUÉS del modal del detalle (web).
{
  const iDetalle = scr.indexOf('<Modal visible={!!detailStatus}');
  const iRetiro = scr.indexOf('<Modal visible={!!retireFor}');
  ok('⬛ el modal de retiro va DESPUÉS del modal del detalle (gana el último montado)',
    iDetalle > -1 && iRetiro > -1 && iRetiro > iDetalle);
  ok('⬛ …y el porqué quedó escrito al lado del modal', scr.includes('gana el último\n          montado') || /gana el último\s+montado/.test(scr));
}

// ⭐ Updates honestos: machinery pide filas y 0 filas = aviso, no éxito fingido.
ok('⭐ retirar/activar pide las filas tocadas (.select)',
  scr.includes(".update({ operational: !m.operational, ...stamp }).eq('id', m.id).select('id')"));
ok('⭐ esperando instrucciones también',
  scr.includes(".update({ en_espera: next }).eq('id', m.id).select('id')"));
ok('⭐ 0 filas = mensaje claro de permiso (retirar, espera y transferir)',
  (scr.match(/La base no guardó el cambio: tu permiso de Equipos no alcanza/g) || []).length >= 2);

// ⚠️ El aviso de error se ve DENTRO del modal del detalle (no solo en el fondo).
ok('⚠️ el banner de error también se pinta dentro del modal del detalle',
  (scr.match(/\{notice \? \(/g) || []).length >= 2);

console.log(`\n📁⬛ Catálogo · detalle por estado: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Plegado por defecto; retirar/espera funcionan y los rechazos se dicen.');
