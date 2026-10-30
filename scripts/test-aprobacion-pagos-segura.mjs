// 🔒 Candado: aprobación de pagos decidida por la base, no por el nombre (30-oct-2026).
// La base (es_aprobador_cxp / es_admin_config_aprobacion y sus guardias) rechaza la
// marca «aprobado» o el cambio de configuración a quien no corresponde; la pantalla
// solo muestra u oculta botones según lo que la base responde.
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };
const leer = (p) => fs.readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const lib = leer('src/lib/requerimientoFlujo.ts');
const cxp = leer('src/screens/CuentasScreen.tsx');
const req = leer('src/screens/RequerimientoTab.tsx');
const com = leer('src/screens/ComprasScreen.tsx');
const perm = leer('src/lib/permisosAprobacion.ts');

ok('ya no existe el chequeo por nombre de quién configura', !/esUsuarioAutorizadoConfigAprobacion/.test(lib + cxp + req + com));
ok('ya no existe el chequeo por nombre del aprobador', !/esUsuarioJesusLozada/.test(lib + cxp + req + com));
ok('sin usuarios ni cédulas de personas en Compras', !/18162307|27514385|lozcheli15|'sistemas2'/.test(lib + cxp + req + com));
ok('el aprobador designado se reconoce solo por su cuenta', !/nombres\.some/.test(lib));
ok('los permisos los responde la base', /rpc\('es_aprobador_cxp'\)/.test(perm) && /rpc\('es_admin_config_aprobacion'\)/.test(perm));
ok('Por pagar usa los permisos de la base', /usePermisosAprobacion\(uid\)/.test(cxp));
ok('Requerimiento usa los permisos de la base', /usePermisosAprobacion\(uid\)/.test(req));
ok('Compras usa los permisos de la base', /usePermisosAprobacion\(session\?\.user\?\.id\)/.test(com));
ok('marcar pagada se frena si espera aprobación', /const marcarPagada = async[\s\S]{0,200}aprobacionEstado === 'esperando_aprobacion' && !puedeAprobarPagos/.test(cxp));
ok('el comprobante que marca pagada también se frena', /guardarComprobanteDirecto = async[\s\S]{0,300}esperando_aprobacion' && !puedeAprobarPagos/.test(cxp));
ok('guardar la configuración ya no traga el error (Por pagar)', /const \{ error: errCfg \} = await supabase\.from\('feature_toggles'\)[\s\S]{0,300}if \(errCfg\) return toast\.error/.test(cxp));
ok('guardar la configuración ya no traga el error (Requerimiento)', /const \{ error: errCfg \} = await supabase\.from\('feature_toggles'\)[\s\S]{0,300}if \(errCfg\) return toast\.error/.test(req));

console.log(failures.map((f) => '  ✗ ' + f).join('\n'));
console.log(`🔒 Aprobación de pagos: ${pass} OK · ${fail} FALLO(S)`);
process.exit(fail ? 1 : 0);
