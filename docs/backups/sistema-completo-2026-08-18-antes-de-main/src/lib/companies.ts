// Visibilidad de empresas contratistas.
//
// - hidden:    empresa INACTIVA en TODO el sistema (incluido el módulo de comidas).
// - food_only: empresa que aparece SOLO en la distribución de comidas; se oculta
//              de cualquier otro selector, lista, leyenda o reporte del sistema
//              (p. ej. PNB Canica, que solo reparte comida).
export type CompanyFlags = { hidden?: boolean | null; food_only?: boolean | null };

/** ¿La empresa se muestra en el sistema GENERAL (todo MENOS comidas)? */
export function isGeneralCompany(c: CompanyFlags | null | undefined): boolean {
  return !!c && !c.hidden && !c.food_only;
}

/** Quita de una lista las empresas ocultas y las "solo comidas" (uso general). */
export function generalCompanies<T extends CompanyFlags>(list: T[] | null | undefined): T[] {
  return (list ?? []).filter(isGeneralCompany);
}
