// 06-nov-2026:
//  1. El toast es ESTABLE (useMemo): si cambiaba en cada render, Fletes recargaba en bucle
//     y el aviso «Error al cargar fletes: JWT expired» salía a lo loco.
//  2. Editar un consumo de una máquina de APOYO no exige una máquina del catálogo:
//     muestra (y exige) el nombre de la de apoyo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const toast = fs.readFileSync(path.join(ROOT, 'src/components/ToastProvider.tsx'), 'utf8');
const disp = fs.readFileSync(path.join(ROOT, 'src/screens/redesign/DispatchesPilot.tsx'), 'utf8');

let ok = 0; const fallas = [];
const check = (c, m) => { if (c) ok++; else fallas.push('  ✗ ' + m); };
check(/const api = useMemo<ToastApi>\(/.test(toast) && /\}\), \[show\]\);/.test(toast), 'el toast no cambia en cada render');
check(!/const api: ToastApi = \{/.test(toast), 'ya no queda el objeto nuevo por render');

// El showIf real, evaluado con valores como los arma RecordForm.
const showIf = (key) => {
  const m = disp.match(new RegExp(`key: '${key}'[^\\n]*showIf: (\\(v\\) => [^}]*?) \\}`));
  return m ? eval(m[1]) : null;
};
const mach = showIf('machinery_id'), apoyo = showIf('apoyo_nombre');
check(mach && apoyo, 'existen los dos campos');
const deApoyo = { asset_kind: 'maquinaria', apoyo_nombre: 'CAMION X', liters: '333.91' };
const delCatalogo = { asset_kind: 'maquinaria', machinery_id: 'abc', liters: '10' };
check(!mach(deApoyo) && apoyo(deApoyo), '⭐ editar uno de apoyo: no pide catálogo, muestra la de apoyo');
check(mach(delCatalogo) && !apoyo(delCatalogo), 'uno del catálogo: igual que siempre');
check(mach({ asset_kind: 'maquinaria' }) && !apoyo({ asset_kind: 'maquinaria' }), 'uno NUEVO: igual que siempre');
check(apoyo({ ...deApoyo, apoyo_nombre: '' }), 'si borran el nombre el campo sigue a la vista (y es obligatorio)');

if (fallas.length) { console.error(fallas.join('\n')); process.exit(1); }
console.log(`✅ test-toast-estable-y-editar-apoyo: ${ok} ok, 0 fallas`);
