// 🎭 Fichas de rol (31-oct-2026): accesos por defecto y vista en teléfono por rol
// del sistema. Orden, igual en la app y en la base:
//   persona > rol personalizado > ficha del rol > fábrica. Sensibles nunca de la ficha.
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };
const leer = (p) => fs.readFileSync(p, 'utf8');

// Copia fiel de la precedencia de AuthContext.moduleLevel (sin la herencia de módulos).
const SENSIBLES = ['control_pagos', 'margen_ganancia', 'usuarios', 'nomina'];
const fabrica = (k) => (['control_pagos', 'caja', 'supervision'].includes(k) ? 'none' : 'escritura');
function nivel({ role, explicit = {}, appRole = null, ficha = null }, k) {
  if (role === 'admin') return 'full';
  const ex = explicit[k];
  if (appRole) return ex ?? appRole[k] ?? 'none';
  const f = ficha && !SENSIBLES.includes(k) ? ficha[k] : undefined;
  if (f) return ex ?? f;
  if (role === 'analista' && k === 'asistencia') return ex && ex !== 'none' ? ex : 'escritura';
  return ex ?? fabrica(k);
}

ok('ficha vacía = igual que hoy', nivel({ role: 'supervisor', ficha: {} }, 'caja') === 'none' && nivel({ role: 'supervisor', ficha: {} }, 'mapa') === 'escritura');
ok('la ficha cambia lo de fábrica', nivel({ role: 'supervisor', ficha: { caja: 'lectura' } }, 'caja') === 'lectura');
ok('el permiso de la persona manda sobre la ficha', nivel({ role: 'supervisor', explicit: { caja: 'none' }, ficha: { caja: 'full' } }, 'caja') === 'none');
ok('el rol personalizado ignora la ficha', nivel({ role: 'conductor', appRole: { mapa: 'lectura' }, ficha: { caja: 'full' } }, 'caja') === 'none');
ok('los sensibles nunca salen de la ficha', nivel({ role: 'analista', ficha: { control_pagos: 'full' } }, 'control_pagos') === 'none');
ok('el admin siempre tiene todo', nivel({ role: 'admin', ficha: { caja: 'none' } }, 'caja') === 'full');

const perm = leer('src/lib/permissions.ts');
const auth = leer('src/context/AuthContext.tsx');
const nav = leer('src/navigation/index.tsx');
const modal = leer('src/components/FichasDeRolModal.tsx');
const users = leer('src/screens/UsersScreen.tsx');
ok('la lista de sensibles coincide con la base', /MODULOS_SOLO_POR_PERSONA = \['control_pagos', 'margen_ganancia', 'usuarios', 'nomina'\]/.test(perm));
ok('nivelDeFicha ignora los sensibles', /MODULOS_SOLO_POR_PERSONA\.includes\(moduleKey\)\) return undefined/.test(perm));
ok('moduleLevel usa la ficha después del rol personalizado', /if \(appRole\) \{[\s\S]*?\}\s*\n[\s\S]{0,400}nivelDeFicha\(roleTemplate, moduleKey\);\s*\n\s*if \(deFicha\) return explicit \?\? deFicha;/.test(auth));
ok('la ficha se lee solo sin rol personalizado', /if \(!arId\) \{[\s\S]{0,300}await loadFicha\(\)/.test(auth));
ok('la lectura de la ficha tiene tope de tiempo', /setTimeout\(\(\) => res\(\{ data: null, error: 'timeout' \}\), 3000\)/.test(auth));
ok('la vista en teléfono se congela al iniciar', /vistaRef = React\.useRef/.test(nav) && /vistaTelefono: vistaCongelada/.test(nav));
ok('la vista no aplica a admin ni a roles personalizados', /phone && !appRole && role && role !== 'admin'/.test(nav));
ok('el guardado no finge éxito', /if \(!data \|\| data\.length === 0\) \{ toast\.error/.test(modal));
ok('el guardado avisa a cuántas personas afecta', /Esto afecta a \$\{n\} persona/.test(modal));
ok('Usuarios ofrece la pantalla solo al admin', /role === 'admin' \? \(\s*<TouchableOpacity onPress=\{\(\) => setFichasOpen\(true\)\}>/.test(users));

console.log(`\n🎭 Fichas de rol: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { console.log('FALLAN:\n - ' + failures.join('\n - ')); process.exit(1); }
