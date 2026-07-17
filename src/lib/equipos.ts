// Clasificación de un equipo por su CÓDIGO/nombre en un tipo con nombre propio
// (JUMBO, PAYLOADER, RETROEXCAVADORA…). Lo usan el Conteo de equipos (reportes) y
// las Capas del mapa, para que ambos agrupen EXACTAMENTE igual.
export function equipCategory(code: string): string {
  const c = (code || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // ── Camiones: cada tipo con su nombre propio (no un cajón genérico "CAMION"). ──
  if (c.includes('volteo') || c.includes('toronto')) return 'CAMIÓN VOLTEO - TORONTO';
  if (c.includes('pitman')) return 'CAMIÓN BRAZO PITMAN';
  // Va antes que plataforma: "CAMION GRUA PLATAFORMA" es su propia categoría.
  if (c.includes('grua') && c.includes('plataforma')) return 'CAMIÓN GRÚA PLATAFORMA';
  if (c.includes('grua')) return 'GRÚAS TELESCÓPICAS';
  // OJO: usar límite de palabra para "cava" — "RETROEXCAVADORA" contiene "cava".
  if (/\bcava\b/.test(c)) return 'CAMIÓN CAVA SECA';
  if (c.includes('cesta')) return 'CAMIÓN CESTA';
  if (c.includes('soldadura')) return 'CAMIÓN DE SOLDADURA';
  if (c.includes('refrigerad')) return 'CAMIÓN REFRIGERADO';
  if (c.includes('plataforma')) return 'CAMIÓN PLATAFORMA';
  if (c.includes('pick') || c.includes('camioneta')) return 'CAMIONETA PICK-UP';
  if (c.includes('camion') && c.includes('servicio')) return 'CAMIÓN DE SERVICIO';
  // ── Otros tipos de maquinaria. ──
  if (c.includes('jumbo')) return 'JUMBO';
  if (c.includes('oruga')) return 'TRACTORES DE ORUGA';
  if (c.includes('lowboy') || c.includes('low boy')) return 'CHUTO CON LOWBOY';
  if (c.includes('batea')) return 'CHUTO CON BATEA';
  if (c.includes('volqueta')) return 'CHUTO CON VOLQUETA';
  if (c.includes('cisterna') && c.includes('agua')) return 'CISTERNA DE AGUA';
  // Tanque/cisterna de combustible (diesel/gasoil) → TANQUE DE COMBUSTIBLE.
  if (c.includes('tanque') || c.includes('combustible') || (c.includes('cisterna') && (c.includes('diesel') || c.includes('gasoil')))) return 'TANQUE DE COMBUSTIBLE';
  if (c.includes('compresor')) return 'COMPRESOR CON MARTILLO';
  // "MINI" / "MINI SHOWER" → MINISHOWER (evita que queden como "MINI").
  if (c.includes('mini') || c.includes('shower')) return 'MINISHOWER';
  return ((code || '').trim().split(/\s+/)[0] || '—').toUpperCase();
}

// ── Zona / ubicación a disposición ──────────────────────────────────────────
// La zona es un campo propio de la máquina (machinery.zona): Gobernación, FANB,
// CVM, Zona Este… El vacío/nulo se muestra como "Sin zona".
export function zonaLabel(zona: string | null | undefined): string {
  return (zona || '').trim() || 'Sin zona';
}

// Orden preferido de las zonas en los reportes (las conocidas primero; el resto
// alfabético; "Sin zona" siempre al final).
const ZONA_ORDER = ['Gobernación', 'FANB', 'CVM', 'Zona Este'];
export function sortZonas(names: string[]): string[] {
  return [...names].sort((a, b) => {
    if (a === 'Sin zona') return 1;
    if (b === 'Sin zona') return -1;
    const ia = ZONA_ORDER.indexOf(a), ib = ZONA_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b, 'es');
  });
}
