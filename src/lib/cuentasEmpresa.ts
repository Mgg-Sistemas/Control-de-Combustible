// 🏢 Resolución y filtrado de empresa en Cuentas por Pagar y por Cobrar.
// Permite vincular cuentas a una empresa (deudora o receptora) y filtrar por una o varias.
import { norm, matchNorm } from './text';
import type { Cuenta, Company, InventoryRequirement, PurchaseOrder } from '../types/database';

export const ID_SIN_EMPRESA = '__sin_empresa__';
export const NOMBRE_SIN_EMPRESA = 'Sin empresa asignada';

export interface InfoEmpresaCuenta {
  id: string;
  name: string;
}

/** Inyecta la etiqueta [EMPRESA:id:nombre] en la nota de la cuenta */
export function inyectarEmpresaEnNota(
  notaActual: string | null | undefined,
  empresaId: string | null | undefined,
  empresaNombre?: string | null | undefined
): string | null {
  const base = (notaActual || '').replace(/\[EMPRESA:[^\]]+\]/gi, '').trim();
  if (!empresaId || empresaId === ID_SIN_EMPRESA) return base || null;
  const tag = `[EMPRESA:${empresaId}:${(empresaNombre || '').trim()}]`;
  return base ? `${base}\n${tag}` : tag;
}

/** Extrae la etiqueta [EMPRESA:id:nombre] si existe en la nota */
export function extraerEmpresaDeNota(nota?: string | null): InfoEmpresaCuenta | null {
  if (!nota) return null;
  const match = nota.match(/\[EMPRESA:([^:]+):([^\]]*)\]/i);
  if (match) {
    const id = match[1].trim();
    const name = match[2].trim();
    if (id) return { id, name: name || 'Empresa' };
  }
  return null;
}

/** Quita la etiqueta [EMPRESA:...] de la nota para que no ensucie la vista */
export function limpiarEmpresaDeNota(nota?: string | null): string {
  if (!nota) return '';
  return nota.replace(/\[EMPRESA:[^\]]+\]/gi, '').trim();
}

/**
 * Resuelve la empresa asociada a una Cuenta considerando:
 * 1. Etiqueta [EMPRESA:id:nombre] en nota
 * 2. `c.company_id` (para por_cobrar o enlaces directos)
 * 3. `c.order_id` cruzado con Requerimientos o PurchaseOrders
 * 4. Código REQ-xxxx en concepto o nota cruzado con Requerimientos
 * 5. Mención de la razón social o nombre de la empresa en el concepto o nota
 */
export function resolverEmpresaDeCuenta(
  c: Partial<Cuenta> | null | undefined,
  contexto?: {
    companies?: readonly Company[];
    requirements?: readonly InventoryRequirement[];
    orders?: readonly PurchaseOrder[];
  }
): InfoEmpresaCuenta {
  if (!c) return { id: ID_SIN_EMPRESA, name: NOMBRE_SIN_EMPRESA };

  const companies = contexto?.companies || [];
  const requirements = contexto?.requirements || [];
  const orders = contexto?.orders || [];

  const buscarCompany = (idOrName?: string | null): Company | undefined => {
    if (!idOrName) return undefined;
    const clean = idOrName.trim();
    return (
      companies.find((co) => co.id === clean) ||
      companies.find((co) => norm(co.name) === norm(clean))
    );
  };

  // 1. Etiqueta explícita en nota
  const deNota = extraerEmpresaDeNota(c.nota);
  if (deNota) {
    const matched = buscarCompany(deNota.id);
    if (matched) return { id: matched.id, name: matched.name };
    return deNota;
  }

  // 2. company_id directo en la cuenta
  if (c.company_id) {
    const matched = buscarCompany(c.company_id);
    if (matched) return { id: matched.id, name: matched.name };
  }

  // 3. order_id cruzado con Requerimientos o PurchaseOrders
  if (c.order_id) {
    const req = requirements.find((r) => r.id === c.order_id);
    if (req?.company_id) {
      const matched = buscarCompany(req.company_id);
      if (matched) return { id: matched.id, name: matched.name };
    }
    const ord = orders.find((o) => o.id === c.order_id);
    if (ord?.company_id) {
      const matched = buscarCompany(ord.company_id);
      if (matched) return { id: matched.id, name: matched.name };
    }
  }

  // 4. Mención de código de requerimiento REQ-#### en concepto o nota
  const textoCompleto = `${c.concepto || ''} ${c.nota || ''}`;
  const reqMatch = textoCompleto.match(/REQ-\d+/i);
  if (reqMatch) {
    const reqCode = reqMatch[0].toUpperCase();
    const req = requirements.find((r) => (r.code || '').toUpperCase() === reqCode);
    if (req?.company_id) {
      const matched = buscarCompany(req.company_id);
      if (matched) return { id: matched.id, name: matched.name };
    }
  }

  // 5. Mención textual del nombre de alguna de las empresas del catálogo
  if (textoCompleto.trim() && companies.length > 0) {
    const nTexto = norm(textoCompleto);
    // Ordenar empresas por longitud de nombre descendente para que "CONSTRUCCIONES LICCIONE" coincida antes que "LICCIONE"
    const sorted = [...companies].sort((a, b) => (b.name || '').length - (a.name || '').length);
    for (const co of sorted) {
      if (!co.name || co.hidden || co.food_only) continue;
      const nName = norm(co.name);
      if (nName.length >= 3 && nTexto.includes(nName)) {
        return { id: co.id, name: co.name };
      }
      // Casos comunes de alias abreviados en almacén / taller
      if (nName.includes('golden') && nTexto.includes('golden')) {
        return { id: co.id, name: co.name };
      }
      if (nName.includes('liccione') && nTexto.includes('liccione')) {
        return { id: co.id, name: co.name };
      }
      if (nName.includes('ilusiones') && nTexto.includes('ilusiones')) {
        return { id: co.id, name: co.name };
      }
      if (nName.includes('guaira') && nTexto.includes('guaira')) {
        return { id: co.id, name: co.name };
      }
      if (nName.includes('cantera') && nTexto.includes('cantera')) {
        return { id: co.id, name: co.name };
      }
    }
  }

  return { id: ID_SIN_EMPRESA, name: NOMBRE_SIN_EMPRESA };
}

/**
 * Filtra una cuenta según las empresas seleccionadas en `empresaSel`.
 * Si `empresaSel` está vacío, pasan todas las cuentas.
 */
export function pasaFiltroEmpresas(
  empresaIdDeCuenta: string,
  empresaSel: ReadonlySet<string>
): boolean {
  if (empresaSel.size === 0) return true;
  return empresaSel.has(empresaIdDeCuenta);
}

