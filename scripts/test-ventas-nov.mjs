// 💰 Ventas, 01-nov-2026. (1) Elegir una empresa del catálogo tomaba OTRA: se
// enlazaba ciegamente por RIF a un contacto con el mismo RIF y otro nombre.
// (2) Opciones del papel: ocultar montos e identificador de servicio, y logos.
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

// ── Copia fiel de text.ts/norm, contactos.ts/docDigitos y contactoMaquinas.ts ──
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const docDigitos = (v) => String(v ?? '').replace(/[^0-9]/g, '');
function nombresCompatibles(a, b) {
  const limpio = (s) => norm(s)
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\b(c ?a|s ?a|s ?r ?l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const x = limpio(a), y = limpio(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
function contactoParaEmpresa(empresa, lista) {
  const enlazado = lista.find((c) => c.company_id === empresa.id);
  if (enlazado) return { accion: 'usar', contacto: enlazado };
  const digitos = docDigitos(empresa.rif);
  let rifOcupado = false;
  if (digitos) {
    const porRif = lista.find((c) => docDigitos(c.doc_number) === digitos);
    if (porRif) {
      const otraEmpresa = !!porRif.company_id && porRif.company_id !== empresa.id;
      if (!otraEmpresa && nombresCompatibles(porRif.name, empresa.name)) return { accion: 'enlazar', contacto: porRif, motivo: 'rif' };
      rifOcupado = true;
    }
  }
  const nombre = norm(empresa.name);
  const porNombre = lista.find((c) => norm(c.name) === nombre && !(c.company_id && c.company_id !== empresa.id));
  if (porNombre) return { accion: 'enlazar', contacto: porNombre, motivo: 'nombre' };
  return { accion: 'crear', fila: { name: empresa.name, doc_number: rifOcupado ? null : digitos || null, company_id: empresa.id } };
}

const empresa = { id: 'e1', name: 'ACME 1127 CA', rif: 'J-12345678-9' };
const otro = { id: 'c-otro', name: 'IMPRENTA CUALQUIERA', doc_number: '123456789', company_id: null };
const r1 = contactoParaEmpresa(empresa, [otro]);
ok('mismo RIF y otro nombre: NO se toma el otro contacto', r1.accion === 'crear');
ok('la ficha nueva nace sin RIF (índice único contactos_doc_key)', r1.fila.doc_number === null && r1.fila.company_id === 'e1');
const propio = { id: 'c-acme', name: 'ACME 1127 C.A.', doc_number: '123456789', company_id: null };
const r2 = contactoParaEmpresa(empresa, [otro, propio].reverse());
ok('mismo RIF y mismo nombre (con C.A.) sí enlaza', r2.accion === 'enlazar' && r2.contacto.id === 'c-acme');
ok('ya enlazado por company_id: se usa', contactoParaEmpresa(empresa, [otro, { ...propio, company_id: 'e1' }]).contacto.id === 'c-acme');
ok('RIF libre: la ficha nueva lleva el RIF', contactoParaEmpresa(empresa, []).fila.doc_number === '123456789');
ok('dos empresas hermanas no se confunden', !nombresCompatibles('ACME CN', 'ACME NK'));
ok('mismo nombre pero atado a OTRA empresa no se toma',
  contactoParaEmpresa({ id: 'e2', name: 'ACME NK', rif: null }, [{ id: 'x', name: 'ACME NK', company_id: 'e9' }]).accion === 'crear');

// ── Copia fiel de las opciones del papel (ventaDocumento.ts) ──
const LOGOS = ['principal', 'golden', 'jhenzaen', 'renace', 'ninguno'];
function opcionesVentaDoc(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    ocultarMontosServicio: o.ocultarMontosServicio === true,
    ocultarIdServicio: o.ocultarIdServicio === true,
    logo: LOGOS.includes(o.logo) ? o.logo : 'principal',
    logo2: LOGOS.includes(o.logo2) ? o.logo2 : 'ninguno',
  };
}
function unidadImpresa(it, op) {
  const u = String(it.unit ?? '').trim();
  if (op.ocultarIdServicio && it.kind === 'servicio' && (!u || /^serv/i.test(u))) return '';
  return u || '—';
}
const def = opcionesVentaDoc(null);
ok('de fábrica: todo visible y el logo principal', !def.ocultarMontosServicio && !def.ocultarIdServicio && def.logo === 'principal' && def.logo2 === 'ninguno');
ok('lo guardado roto vuelve a fábrica', opcionesVentaDoc({ logo: 'xx', ocultarMontosServicio: 'si' }).logo === 'principal' && !opcionesVentaDoc({ ocultarMontosServicio: 'si' }).ocultarMontosServicio);
ok('SERV desaparece si se oculta el identificador', unidadImpresa({ kind: 'servicio', unit: 'SERV' }, { ocultarIdServicio: true }) === '');
ok('un material conserva su unidad', unidadImpresa({ kind: 'material', unit: 'KG' }, { ocultarIdServicio: true }) === 'KG');
ok('servicio con unidad propia (HORA) la conserva', unidadImpresa({ kind: 'servicio', unit: 'HORA' }, { ocultarIdServicio: true }) === 'HORA');

// ── Comprobaciones de fuente ──
const doc = fs.readFileSync('src/lib/ventaDocumento.ts', 'utf8');
ok('el papel recibe las opciones', doc.includes('export function ventaDocumentoHtml(d: VentaDocData, opciones?: Partial<VentaDocOpciones> | null)'));
ok('sin montos no sale la tabla de totales', doc.includes("${sinMontos ? '' : `<div>"));
ok('los logos se eligen', doc.includes("${logo1 ? `<img src=\"${logo1}\"/>` : ''}") && doc.includes('class="l2"'));
ok('lo oculto no se anuncia en el papel', !/montos ocultos|sin montos|oculto/i.test(doc.split('<!doctype html>')[1] || ''));
const cmq = fs.readFileSync('src/lib/contactoMaquinas.ts', 'utf8');
ok('el RIF solo enlaza con nombre compatible', cmq.includes('if (!otraEmpresa && nombresCompatibles(porRif.name, empresa?.name))'));
ok('la ficha nueva no repite un RIF ocupado', cmq.includes('numero: rifOcupado ? null : empresa?.rif'));
const pick = fs.readFileSync('src/components/ContactoPicker.tsx', 'utf8');
ok('el respaldo usa el prefijo empresa_ (no un UUID suelto como client_id)', pick.includes('elegir(`empresa_${x.empresa.id}`)'));
for (const f of ['src/screens/VentasScreen.tsx', 'src/components/VentaServiciosTab.tsx']) {
  const s = fs.readFileSync(f, 'utf8');
  ok(`${f}: imprime pasando por las opciones`, s.includes('docOpciones.pedir({') && s.includes('}, op), `${docKindLabel'));
  ok(`${f}: el modal de opciones va montado`, s.includes('{docOpciones.modal}'));
}
const modal = fs.readFileSync('src/components/VentaDocOpcionesModal.tsx', 'utf8');
ok('el modal recuerda por persona con try/catch', modal.includes('ventaDocOpciones:') && /try \{ await AsyncStorage\.setItem/.test(modal));
ok('las pastillas bajan de línea en el teléfono', modal.includes("flexWrap: 'wrap'"));
ok('modal con zIndex 9999', modal.includes('zIndex: 9999'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
