// HORÓMETRO DE TRABAJO (23-sep-2026) — la regla, sin red.
//
// Pedido del cliente: pagar ciertas máquinas por lo que marca el HORÓMETRO (final − inicial
// del turno) y no por las horas que declara la jornada del inspector. Diseño en
// docs/superpowers/specs/2026-09-23-horometro-trabajo-design.md (4.1, 4.4 y 5).
//
// ⭐ UNA LECTURA POR MÁQUINA, DÍA DE JORNADA Y TURNO (día / noche). Nunca se borra; se corrige.
//    La base la VALIDA (marca, no rechaza) y acá está el ESPEJO EXACTO de esa validación
//    (`validarLectura`) para que el teléfono y Control puedan avisar antes de guardar.
//
// ⭐ UNA SOLA FUNCIÓN DE HORAS PAGABLES (`horasPagables`). Modo jornada, o modo horómetro
//    sin lectura válida completa → exactamente la fórmula de la jornada (`workedFromShifts`
//    de src/lib/hours.ts, reescrita acá porque este archivo NO importa nada). Modo horómetro
//    con lecturas válidas → final − inicial de cada turno, y NO suma extras ni resta paradas:
//    el horómetro ya las incluye y las excluye (si no, pagaría doble las extras).
//
// ⭐ EL DÍA CAE ENTERO. Si un turno con trabajo declarado no tiene lectura válida completa,
//    TODO el día se paga por jornada y el papel dice por qué («sin lectura» / «inválida»).
//    Mezclar medio día de horómetro con medio día de jornada duplicaría paradas y extras.
//
// ⭐ EL ORIGEN SIEMPRE SE DEVUELVE (`OrigenPago`): jornada · horometro · sin_lectura ·
//    invalida · averiado · sin_horometro_fisico. El recibo lo escribe tal cual.
//
// Sin imports: la prueba (scripts/test-horometro-trabajo.mjs) lo carga solo.

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const redondear = (n: number) => Math.round(n * 100) / 100;
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string): string => { const [y, m, d] = String(iso ?? '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
/** Horas para el papel: coma decimal, sin ceros de sobra («8,5», «12», «0,25»). */
const fmtH = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : String(redondear(n)).replace('.', ','));
/** Día siguiente en ISO (aaaa-mm-dd), sin zona: solo se usa para saber si dos fechas son seguidas. */
const diaSiguiente = (iso: string): string => {
  const t = Date.parse(String(iso ?? '').slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? new Date(t + 86400000).toISOString().slice(0, 10) : '';
};

// ── LECTURAS ─────────────────────────────────────────────────────────────────

export type Turno = 'day' | 'night';
export type OrigenLectura = 'inspector' | 'qr' | 'control' | 'reinicio';

/** Fila de `lecturas_horometro_trabajo` tal como la ve el cliente. `inicial`/`final` pueden faltar. */
export type LecturaTrabajo = {
  machineryId: string;
  roundDate: string;
  shift: Turno;
  inicial: number | null;
  final: number | null;
  valida: boolean;
  motivoInvalida: string | null;
  reinicio: boolean;
  origen: OrigenLectura;
  corregidoPor?: string | null;
};

/** Ventana del turno (12 h) más media hora de gracia. Se compara contra la ventana, no contra la hora de captura. */
export const TOPE_HORAS_TURNO = 12.5;

/**
 * Espejo exacto de la validación del disparador en la base. Marca, no rechaza.
 * `ultimaValida` = última lectura válida (final, o inicial si no hay final) de la MISMA
 * máquina en un turno anterior; null si no hay ninguna. Una lectura INCOMPLETA (falta
 * inicial o final) no es inválida: solo no produce horas.
 */
export function validarLectura(
  l: { inicial: number | null; final: number | null; reinicio: boolean },
  ultimaValida: number | null,
): { valida: boolean; motivo: string } {
  const ini = l.inicial == null ? null : num(l.inicial);
  const fin = l.final == null ? null : num(l.final);
  if ((ini != null && ini < 0) || (fin != null && fin < 0)) return { valida: false, motivo: 'lectura negativa' };
  if (fin != null && ini != null && fin < ini) return { valida: false, motivo: 'final menor que inicial' };
  // Un reinicio sienta base nueva (aparato cambiado): no se compara con lo anterior.
  if (!l.reinicio && ultimaValida != null && ini != null && ini < ultimaValida) return { valida: false, motivo: 'menor que la última lectura válida' };
  if (fin != null && ini != null && fin - ini > TOPE_HORAS_TURNO) return { valida: false, motivo: 'salto mayor a 12,5 h' };
  return { valida: true, motivo: '' };
}

/**
 * LA LECTURA QUE EL INSPECTOR PUEDE COMPLETAR TRAS EL CIERRE (24-sep-2026).
 *
 * Caso real del estreno (JUMBO 320): el inspector cerro la jornada sin escribir el
 * horometro final, y la pantalla ya solo le ofrecia INICIAR la siguiente - cuyo
 * campo precargado le mostraba el numero viejo. El final se pone el MISMO dia
 * mirando el tablero; un final puesto dias despues es un numero inventado, y eso
 * es correccion de Control (con motivo), no del inspector.
 *
 * Devuelve la lectura de `hoyISO` con inicial y SIN final (dia primero), o null.
 */
export function lecturaParaCompletarFinal(
  lecturas: readonly LecturaTrabajo[] | null | undefined,
  hoyISO: string,
): LecturaTrabajo | null {
  const abiertas = (lecturas ?? []).filter(
    (l) => !!l && String(l.roundDate).slice(0, 10) === hoyISO && l.inicial != null && l.final == null,
  );
  abiertas.sort((a, b) => (a.shift < b.shift ? -1 : a.shift > b.shift ? 1 : 0)); // day antes que night
  return abiertas[0] ?? null;
}

/** final − inicial, a 2 decimales. null si falta alguna lectura o la fila no es válida. */
export function horasDeLectura(l: LecturaTrabajo): number | null {
  if (!l || !l.valida || l.inicial == null || l.final == null) return null;
  return redondear(num(l.final) - num(l.inicial));
}

/**
 * Última lectura válida (final, o inicial si no hay final) ESTRICTAMENTE anterior al turno
 * dado. Orden: roundDate y, dentro del día, day < night. `lecturas` deben ser de UNA misma
 * máquina (acá no se filtra por máquina: quien llama ya las trajo así).
 */
export function ultimaLecturaValida(lecturas: readonly LecturaTrabajo[], antesDe: { roundDate: string; shift: Turno }): number | null {
  const rango = (l: { roundDate: string; shift: Turno }) => `${String(l.roundDate ?? '').slice(0, 10)}|${l.shift === 'night' ? '1' : '0'}`;
  const limite = rango(antesDe);
  const previas = (lecturas ?? [])
    .filter((l) => l && l.valida && (l.final != null || l.inicial != null) && rango(l) < limite)
    .sort((a, b) => (rango(a) < rango(b) ? -1 : rango(a) > rango(b) ? 1 : 0));
  const u = previas[previas.length - 1];
  if (!u) return null;
  return u.final != null ? num(u.final) : num(u.inicial);
}

// ── HORAS PAGABLES ───────────────────────────────────────────────────────────

export type ModoPago = 'jornada' | 'viaje' | 'horometro';
export type OrigenPago = 'jornada' | 'horometro' | 'sin_lectura' | 'invalida' | 'averiado' | 'sin_horometro_fisico';
export type RondaHoras = { dia: number; noche: number; parada: number; extras: number };

const turnoH = (h: unknown) => Math.max(0, num(h));

/** Misma fórmula que `workedFromShifts` (src/lib/hours.ts): max(0, día + noche − parada) + max(0, extras). */
export function horasJornada(r: RondaHoras): number {
  return Math.max(0, turnoH(r?.dia) + turnoH(r?.noche) - num(r?.parada)) + Math.max(0, num(r?.extras));
}

/**
 * Horas que se PAGAN ese día, y de dónde salen. Ver la cabecera del archivo.
 * `lecturas` son las de ESA máquina y ESE día (una por turno, si las hay).
 */
export function horasPagables(
  r: RondaHoras,
  lecturas: readonly LecturaTrabajo[],
  modo: ModoPago,
  op?: { sinHorometroFisico?: boolean; averiado?: boolean },
): { horas: number; dia: number; noche: number; origen: OrigenPago } {
  const ronda = r ?? { dia: 0, noche: 0, parada: 0, extras: 0 };
  const porJornada = (origen: OrigenPago) => ({ horas: horasJornada(ronda), dia: redondear(turnoH(ronda.dia)), noche: redondear(turnoH(ronda.noche)), origen });

  if (modo !== 'horometro') return porJornada('jornada');
  if (op?.sinHorometroFisico) return porJornada('sin_horometro_fisico');
  if (op?.averiado) return porJornada('averiado');

  // Modo horómetro: cada turno con su par de lecturas.
  const turnos: Turno[] = ['day', 'night'];
  const horasTurno: Record<Turno, number | null> = { day: null, night: null };
  let caida: OrigenPago | null = null;
  for (const t of turnos) {
    const lec = (lecturas ?? []).find((l) => l && l.shift === t);
    const h = lec ? horasDeLectura(lec) : null;
    if (h != null) { horasTurno[t] = h; continue; }
    const trabajoDeclarado = turnoH(t === 'day' ? ronda.dia : ronda.noche);
    if (trabajoDeclarado > 0) {
      // Una inválida pesa más que una ausente: hay algo que corregir, no solo que anotar.
      const motivo: OrigenPago = lec && !lec.valida ? 'invalida' : 'sin_lectura';
      if (caida == null || motivo === 'invalida') caida = motivo;
    }
  }
  if (caida) return porJornada(caida);

  const dia = horasTurno.day, noche = horasTurno.night;
  if (dia == null && noche == null) {
    // Día sin ronda y sin lecturas: no hay nada que pagar ni de dónde sacarlo.
    return { horas: 0, dia: 0, noche: 0, origen: 'sin_lectura' };
  }
  return { horas: redondear((dia ?? 0) + (noche ?? 0)), dia: dia ?? 0, noche: noche ?? 0, origen: 'horometro' };
}

// ── COMPARATIVO (reporte «jornada vs horómetro») ─────────────────────────────
//
// Antes de encender el modo horómetro en una máquina, el cliente quiere ver si lo que marca
// el aparato cuadra con lo que declara el inspector. Una fila por máquina y día que tenga
// ronda; el horómetro se compara contra ella. TOLERANCIA de media hora para «cuadra».

export type FilaComparativa = {
  machineryId: string;
  code: string;
  empresa: string;
  fecha: string;
  horasJornada: number;
  horasHorometro: number | null;
  diferencia: number | null;
  estado: 'cuadra' | 'horometro_mayor' | 'jornada_mayor' | 'sin_lectura' | 'invalida';
};

/** Media hora de tolerancia para decir que jornada y horómetro cuadran. */
const TOLERANCIA_CUADRA = 0.5;
/** Hasta 3 h de diferencia todavía cuenta para «lista para encender» (criterio de salida del diseño). */
const TOLERANCIA_LISTA = 3;
/** Días seguidos que hacen falta para dar una máquina por lista. */
const DIAS_PARA_LISTA = 5;

export function compararJornadaHorometro(
  rondas: readonly { machineryId: string; code: string; empresa: string; fecha: string; ronda: RondaHoras }[],
  lecturas: readonly LecturaTrabajo[],
): FilaComparativa[] {
  const porClave = new Map<string, LecturaTrabajo[]>();
  for (const l of lecturas ?? []) {
    if (!l) continue;
    const k = `${l.machineryId}|${String(l.roundDate ?? '').slice(0, 10)}`;
    const arr = porClave.get(k); if (arr) arr.push(l); else porClave.set(k, [l]);
  }
  const filas: FilaComparativa[] = [];
  for (const r of rondas ?? []) {
    const fecha = String(r.fecha ?? '').slice(0, 10);
    const hj = redondear(horasJornada(r.ronda));
    const del = porClave.get(`${r.machineryId}|${fecha}`) ?? [];
    const base = { machineryId: r.machineryId, code: limpio(r.code), empresa: limpio(r.empresa), fecha, horasJornada: hj };
    if (del.length === 0) { filas.push({ ...base, horasHorometro: null, diferencia: null, estado: 'sin_lectura' }); continue; }
    if (del.some((l) => !l.valida)) { filas.push({ ...base, horasHorometro: null, diferencia: null, estado: 'invalida' }); continue; }
    const horas = del.map(horasDeLectura).filter((h): h is number => h != null);
    if (horas.length === 0) { filas.push({ ...base, horasHorometro: null, diferencia: null, estado: 'sin_lectura' }); continue; } // solo lecturas incompletas
    const hh = redondear(horas.reduce((s, h) => s + h, 0));
    const dif = redondear(hh - hj);
    const estado: FilaComparativa['estado'] = Math.abs(dif) <= TOLERANCIA_CUADRA ? 'cuadra' : dif > 0 ? 'horometro_mayor' : 'jornada_mayor';
    filas.push({ ...base, horasHorometro: hh, diferencia: dif, estado });
  }
  return filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : cmp(a.code, b.code)));
}

export type ResumenComparativo = {
  filas: number; maquinas: number; conLectura: number;
  cuadran: number; horometroMayor: number; jornadaMayor: number; invalidas: number; sinLectura: number;
  horasJornada: number; horasHorometro: number;
  listas: { code: string; dias: number }[];
};

/** Un día «bueno» para el criterio de salida: cuadra, o se va por 3 h o menos; nunca una inválida. */
const diaBueno = (f: FilaComparativa) => f.estado !== 'invalida' && (f.estado === 'cuadra' || (f.diferencia != null && Math.abs(f.diferencia) <= TOLERANCIA_LISTA));

export function resumenComparativo(filas: readonly FilaComparativa[]): ResumenComparativo {
  const fs = filas ?? [];
  const r: ResumenComparativo = {
    filas: fs.length, maquinas: new Set(fs.map((f) => f.machineryId)).size, conLectura: 0,
    cuadran: 0, horometroMayor: 0, jornadaMayor: 0, invalidas: 0, sinLectura: 0,
    horasJornada: 0, horasHorometro: 0, listas: [],
  };
  for (const f of fs) {
    r.horasJornada += num(f.horasJornada);
    if (f.horasHorometro != null) { r.conLectura++; r.horasHorometro += num(f.horasHorometro); }
    if (f.estado === 'cuadra') r.cuadran++;
    else if (f.estado === 'horometro_mayor') r.horometroMayor++;
    else if (f.estado === 'jornada_mayor') r.jornadaMayor++;
    else if (f.estado === 'invalida') r.invalidas++;
    else r.sinLectura++;
  }
  r.horasJornada = redondear(r.horasJornada);
  r.horasHorometro = redondear(r.horasHorometro);

  // «Listas»: la racha más larga de días SEGUIDOS buenos por máquina; entra con 5 o más.
  const porMaquina = new Map<string, FilaComparativa[]>();
  for (const f of fs) { const a = porMaquina.get(f.machineryId); if (a) a.push(f); else porMaquina.set(f.machineryId, [f]); }
  for (const [, dias] of porMaquina) {
    const orden = [...dias].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    let mejor = 0, racha = 0, anterior = '';
    for (const f of orden) {
      if (f.fecha === anterior) continue; // dos filas del mismo día no cuentan doble
      if (diaBueno(f)) racha = anterior && diaSiguiente(anterior) === f.fecha && racha > 0 ? racha + 1 : 1;
      else racha = 0;
      if (racha > mejor) mejor = racha;
      anterior = f.fecha;
    }
    if (mejor >= DIAS_PARA_LISTA) r.listas.push({ code: orden[0].code, dias: mejor });
  }
  r.listas.sort((a, b) => cmp(a.code, b.code));
  return r;
}

// ── PAPEL ────────────────────────────────────────────────────────────────────

export const CSS_COMPARATIVO = `
  .r{text-align:right}
  .hc table{table-layout:fixed;width:100%;font-size:9px}
  .hc th,.hc td{padding:3px 5px;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
  .hc th.r,.hc td.r{width:62px}
  .hc-res{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .hc-res div{background:#F1F5F9;border-radius:6px;padding:6px 10px;font-size:11px}
  .hc-res b{font-size:14px;display:block}
  .hc-ok td{background:#ECFDF5}
  .hc-ok .est{color:#047857;font-weight:700}
  .hc-mas td{background:#FFFBEB}
  .hc-mas .est{color:#92400E;font-weight:700}
  .hc-menos td{background:#FEF2F2}
  .hc-menos .est{color:#B91C1C;font-weight:700}
  .hc-sin td{color:#6B7280}
  .hc-sin .est{font-style:italic}
  .hc h3.sect{margin:18px 0 6px;font-size:14px;color:#fff;background:#1E3A5F;padding:7px 12px;border-radius:6px}
  .hc h3.sect span{font-weight:400;color:#CFE0F2;font-size:11px}
  .hc .nota{font-size:10px;color:#555;margin:4px 0 8px}
`;

const ETIQUETA_ESTADO: Record<FilaComparativa['estado'], string> = {
  cuadra: 'Cuadra', horometro_mayor: 'Horómetro mayor', jornada_mayor: 'Jornada mayor', sin_lectura: 'Sin lectura', invalida: 'Inválida',
};
const CLASE_ESTADO: Record<FilaComparativa['estado'], string> = {
  cuadra: 'hc-ok', horometro_mayor: 'hc-mas', jornada_mayor: 'hc-menos', sin_lectura: 'hc-sin', invalida: 'hc-menos',
};

/** Cuerpo HTML del comparativo: resumen, máquinas listas para encender y una tabla por día. */
export function cuerpoComparativo(d: { desde: string; hasta: string; filas: FilaComparativa[] }): string {
  const filas = d.filas ?? [];
  const r = resumenComparativo(filas);
  const caja = (t: string, v: string | number) => `<div><b>${esc(v)}</b>${esc(t)}</div>`;
  let html = `<div class="hc">`;
  html += `<p class="nota">Del ${dmy(d.desde)} al ${dmy(d.hasta)}. Una fila por máquina y día con ronda; el horómetro se compara contra la jornada del inspector. Cuadra = diferencia de media hora o menos.</p>`;
  html += `<div class="hc-res">`
    + caja('máquinas', r.maquinas) + caja('días con ronda', r.filas) + caja('con lectura', r.conLectura)
    + caja('cuadran', r.cuadran) + caja('horómetro mayor', r.horometroMayor) + caja('jornada mayor', r.jornadaMayor)
    + caja('inválidas', r.invalidas) + caja('sin lectura', r.sinLectura)
    + caja('h jornada', fmtH(r.horasJornada)) + caja('h horómetro', fmtH(r.horasHorometro))
    + `</div>`;

  html += `<h3 class="sect">Máquinas listas para encender <span>${DIAS_PARA_LISTA} días seguidos cuadrando (±${TOLERANCIA_LISTA} h) sin lecturas inválidas</span></h3>`;
  if (r.listas.length === 0) html += `<p class="nota">Ninguna todavía.</p>`;
  else {
    html += `<table><thead><tr><th>Máquina</th><th class="r">Días seguidos</th></tr></thead><tbody>`;
    for (const m of r.listas) html += `<tr class="hc-ok"><td>${esc(m.code)}</td><td class="r">${m.dias}</td></tr>`;
    html += `</tbody></table>`;
  }

  const porDia = new Map<string, FilaComparativa[]>();
  for (const f of filas) { const a = porDia.get(f.fecha); if (a) a.push(f); else porDia.set(f.fecha, [f]); }
  const fechas = [...porDia.keys()].sort();
  if (fechas.length === 0) html += `<p class="nota">Sin rondas en el rango.</p>`;
  for (const fecha of fechas) {
    const del = [...(porDia.get(fecha) ?? [])].sort((a, b) => cmp(a.code, b.code));
    html += `<h3 class="sect">${dmy(fecha)} <span>${del.length} máquina(s)</span></h3>`;
    html += `<table><thead><tr><th>Máquina</th><th>Empresa</th><th class="r">Jornada h</th><th class="r">Horómetro h</th><th class="r">Diferencia</th><th>Estado</th></tr></thead><tbody>`;
    for (const f of del) {
      const dif = f.diferencia == null ? '—' : (f.diferencia > 0 ? '+' : '') + fmtH(f.diferencia);
      html += `<tr class="${CLASE_ESTADO[f.estado]}"><td>${esc(f.code)}</td><td>${esc(f.empresa)}</td><td class="r">${fmtH(f.horasJornada)}</td><td class="r">${fmtH(f.horasHorometro)}</td><td class="r">${dif}</td><td class="est">${ETIQUETA_ESTADO[f.estado]}</td></tr>`;
    }
    html += `</tbody></table>`;
  }
  html += `</div>`;
  return html;
}
