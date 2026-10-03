// SEMANAS DEL MES CON CORTE ELEGIBLE (03-oct-2026).
//
// Nació para «Control camiones Entradas/Salidas» y «Transporte de escombros»
// (ReportsScreen): sus hojas salen UNA POR SEMANA del mes elegido. Desde que la
// creó la compañera (09-jul-2026) la semana se cortaba de DOMINGO a SÁBADO; la
// encargada lleva sus cuentas de LUNES a DOMINGO y las hojas no le cuadraban
// («la semana 3 comienza es el 14»). El cliente decidió: un selector del día en
// que EMPIEZA la semana — lunes, domingo o CUALQUIER otro día — que nace en
// domingo para poder reproducir las hojas viejas tal cual.
//
// ⭐ Es solo el PAPEL: estas hojas son planillas para llenar a mano, así que el
//    corte no mueve ni un dato — solo decide qué días caen en cada hoja.
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-semanas-mes.mjs).

/** 0 = domingo … 6 = sábado (igual que getUTCDay). */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;

/** Las pastillas del selector, en el orden en que la gente nombra la semana. */
export const CORTES_SEMANA: { dow: DiaSemana; corto: string }[] = [
  { dow: 1, corto: 'Lun' }, { dow: 2, corto: 'Mar' }, { dow: 3, corto: 'Mié' },
  { dow: 4, corto: 'Jue' }, { dow: 5, corto: 'Vie' }, { dow: 6, corto: 'Sáb' }, { dow: 0, corto: 'Dom' },
];

export type SemanaMes = { n: number; from: string; to: string; days: { name: string; iso: string }[] };

const isoUTC = (d: Date) => `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}-${`${d.getUTCDate()}`.padStart(2, '0')}`;

/**
 * Las semanas del mes dado (month0 = 0-based), empezando cada una en `inicio`.
 * Los días se RECORTAN al mes: la primera y la última semana solo traen los
 * días que caen dentro, así no aparecen fechas de otro mes. Numeradas 1..N.
 *
 * Con `inicio = 0` (domingo) devuelve EXACTAMENTE lo de siempre: las hojas ya
 * impresas se pueden reproducir igualitas (hay candado en la suite).
 */
export function semanasDelMes(year: number, month0: number, inicio: DiaSemana = 0): SemanaMes[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  // El día de corte en/antes del día 1 del mes.
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() - inicio + 7) % 7));
  const weeks: SemanaMes[] = [];
  let cur = start;
  let n = 0;
  while (cur <= last) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(cur);
      d.setUTCDate(cur.getUTCDate() + i);
      // El nombre sale del día REAL: con la semana empezando en lunes, la
      // primera columna es «Lunes», no un «Domingo» corrido.
      return { name: DIAS_SEMANA[(inicio + i) % 7], iso: isoUTC(d), inMonth: d.getUTCMonth() === month0 && d.getUTCFullYear() === year };
    }).filter((d) => d.inMonth).map(({ name, iso }) => ({ name, iso }));
    if (days.length) {
      n += 1;
      weeks.push({ n, from: days[0].iso, to: days[days.length - 1].iso, days });
    }
    const nx = new Date(cur);
    nx.setUTCDate(cur.getUTCDate() + 7);
    cur = nx;
  }
  return weeks;
}

/** «de lunes a domingo», para decir el corte en pantalla y en el papel. */
export function etiquetaCorteSemana(inicio: DiaSemana): string {
  const fin = ((inicio + 6) % 7) as DiaSemana;
  return `de ${DIAS_SEMANA[inicio].toLowerCase()} a ${DIAS_SEMANA[fin].toLowerCase()}`;
}
