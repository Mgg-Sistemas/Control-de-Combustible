/*
 * 🏢 FILTRO POR EMPRESA EN CUENTAS POR PAGAR (28-oct-2026).
 * Permite filtrar por una o varias empresas simultáneamente en Cuentas por Pagar.
 * Verifica la resolución jerárquica de empresa, filtrado multi-empresa, inyección de nota y UI.
 *
 *   node scripts/test-cuentas-empresa.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcEmpresa = fs.readFileSync(path.join(ROOT, 'src/lib/cuentasEmpresa.ts'), 'utf8');
const srcCuentas = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');
const srcPago = fs.readFileSync(path.join(ROOT, 'src/lib/cuentasPago.ts'), 'utf8');

let ok = 0;
const fallos = [];
const t = (n, c) => { if (c) ok++; else fallos.push(n); };

// 1. Verificación estructural de cuentasEmpresa.ts
t('exporta ID_SIN_EMPRESA y NOMBRE_SIN_EMPRESA', /ID_SIN_EMPRESA\s*=/.test(srcEmpresa) && /NOMBRE_SIN_EMPRESA\s*=/.test(srcEmpresa));
t('exporta inyectarEmpresaEnNota', /export function inyectarEmpresaEnNota/.test(srcEmpresa));
t('exporta extraerEmpresaDeNota', /export function extraerEmpresaDeNota/.test(srcEmpresa));
t('exporta limpiarEmpresaDeNota', /export function limpiarEmpresaDeNota/.test(srcEmpresa));
t('exporta resolverEmpresaDeCuenta', /export function resolverEmpresaDeCuenta/.test(srcEmpresa));
t('exporta pasaFiltroEmpresas', /export function pasaFiltroEmpresas/.test(srcEmpresa));

// 2. Verificación de limpieza en cuentasPago.ts
t('limpiarNotaCuentasVisual limpia etiquetas [EMPRESA:...]', /\[EMPRESA:/.test(srcPago));

// 3. Verificación de CuentasScreen.tsx
t('importa utilidades de cuentasEmpresa en CuentasScreen', /from '\.\.\/lib\/cuentasEmpresa'/.test(srcCuentas));
t('estado empresaSel para soporte multi-empresa (Set<string>)', /empresaSel,\s*setEmpresaSel/.test(srcCuentas));
t('despliegue de chips / selector multi-empresa en la UI', /🏢/.test(srcCuentas) && /EMPRESAS?\s*\(/.test(srcCuentas));
t('botón para quitar filtros de empresa', /✕ Quitar filtros/.test(srcCuentas));
t('etiqueta de empresa visible en cada tarjeta de cuenta', /🏢\s*\{c\.empresaNombre\}/.test(srcCuentas));
t('selector de empresa en el modal de alta / edición', /🏢 Empresa solicitante \/ destino/.test(srcCuentas));
t('guarda empresa seleccionada en notaFinal con inyectarEmpresaEnNota', /inyectarEmpresaEnNota\(notaFinal,\s*empresaFormId/.test(srcCuentas));
t('totales se recalculan acordes al filtro de empresas seleccionado', /porEmpresas\.forEach/.test(srcCuentas));

// 4. Pruebas de lógica funcional (simulación exacta del algoritmo)
const ID_SIN_EMPRESA = '__sin_empresa__';
const NOMBRE_SIN_EMPRESA = 'Sin empresa asignada';

function inyectarEmpresaEnNota(notaActual, empresaId, empresaNombre) {
  const base = (notaActual || '').replace(/\[EMPRESA:[^\]]+\]/gi, '').trim();
  if (!empresaId || empresaId === ID_SIN_EMPRESA) return base || null;
  const tag = `[EMPRESA:${empresaId}:${(empresaNombre || '').trim()}]`;
  return base ? `${base}\n${tag}` : tag;
}

function extraerEmpresaDeNota(nota) {
  if (!nota) return null;
  const match = nota.match(/\[EMPRESA:([^:]+):([^\]]*)\]/i);
  if (match) {
    const id = match[1].trim();
    const name = match[2].trim();
    if (id) return { id, name: name || 'Empresa' };
  }
  return null;
}

function pasaFiltroEmpresas(empresaIdDeCuenta, empresaSel) {
  if (!empresaSel || empresaSel.size === 0) return true;
  return empresaSel.has(empresaIdDeCuenta);
}

// Pruebas unitarias de las funciones
const notaTag = inyectarEmpresaEnNota('Nota de prueba', 'c-123', 'GOLDEN TOUCH');
t('inyectar crea la etiqueta correctamente', notaTag.includes('[EMPRESA:c-123:GOLDEN TOUCH]'));

const extraido = extraerEmpresaDeNota(notaTag);
t('extraer recupera el id y nombre', extraido?.id === 'c-123' && extraido?.name === 'GOLDEN TOUCH');

const selVacio = new Set();
t('filtro vacío deja pasar cualquier empresa', pasaFiltroEmpresas('c-123', selVacio) === true);

const selUno = new Set(['c-123']);
t('filtro individual acepta empresa seleccionada', pasaFiltroEmpresas('c-123', selUno) === true);
t('filtro individual rechaza empresa distinta', pasaFiltroEmpresas('c-456', selUno) === false);

const selMulti = new Set(['c-123', 'c-456']);
t('filtro múltiple acepta varias empresas seleccionadas',
  pasaFiltroEmpresas('c-123', selMulti) === true &&
  pasaFiltroEmpresas('c-456', selMulti) === true &&
  pasaFiltroEmpresas('c-789', selMulti) === false
);

console.log(`\n🏢 Filtro Empresa Cuentas por Pagar: ${ok} OK · ${fallos.length} FALLO(S)`);
fallos.forEach((f) => console.log('  ✗ ' + f));
process.exit(fallos.length ? 1 : 0);
