// Emparejador fino entre una máquina y una fila del tabulador (price_tariffs).
// La clave del tabulador es `modelo`. Aquí decidimos, a partir del `code`
// (y `tipo` como pista), a qué modelo del tabulador corresponde cada máquina.
// Devuelve el `modelo` (string) o null si no empareja (queda para revisión manual).

const norm = (s: string | null | undefined): string =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .trim();

export interface MachineLike {
  clasificacion?: string | null;
  tipo?: string | null;
  code?: string | null;
}

// Reglas ordenadas de MÁS específico a MÁS general. Primera que aplique gana.
// `c` = code normalizado, `t` = tipo normalizado.
type Rule = { modelo: string; test: (c: string, t: string) => boolean };

const RULES: Rule[] = [
  // Tractores de oruga (por número de serie D6..D9)
  { modelo: 'Tractor de oruga D9', test: (c, t) => (c.includes('d9') || t.includes('tractor')) && c.includes('d9') },
  { modelo: 'Tractor de oruga D8', test: (c) => c.includes('d8') },
  { modelo: 'Tractor de oruga D7', test: (c) => c.includes('d7') },
  { modelo: 'Tractor de oruga D6', test: (c) => c.includes('d6') },

  // Grúas telescópicas por tonelaje
  { modelo: 'Grúas telescópicas 70 Ton', test: (c, t) => (c.includes('telescopica') || t.includes('grua telescopica')) && c.includes('70') },
  { modelo: 'Grúas telescópicas 50 Ton', test: (c, t) => (c.includes('telescopica') || t.includes('grua telescopica')) && c.includes('50') },
  { modelo: 'Grúas telescópicas 30 Ton', test: (c, t) => (c.includes('telescopica') || t.includes('grua telescopica')) && c.includes('30') },
  { modelo: 'Camion Grua plataforma', test: (c, t) => t.includes('grua de plataforma') || (c.includes('grua') && c.includes('plataforma')) },

  // Jumbos por modelo
  { modelo: 'Jumbo con Martillo', test: (c, t) => (t.includes('jumbo') || c.includes('jumbo') || c.includes('excavad')) && c.includes('martillo') },
  { modelo: 'Jumbo 345', test: (c) => c.includes('345') },
  { modelo: 'Jumbo 330', test: (c) => c.includes('330') },
  { modelo: 'Jumbo 320', test: (c) => c.includes('320') },

  // Retroexcavadoras
  { modelo: 'Retroexcavadora con martillo', test: (c, t) => (t.includes('retro') || c.includes('retro')) && c.includes('martillo') },
  { modelo: 'Retroexcavadora', test: (c, t) => t.includes('retroexcavadora') || c.includes('retro') },

  // Brazo pitman por tonelaje
  { modelo: 'Camion brazo pitman 12 ton', test: (c) => c.includes('pitman') && c.includes('12') },
  { modelo: 'Camion brazo pitman 9 ton', test: (c) => c.includes('pitman') && c.includes('9 ton') },

  // Camiones de servicio / especiales
  { modelo: 'Camion cava seca 10 ton', test: (c) => c.includes('cava seca') },
  { modelo: 'Camion Refrigerado', test: (c) => c.includes('refrigerad') },
  { modelo: 'Camion de soldadura', test: (c) => c.includes('soldadura') },
  { modelo: 'Camion de servicio', test: (c, t) => (t.includes('servicio') || c.includes('servicio')) && !c.includes('soldadura') },
  { modelo: 'Autobus', test: (c) => c.includes('autobus') },
  { modelo: 'Camionetas Pick-up', test: (c, t) => c.includes('pick') || t.includes('pick up') },

  // Cisternas
  { modelo: 'Cisterna de Agua', test: (c, t) => (c.includes('cisterna') || t.includes('cisterna')) && c.includes('agua') },
  { modelo: 'Cisterna de diesel', test: (c, t) => (c.includes('cisterna') || t.includes('cisterna')) && (c.includes('diesel') || c.includes('gasoil')) },

  // Soporte / remoción varios
  { modelo: 'luminaria', test: (c) => c.includes('luminaria') },
  { modelo: 'Montacarga', test: (c, t) => c.includes('montacarga') || t.includes('montacarga') },
  { modelo: 'Mini shower', test: (c, t) => t.includes('mini shower') || (c.includes('mini') && c.includes('shower')) },
  { modelo: 'Compresor Con martillo', test: (c) => c.includes('compresor') },
  { modelo: 'Payloader', test: (c, t) => c.includes('payload') || c.includes('paylo') || t.includes('payloader') || t.includes('cargador') },

  // Transporte
  { modelo: 'Chuto con batea', test: (c) => c.includes('batea') },
  { modelo: 'Chuto con lowboy', test: (c) => c.includes('lowboy') || c.includes('low-boy') || c.includes('low boy') },
  { modelo: 'Chuto con Volqueta', test: (c) => c.includes('chuto') && c.includes('volqueta') },
  { modelo: 'Camion Volteo Toronto', test: (c) => c.includes('toronto') },
  { modelo: 'Camion Plataforma 8 Ton', test: (c) => c.includes('plataforma') && !c.includes('grua') },

  // ── Respaldos genéricos (van al FINAL: solo si ningún modelo específico aplicó) ──
  // Cualquier otro jumbo/excavadora (225, 325, 336, Sany, Case, XCMG, 323…) → precio de Jumbo genérico.
  { modelo: 'Jumbo (otros)', test: (c, t) => t.includes('jumbo') || c.includes('jumbo') },
  // Cualquier volteo/volqueta suelto (no chuto, no Toronto) → precio de camión.
  { modelo: 'Volteo / Volqueta', test: (c, t) => t.includes('volqueta') || c.includes('volteo') || c.includes('volqueta') },
];

/** Devuelve el `modelo` del tabulador que corresponde a la máquina, o null. */
export function matchTariffModelo(m: MachineLike): string | null {
  const c = norm(m.code);
  const t = norm(m.tipo);
  for (const r of RULES) {
    try {
      if (r.test(c, t)) return r.modelo;
    } catch {
      /* regla defensiva */
    }
  }
  return null;
}
