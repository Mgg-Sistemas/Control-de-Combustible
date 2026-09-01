import { machineLabel, machineDiscriminante, machineMatches, type MaquinaIdentificable } from './machineLabel';
import { cmpText, norm } from './text';

/**
 * TOTAL POR EQUIPO — el informe de jornada visto máquina por máquina.
 *
 * Pedido del cliente 31-ago-2026: «en reportes, jornada, necesito una opción de
 * buscar por maquinaria en específico, que yo pueda buscar una maquinaria, y
 * poder tener un total generado por equipo, que yo pueda ver el total de horas
 * el total en dinero en un rango que yo elija o para días que elija».
 *
 * ⚠️ ESTE ARCHIVO NO CALCULA HORAS NI VUELVE A LEER LA BASE. Recibe el informe
 *    YA calculado por `generateRounds` y lo suma por máquina. Es a propósito:
 *    la fórmula de horas vive en `src/lib/hours.ts` y tiene que haber UNA sola.
 *    Si acá se recalculara, el panel diría un número y el informe otro — que es
 *    exactamente el bug de desincronización que ya se pagó una vez.
 *
 * ⚠️ Y NO LLEVA ABONOS NI SALDO. Los fletes, los abonos y el saldo por pagar son
 *    de la EMPRESA, no de la máquina: mostrar un saldo al lado de las horas de
 *    un equipo sería una cifra de cobro inventada. Acá van horas y monto, nada
 *    más.
 *
 * Vive aparte (solo importa libs puras) para poder probarlo sin montar la app.
 * Ver `scripts/test-jornada-por-maquina.mjs`.
 */

/**
 * Un día de jornada de UNA máquina, con las horas YA calculadas por el informe.
 *
 * `fecha` es el `round_date` de `machine_rounds`, que **ya es** el día de trabajo
 * de 7am a 7am (lo escribe `businessRoundDateOf`). Por eso acá se compara como
 * texto y NO se usa `jornadaWindowISO`: esa es para columnas de instante, y
 * aplicarla aquí desalinearía el filtro respecto del propio informe.
 */
export type DiaMaquina = {
  /** `AAAA-MM-DD` — el día de trabajo, no el del calendario. */
  fecha: string;
  /** Horas del turno de día (ya ancladas en vivo si la jornada sigue abierta). */
  dia: number;
  /** Horas del turno de noche (idem). */
  noche: number;
  /** Horas TRABAJADAS del día: día + noche − paradas + extras. */
  trabajadas: number;
  /** Precio EFECTIVO de esa jornada (congelado del corte, o el actual). */
  precioJornada: number | null;
  /** `(trabajadas / 12) × precioJornada`. 0 si ese día no había precio. */
  monto: number;
};

/** Por qué una máquina no trabajó. Espejo de `EstadoNoTrabajo` en jornadaEstados. */
export type EstadoMaquina = 'trabajo' | 'averia' | 'parada' | 'espera';

/** Lo mínimo que el resumen necesita de cada máquina del informe. */
export type MaquinaJornada = MaquinaIdentificable & {
  id: string;
  code: string;
  tipo: string;
  clasificacion: string;
  company: string;
  encargado: string;
  estado: EstadoMaquina;
  /** Motivo de la avería/parada, si no trabajó. */
  motivo?: string;
  porDia: readonly DiaMaquina[];
};

/**
 * Qué días entran en la cuenta: un rango continuo, o días sueltos marcados a
 * dedo («o cualquier forma que necesite» — a veces se quiere el lunes y el
 * jueves y nada más).
 */
export type AlcanceDias =
  | { modo: 'rango'; desde: string; hasta: string }
  | { modo: 'dias'; dias: readonly string[] };

/** El total de UNA máquina dentro del alcance elegido. */
export type TotalMaquina = {
  id: string;
  code: string;
  /** `NOMBRE · PLACA` — ver `machineLabel`. */
  etiqueta: string;
  /** Placa, serial o identificador. `'—'` si no tiene ninguno. */
  discriminante: string;
  tipo: string;
  clasificacion: string;
  company: string;
  encargado: string;
  estado: EstadoMaquina;
  motivo: string;
  /** Días con horas trabajadas > 0. Un día en cero NO cuenta como jornada. */
  jornadas: number;
  horasDia: number;
  horasNoche: number;
  horas: number;
  /** Suma de los montos DÍA POR DÍA. Ver la nota de `resumirPorMaquina`. */
  monto: number;
  /** Hubo días con horas y sin precio: el monto está incompleto y hay que decirlo. */
  sinPrecio: boolean;
  /** `monto / horas`. `null` si no trabajó — nunca NaN ni Infinity. */
  precioHoraEfectivo: number | null;
  dias: DiaMaquina[];
};

export type ResumenPorMaquina = {
  maquinas: TotalMaquina[];
  /** Máquinas que TRABAJARON (horas > 0). Las averiadas salen en la lista pero no acá. */
  equipos: number;
  jornadas: number;
  horas: number;
  horasDia: number;
  horasNoche: number;
  monto: number;
  /** Los días que de verdad entraron, ordenados y sin repetir. */
  diasCubiertos: string[];
  alcance: AlcanceDias;
};

/**
 * ¿Este día de trabajo entra en el alcance?
 *
 * ⚠️ UN ALCANCE IMPOSIBLE DEVUELVE `false` SIEMPRE, NUNCA "TODOS". Un rango al
 *    revés (desde > hasta) o una lista de días vacía significan «no elegiste
 *    nada», y caer de vuelta a todo el rango haría que la pantalla mostrara
 *    números que nadie pidió — con el agravante de que se pueden exportar. Es la
 *    misma lección de `rangoInvalido`/`sinDiasMarcados` en la pantalla de viajes.
 */
export function diaEnAlcance(fecha: string, alcance: AlcanceDias): boolean {
  // ⚠️ Se recorta a `AAAA-MM-DD` antes de comparar. `round_date` llega limpio
  //    hoy, pero si algún día trajera la hora pegada ('2026-08-30T00:00:00'),
  //    comparar el texto crudo dejaba fuera el ÚLTIMO día del rango —en
  //    silencio— mientras los de en medio sí pasaban. Y los dos modos
  //    discrepaban sobre el mismo dato: el rango por `<=`, los días sueltos por
  //    igualdad exacta.
  const f = String(fecha ?? '').trim().slice(0, 10);
  if (!f) return false;
  if (alcance.modo === 'dias') return alcance.dias.some((d) => String(d ?? '').trim().slice(0, 10) === f);
  if (!alcance.desde || !alcance.hasta) return false;
  if (alcance.desde > alcance.hasta) return false;
  // Inclusivo en los dos extremos, y comparando texto ISO — que ordena igual que
  // la fecha porque el formato es AAAA-MM-DD.
  return f >= alcance.desde.slice(0, 10) && f <= alcance.hasta.slice(0, 10);
}

/**
 * Cómo se rotula el alcance en el encabezado y en el nombre del archivo.
 *
 * ⚠️ CON DÍAS SUELTOS NUNCA DICE «del X al Y». Los días marcados no tienen por
 *    qué ser seguidos, y ese texto hacía leer dieciocho jornadas donde había
 *    dos. Mismo criterio que `etiquetaRangoViajes`.
 */
export function etiquetaAlcance(alcance: AlcanceDias, dmy: (iso: string) => string): string {
  if (alcance.modo === 'dias') {
    // Sin repetidos: el rótulo va en el nombre del PDF, y «2 jornadas sueltas:
    // 25/08, 25/08» es una cuenta que no existe.
    const dias = Array.from(new Set(alcance.dias.filter(Boolean))).sort();
    if (dias.length === 0) return 'sin días marcados';
    if (dias.length === 1) return dmy(dias[0]);
    if (dias.length <= 8) return `${dias.length} jornadas sueltas: ${dias.map(dmy).join(', ')}`;
    return `${dias.length} jornadas sueltas entre ${dmy(dias[0])} y ${dmy(dias[dias.length - 1])}`;
  }
  if (!alcance.desde || !alcance.hasta) return 'sin rango';
  if (alcance.desde > alcance.hasta) return `rango al revés (${dmy(alcance.desde)} → ${dmy(alcance.hasta)})`;
  return alcance.desde === alcance.hasta ? dmy(alcance.desde) : `del ${dmy(alcance.desde)} al ${dmy(alcance.hasta)}`;
}

/**
 * Las máquinas que coinciden con lo que se escribió.
 *
 * La IDENTIDAD la decide `machineMatches` (nombre, placa, serial e
 * identificador) — es la función que ya usa el resto del sistema y no se
 * reimplementa acá. Encima se agrega una pasada con `norm` para poder buscar
 * también por tipo, clasificación, empresa o encargado, y para que los acentos
 * no estorben («camion» tiene que encontrar «CAMIÓN»).
 *
 * ⚠️ La pasada de acentos va ACÁ y no dentro de `machineMatches`: ese archivo no
 *    tiene un solo import a propósito, y su prueba lo carga contando con eso.
 *
 * No muta ni reordena lo que recibe.
 */
export function filtrarMaquinas<M extends MaquinaJornada>(maquinas: readonly M[], texto: string): M[] {
  const q = norm(texto || '').trim();
  if (!q) return [...maquinas];
  return maquinas.filter((m) =>
    machineMatches(m, texto) ||
    [m.code, m.plate, m.serial, m.identifier, m.tipo, m.clasificacion, m.company, m.encargado]
      .some((f) => f != null && norm(String(f)).includes(q))
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ¿Este precio de jornada sirve para cobrar?
 *
 * Nulo, cero, o un número que no es número (llegó texto basura de la base) son
 * todos lo mismo a los efectos del reporte: NO hay tarifa. Se juntan a
 * propósito porque los tres producen $0, y un $0 sin aviso se lee como «esta
 * máquina no generó nada» en vez de «nadie le puso precio».
 */
function precioUtil(p: number | null | undefined): boolean {
  return p != null && Number.isFinite(p) && p > 0;
}

/**
 * Suma el informe por máquina dentro del alcance elegido.
 *
 * ⚠️ EL MONTO ES LA SUMA DÍA POR DÍA, NO `horas / 12 × precio`. Si el precio de
 *    una máquina cambió a mitad de la semana, cada jornada vale lo que valía ESE
 *    día (el corte cerrado guarda su precio congelado). Multiplicar el total de
 *    horas por un solo precio da una cifra que no cuadra con lo que se cobró, y
 *    esto es un documento con el que se cobra.
 *
 * ⚠️ Y NO SE VUELVEN A TOPAR LAS HORAS. Vienen ya topadas a 12 h por turno desde
 *    el informe; volver a acotarlas acá las recortaría dos veces.
 *
 * `soloIds` limita a las máquinas marcadas. Filtrar NO cambia la aritmética de
 * las que quedan: cada máquina suma exactamente igual con o sin filtro.
 */
export function resumirPorMaquina(
  maquinas: readonly MaquinaJornada[],
  alcance: AlcanceDias,
  opts?: { soloIds?: ReadonlySet<string> },
): ResumenPorMaquina {
  const soloIds = opts?.soloIds;
  const diasCubiertos = new Set<string>();
  const filas: TotalMaquina[] = [];
  // ⚠️ LOS TOTALES SE ACUMULAN EN CRUDO, NO SUMANDO LAS FILAS YA REDONDEADAS.
  //    Redondear por máquina y volver a sumar da hasta unos centavos de más que
  //    el informe, que acumula crudo y redondea UNA sola vez al mostrar. Y los
  //    dos números salen en la MISMA pantalla: basta un centavo de diferencia
  //    para que nadie sepa cuál de los dos creer.
  let tHorasDia = 0, tHorasNoche = 0, tHoras = 0, tMonto = 0, tJornadas = 0, tEquipos = 0;

  for (const m of maquinas) {
    if (soloIds && !soloIds.has(m.id)) continue;
    const dias = m.porDia.filter((d) => diaEnAlcance(d.fecha, alcance));
    let horasDia = 0, horasNoche = 0, horas = 0, monto = 0, jornadas = 0, sinPrecio = false;
    for (const d of dias) {
      horasDia += d.dia;
      horasNoche += d.noche;
      horas += d.trabajadas;
      // Un monto no finito (un precio que llegó como texto basura) se cuenta
      // como 0 y se avisa. Sin esto el PDF imprimía «$NaN» cuatro veces.
      monto += Number.isFinite(d.monto) ? d.monto : 0;
      // «0 horas = parada»: un día sin horas trabajadas no es una jornada.
      if (d.trabajadas > 0) {
        jornadas += 1;
        diasCubiertos.add(d.fecha);
        // ⚠️ Un precio en CERO cuenta como «sin precio», igual que un nulo. Los
        //    dos producen $0, y el que no avisa es el peor de los dos: un total
        //    en cero se lee como «esta máquina no generó», cuando lo que pasa
        //    es que nadie le puso tarifa.
        if (!precioUtil(d.precioJornada)) sinPrecio = true;
      }
    }
    if (horas > 0) {
      tHorasDia += horasDia; tHorasNoche += horasNoche; tHoras += horas;
      tMonto += monto; tJornadas += jornadas; tEquipos += 1;
    }
    horasDia = round2(horasDia); horasNoche = round2(horasNoche);
    horas = round2(horas); monto = round2(monto);
    filas.push({
      id: m.id,
      code: m.code,
      etiqueta: machineLabel(m) || m.code,
      discriminante: machineDiscriminante(m) ?? '—',
      tipo: m.tipo,
      clasificacion: m.clasificacion,
      company: m.company,
      encargado: m.encargado,
      estado: m.estado,
      motivo: m.motivo ?? '',
      jornadas,
      horasDia,
      horasNoche,
      horas,
      monto,
      sinPrecio,
      precioHoraEfectivo: horas > 0 ? round2(monto / horas) : null,
      // Copia de cada día, no la referencia: `dias` es mutable, y devolver los
      // mismos objetos dejaría que tocar la salida le cambie las horas al
      // informe que la produjo.
      dias: dias.map((d) => ({ ...d })).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)),
    });
  }

  // Más horas primero; el desempate por etiqueta —y después por id— es lo que
  // hace que dos corridas de los mismos datos salgan idénticas aunque lleguen en
  // distinto orden. Sin el id, dos máquinas con el MISMO nombre, sin placa ni
  // serial y las dos en cero (las retroexcavadoras averiadas) quedaban a merced
  // del orden de entrada.
  filas.sort((a, b) => (b.horas - a.horas) || cmpText(a.etiqueta, b.etiqueta) || cmpText(a.id, b.id));

  return {
    maquinas: filas,
    equipos: tEquipos,
    jornadas: tJornadas,
    horas: round2(tHoras),
    horasDia: round2(tHorasDia),
    horasNoche: round2(tHorasNoche),
    monto: round2(tMonto),
    diasCubiertos: Array.from(diasCubiertos).sort(),
    // Copia del alcance: guardarlo por referencia dejaba que mutar la lista de
    // días después cambiara el rótulo con el que ya se nombró un PDF.
    alcance: alcance.modo === 'dias' ? { modo: 'dias', dias: [...alcance.dias] } : { ...alcance },
  };
}

// ── El PDF ──────────────────────────────────────────────────────────────────
// ⚠️ OJO CON LAS COMILLAS INVERTIDAS: todo esto es un template literal, así que
//    una sola comilla invertida suelta —incluso dentro de un comentario— rompe
//    el archivo COMPLETO y el error que sale no apunta acá.

const esc = (s: any): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ⚠️ EL MISMO FORMATO QUE EL INFORME (ver `usd`/`nH` en ReportsScreen). Con
//    `toFixed` pelado salía «$1234.50» al lado de un informe que dice
//    «$1.234,50»: dos PDF del mismo corte escritos distinto.
const nh = (n: number) => `${Number((Number.isFinite(n) ? n : 0).toFixed(2)).toLocaleString()}`;
const usd = (n: number) =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ICONO_ESTADO: Record<EstadoMaquina, string> = {
  trabajo: '', averia: '🔴', parada: '🟡', espera: '⏳',
};

/**
 * Cuerpo HTML del reporte «TOTAL POR EQUIPO». El marco (encabezado, logos, pie)
 * lo pone la pantalla con `pdfShell`, igual que el resto de los reportes.
 *
 * `money: false` = modo «solo horas», el mismo interruptor que ya tiene el
 * informe de jornada: hay quien tiene que ver las horas sin ver los precios.
 */
export function htmlPorMaquina(
  resumen: ResumenPorMaquina,
  opts: { money: boolean; conDetalleDiario: boolean; dmy: (iso: string) => string },
): string {
  const { money, conDetalleDiario, dmy } = opts;
  const tot = `
    <div class="tot">
      <b>${resumen.equipos}</b> equipo(s) · <b>${resumen.jornadas}</b> jornada(s) ·
      ☀️ ${nh(resumen.horasDia)} h · 🌙 ${nh(resumen.horasNoche)} h ·
      <b>${nh(resumen.horas)} h trabajadas</b>${money ? ` · <b>${usd(resumen.monto)}</b>` : ''}
    </div>`;

  if (resumen.maquinas.length === 0) {
    return `${tot}<p class="vacio">No hay equipos para lo que se eligió.</p>`;
  }

  const filas = resumen.maquinas.map((m) => {
    const detalle = conDetalleDiario && m.dias.length > 0
      ? `<tr class="det"><td colspan="${money ? 7 : 5}">
           <table class="sub">
             <tr><th>Jornada</th><th>☀️ Día</th><th>🌙 Noche</th><th>Trabajadas</th>${money ? '<th>Monto</th>' : ''}</tr>
             ${m.dias.map((d) => `<tr>
               <td>${esc(dmy(d.fecha))}</td>
               <td>${nh(d.dia)}</td>
               <td>${nh(d.noche)}</td>
               <td>${nh(d.trabajadas)}</td>
               ${money ? `<td>${precioUtil(d.precioJornada) ? usd(d.monto) : '⚠️ sin precio'}</td>` : ''}
             </tr>`).join('')}
           </table></td></tr>`
      : '';
    const nota = m.estado !== 'trabajo'
      ? `<div class="nota">${ICONO_ESTADO[m.estado] ?? '•'} ${esc(m.motivo || 'No trabajó')}</div>`
      : '';
    return `<tr>
      <td><b>${esc(m.etiqueta)}</b><div class="chico">${esc(m.clasificacion)} · ${esc(m.company)}</div>${nota}</td>
      <td class="n">${m.jornadas}</td>
      <td class="n">${nh(m.horasDia)}</td>
      <td class="n">${nh(m.horasNoche)}</td>
      <td class="n"><b>${nh(m.horas)}</b></td>
      ${money ? `<td class="n">${m.precioHoraEfectivo == null ? '—' : usd(m.precioHoraEfectivo)}</td>` : ''}
      ${money ? `<td class="n"><b>${usd(m.monto)}</b>${m.sinPrecio ? '<div class="chico">⚠️ incompleto: hubo jornadas sin precio</div>' : ''}</td>` : ''}
    </tr>${detalle}`;
  }).join('');

  return `${tot}
    <table class="eq">
      <tr>
        <th>Equipo</th><th class="n">Jornadas</th><th class="n">☀️ Día</th>
        <th class="n">🌙 Noche</th><th class="n">Horas</th>
        ${money ? '<th class="n">$/hora</th><th class="n">Total</th>' : ''}
      </tr>
      ${filas}
    </table>
    <style>
      .tot { font-size: 13px; margin: 6px 0 10px; }
      table.eq { width: 100%; border-collapse: collapse; font-size: 11px; }
      table.eq th { background: #1e3a5f; color: #fff; padding: 5px; text-align: left; }
      table.eq td { border-bottom: 1px solid #ddd; padding: 5px; vertical-align: top; }
      table.eq td.n, table.eq th.n { text-align: right; }
      .chico { color: #666; font-size: 9.5px; }
      .nota { color: #b42318; font-size: 9.5px; }
      tr.det td { background: #f7f9fc; padding: 4px 5px 8px 18px; }
      table.sub { width: 100%; border-collapse: collapse; font-size: 10px; }
      table.sub th { background: #e8eef7; color: #1e3a5f; padding: 3px 5px; text-align: right; }
      table.sub th:first-child { text-align: left; }
      table.sub td { padding: 3px 5px; text-align: right; border-bottom: 1px solid #eee; }
      table.sub td:first-child { text-align: left; }
      .vacio { color: #666; font-size: 12px; }
    </style>`;
}
