// 💾 FICHA TÉCNICA: GUARDADO AUTOMÁTICO LIVIANO (07-nov-2026). El disco de Supabase se llenó
// (2 GB → 8 GB): cada guardado de la ficha reescribe la configuración compartida y deja un
// registro en la auditoría; con 0,8 s de espera y sin comparar, una ficha llenada a mano dejaba
// decenas de registros (1.299 en 24 h). Ahora espera 2,5 s y no guarda si nada cambió.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = fs.readFileSync(path.join(ROOT, 'src/components/FichaTecnicaModal.tsx'), 'utf8');
let ok = 0; const fallas = [];
const check = (c, m) => { if (c) ok++; else fallas.push('  ✗ ' + m); };

const prog = s.slice(s.indexOf('const programarGuardado'), s.indexOf('const cancelarGuardadoPendiente'));
check(/}, 2500\);/.test(prog) && !/}, 800\);/.test(prog), '⭐ el guardado automático espera 2,5 s sin escribir (antes 0,8 s)');
check(/guardarSiCambio\(next\)/.test(prog), 'el guardado automático pasa por «solo si cambió»');
check(/if \(huella === ultimoGuardado\.current\) return;/.test(s), '⭐ si la ficha es igual a la última mandada, NO se guarda');
const cerrar = s.slice(s.indexOf('const cerrar = '), s.indexOf('const cerrar = ') + 400);
check(/guardarSiCambio\(data\)/.test(cerrar), 'al cerrar, lo pendiente se guarda (si cambió): no se pierde lo último escrito');
check((s.match(/ultimoGuardado\.current = JSON\.stringify\(finalData\)/g) || []).length === 2, 'el botón Guardar y el PDF siempre guardan y recuerdan lo guardado');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-ficha-tecnica-guardado-liviano: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-ficha-tecnica-guardado-liviano: ${ok} ok, 0 fallas`);
