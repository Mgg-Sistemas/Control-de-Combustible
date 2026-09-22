// HISTÓRICO DE UBICACIONES POR MÁQUINA (22-sep-2026) — la regla, sin red.
//
// Pedido del cliente: «un reporte desde un rango de fechas con el histórico de dónde
// trabajaron esas máquinas en base a la ubicación que daban los inspectores, las horas
// que trabajaron, el estatus, marca, modelo, placa, inspector, empresa, y que pueda
// ocultar o mostrar columnas del PDF».
//
// ⭐ NO HAY UNA TABLA DE «UBICACIÓN POR DÍA». Se reconstruye cruzando cuatro fuentes,
//    y este archivo es el ÚNICO sitio donde se cruzan (la pantalla solo carga y pinta):
//      · puntos GPS (`machinery_locations`) → el SECTOR del día (polígonos del mapa)
//      · cambios de `machinery.referencia` (bitácora) → el EDIFICIO/OBRA vigente ese día
//      · check-ins del inspector (`supervisor_visits`) → INSPECTOR y ESTADO del día
//      · rondas (`machine_rounds`) → HORAS (y el inspector de la ronda si no hubo check-in)
//
// ⭐ UNA FILA POR MÁQUINA Y DÍA, y solo si ese día pasó ALGO (ronda, check-in o punto).
//    Sin esa regla, 300 máquinas × 30 días son 9.000 renglones vacíos.
//
// ⭐ LA UBICACIÓN SE COMPLETA, Y SE DICE. Si un día no hubo punto GPS, la celda lo marca.
//    ⚠️ ORDEN (pedido del cliente, 22-sep-2026: «si este día no tuvieron ubicación pero
//    el día de mañana sí, colócale esa, no la última»): sin punto ESE día vale el primero
//    POSTERIOR («registrada el 20/07»); si no hay ninguno después, el último ANTERIOR
//    («desde el 12/09»); si no hay ninguno en el historial, la ubicación actual del
//    catálogo («ubicación actual»); y sin GPS en ninguna parte, el EDIFICIO/OBRA que el
//    inspector eligió («según edificio/obra»: 228 renglones de camionetas, cisternas y
//    lowboys salían «sin ubicación» teniendo «PATIO - CAMURI CHICO» al lado). «Sin
//    ubicación» queda solo para la máquina sin GPS y sin edificio, y el resumen las cuenta.
//
// Sin imports: la prueba (scripts/test-ubicaciones-reporte.mjs) lo carga solo.

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const redondear = (n: number) => Math.round(n * 100) / 100;
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Fecha de CALENDARIO en Caracas (UTC−4 fijo, sin horario de verano) de un instante ISO. */
export function fechaCaracas(iso: unknown): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t - 4 * 3600000).toISOString().slice(0, 10);
}
export const dmy = (iso: string): string => { const [y, m, d] = String(iso ?? '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };

/** Los días del rango, de menor a mayor. Si vienen al revés, se enderezan. */
export function diasDelRango(desde: string, hasta: string): string[] {
  let a = String(desde ?? '').slice(0, 10), b = String(hasta ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return [];
  if (a > b) [a, b] = [b, a];
  const out: string[] = [];
  const t0 = Date.parse(a + 'T00:00:00Z'), t1 = Date.parse(b + 'T00:00:00Z');
  for (let t = t0; t <= t1 && out.length < 400; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ── QUÉ SE OCULTA (las pastillas) ───────────────────────────────────────────

export type OpcionesUbicaciones = {
  sinMarca: boolean; sinModelo: boolean; sinPlaca: boolean; sinEmpresa: boolean;
  sinSector: boolean; sinEdificio: boolean; sinInspector: boolean; sinEstado: boolean;
  sinHoras: boolean; sinAlcance: boolean;
};
export const OPCIONES_UBICACIONES_COMPLETO: OpcionesUbicaciones = {
  sinMarca: false, sinModelo: false, sinPlaca: false, sinEmpresa: false,
  sinSector: false, sinEdificio: false, sinInspector: false, sinEstado: false,
  sinHoras: false, sinAlcance: false,
};
export const PASTILLAS_UBICACIONES: { key: keyof OpcionesUbicaciones; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', largo: 'serial/placa', archivo: 'sin placa' },
  { key: 'sinEmpresa', chip: '🚫 Empresa', largo: 'empresa', archivo: 'sin empresa' },
  { key: 'sinSector', chip: '🚫 Sector (GPS)', largo: 'sector', archivo: 'sin sector' },
  { key: 'sinEdificio', chip: '🚫 Edificio / obra', largo: 'edificio/obra', archivo: 'sin edificio' },
  { key: 'sinInspector', chip: '🚫 Inspector', largo: 'inspector', archivo: 'sin inspector' },
  { key: 'sinEstado', chip: '🚫 Estado', largo: 'estado', archivo: 'sin estado' },
  { key: 'sinHoras', chip: '🚫 Horas', largo: 'horas', archivo: 'sin horas' },
  { key: 'sinAlcance', chip: '🚫 Alcance del informe', largo: 'cuadro de alcance', archivo: 'sin alcance' },
];
export function alternarUbicaciones(o: OpcionesUbicaciones, key: keyof OpcionesUbicaciones): OpcionesUbicaciones {
  return { ...o, [key]: !o[key] };
}
export function ocultosUbicacionesEnPalabras(o: OpcionesUbicaciones): string {
  const l = PASTILLAS_UBICACIONES.filter((p) => o[p.key]).map((p) => p.largo);
  return l.length === 0 ? 'Sale completo.' : `No sale: ${l.join(', ')}.`;
}
export function sufijoArchivoUbicaciones(o: OpcionesUbicaciones): string {
  const l = PASTILLAS_UBICACIONES.filter((p) => o[p.key]).map((p) => p.archivo);
  return l.length === 0 ? '' : ` - ${l.join(' - ')}`;
}

export type ColumnaUbicacion = 'fecha' | 'code' | 'marcaModelo' | 'placa' | 'empresa' | 'sector' | 'edificio' | 'inspector' | 'estado' | 'dia' | 'noche' | 'total';
/** Fecha, máquina y … SIEMPRE salen: son el histórico. Ocultar columnas nunca saca filas. */
export function columnasUbicaciones(o: OpcionesUbicaciones): ColumnaUbicacion[] {
  const c: ColumnaUbicacion[] = ['fecha', 'code'];
  if (!o.sinMarca || !o.sinModelo) c.push('marcaModelo');
  if (!o.sinPlaca) c.push('placa');
  if (!o.sinEmpresa) c.push('empresa');
  if (!o.sinSector) c.push('sector');
  if (!o.sinEdificio) c.push('edificio');
  if (!o.sinInspector) c.push('inspector');
  if (!o.sinEstado) c.push('estado');
  if (!o.sinHoras) c.push('dia', 'noche', 'total');
  return c;
}
export function tituloMarcaModeloUbic(o: OpcionesUbicaciones): string {
  return !o.sinMarca && !o.sinModelo ? 'Marca / Modelo' : !o.sinMarca ? 'Marca' : 'Modelo';
}

// ── LAS FUENTES ─────────────────────────────────────────────────────────────

export type MaquinaUbic = {
  id: string; code: string; marca: string; modelo: string;
  /** Placa, o serial si no tiene placa. */
  placa: string; empresa: string; clasificacion: string;
  /** El edificio/obra de HOY en el catálogo: solo vale si no hay bitácora de la máquina. */
  referenciaActual: string;
  /** El sector de HOY según el GPS del catálogo: solo vale si no hay ningún punto en el historial. */
  sectorActual?: string | null;
};
/** Un punto GPS ya traducido a sector por quien lo carga (los polígonos viven en mapZones). */
export type PuntoGps = { machineryId: string; at: string; sector: string | null };
/** Un cambio de `machinery.referencia` en la bitácora. */
export type CambioEdificio = { machineryId: string; at: string; de: string | null; a: string | null };
export type VisitaDia = { machineryId: string; fecha: string; at: string; inspector: string; estado: string };
export type RondaDia = { machineryId: string; fecha: string; dia: number; noche: number; parada: number; estado: string | null; inspectorDia: string | null; inspectorNoche: string | null };

/** De dónde salió el sector de la fila: del día, tomado de después, arrastrado de antes, del catálogo, o de ningún lado. */
export type OrigenSector = 'dia' | 'posterior' | 'anterior' | 'catalogo' | 'edificio' | 'ninguno';

export type FilaUbicacion = {
  fecha: string;
  maquina: MaquinaUbic;
  /** Sector del día, o el que se completó. `sectorDesde` = fecha del punto usado ('' si es del día o del catálogo). */
  sector: string; sectorDesde: string; sectorOrigen: OrigenSector; sinUbicacion: boolean;
  edificio: string; edificioArrastrado: boolean;
  inspector: string; estado: string;
  dia: number; noche: number; total: number;
};

const SIN_UBIC = 'Sin ubicación';
const FUERA = 'Fuera de zona';

/** El estado del check-in, en criollo. */
export function etiquetaEstado(status: unknown): string {
  const s = limpio(status).toLowerCase();
  if (s === 'trabajando') return 'Trabajando';
  if (s === 'parada') return 'Parada';
  if (s === 'no_esta' || s === 'no está') return 'No estaba';
  return s ? s : '—';
}

export type EntradaUbicaciones = {
  desde: string; hasta: string;
  maquinas: readonly MaquinaUbic[];
  puntos: readonly PuntoGps[];
  cambios: readonly CambioEdificio[];
  visitas: readonly VisitaDia[];
  rondas: readonly RondaDia[];
  /** false cuando la bitácora no se pudo leer: el edificio sale de la ficha, marcado arrastrado. */
  hayBitacora: boolean;
};

export function armarUbicaciones(e: EntradaUbicaciones): FilaUbicacion[] {
  const dias = diasDelRango(e.desde, e.hasta);
  if (!dias.length) return [];
  const porId = new Map(e.maquinas.map((m) => [m.id, m]));

  // Puntos por máquina, en orden de tiempo.
  const puntos = new Map<string, PuntoGps[]>();
  e.puntos.forEach((p) => { if (porId.has(p.machineryId) && Date.parse(p.at)) (puntos.get(p.machineryId) ?? puntos.set(p.machineryId, []).get(p.machineryId)!).push(p); });
  puntos.forEach((l) => l.sort((a, b) => a.at.localeCompare(b.at)));
  // Cambios de edificio por máquina, en orden de tiempo.
  const cambios = new Map<string, CambioEdificio[]>();
  e.cambios.forEach((c) => { if (porId.has(c.machineryId) && Date.parse(c.at)) (cambios.get(c.machineryId) ?? cambios.set(c.machineryId, []).get(c.machineryId)!).push(c); });
  cambios.forEach((l) => l.sort((a, b) => a.at.localeCompare(b.at)));
  // Check-ins y rondas por máquina|día.
  const visitas = new Map<string, VisitaDia[]>();
  e.visitas.forEach((v) => { const k = `${v.machineryId}|${v.fecha}`; (visitas.get(k) ?? visitas.set(k, []).get(k)!).push(v); });
  const rondas = new Map<string, RondaDia>();
  e.rondas.forEach((r) => {
    const k = `${r.machineryId}|${r.fecha}`;
    const cur = rondas.get(k);
    // Dos rondas del mismo día: se toma el máximo de cada turno (mismo dedupe que el Informe por jornada).
    if (!cur) rondas.set(k, { ...r });
    else { cur.dia = Math.max(cur.dia, r.dia); cur.noche = Math.max(cur.noche, r.noche); cur.parada = Math.max(cur.parada, r.parada); cur.inspectorDia = cur.inspectorDia || r.inspectorDia; cur.inspectorNoche = cur.inspectorNoche || r.inspectorNoche; cur.estado = cur.estado || r.estado; }
  });

  // Qué máquinas tienen ALGO cada día.
  const conAlgo = new Set<string>();
  e.rondas.forEach((r) => conAlgo.add(`${r.machineryId}|${r.fecha}`));
  e.visitas.forEach((v) => conAlgo.add(`${v.machineryId}|${v.fecha}`));
  e.puntos.forEach((p) => conAlgo.add(`${p.machineryId}|${fechaCaracas(p.at)}`));

  const sectorDe = (p: PuntoGps) => limpio(p.sector) || FUERA;

  const filas: FilaUbicacion[] = [];
  dias.forEach((fecha) => {
    const finDia = fecha + 'T23:59:59.999-04:00';
    const finMs = Date.parse(finDia);
    porId.forEach((m) => {
      if (!conAlgo.has(`${m.id}|${fecha}`)) return;
      // EDIFICIO: el vigente al final del día según la bitácora. Sin cambios ≤ día pero con
      // cambios después, vale el «de» del primero posterior (lo que había ese día). Sin
      // bitácora de la máquina, la ficha de hoy, marcada como arrastrada.
      let edificio = '—', edificioArrastrado = false;
      const cs = cambios.get(m.id) ?? [];
      if (cs.length) {
        let vigente: string | null | undefined;
        for (const c of cs) { if (Date.parse(c.at) <= finMs) vigente = c.a; else { if (vigente === undefined) vigente = c.de; break; } }
        edificio = limpio(vigente) || '—';
      } else {
        edificio = limpio(m.referenciaActual) || '—';
        edificioArrastrado = edificio !== '—';
      }
      // SECTOR: último punto DEL DÍA; si no, el primero POSTERIOR (el cliente quiere la
      // del día siguiente en que sí la guardaron); si no, el último ANTERIOR; si no, el
      // del catálogo; si no, el edificio/obra; y solo sin nada de eso, «sin ubicación».
      let sector = SIN_UBIC, sectorDesde = '', sinUbicacion = true;
      let sectorOrigen: OrigenSector = 'ninguno';
      const ps = puntos.get(m.id) ?? [];
      let ultimo: PuntoGps | null = null, siguiente: PuntoGps | null = null;
      for (const p of ps) { if (Date.parse(p.at) <= finMs) ultimo = p; else { siguiente = p; break; } }
      if (ultimo && fechaCaracas(ultimo.at) === fecha) {
        sector = sectorDe(ultimo); sinUbicacion = false; sectorOrigen = 'dia';
      } else if (siguiente) {
        sector = sectorDe(siguiente); sinUbicacion = false; sectorDesde = fechaCaracas(siguiente.at); sectorOrigen = 'posterior';
      } else if (ultimo) {
        sector = sectorDe(ultimo); sinUbicacion = false; sectorDesde = fechaCaracas(ultimo.at); sectorOrigen = 'anterior';
      } else if (limpio(m.sectorActual)) {
        sector = limpio(m.sectorActual); sinUbicacion = false; sectorOrigen = 'catalogo';
      } else if (edificio !== '—') {
        // Sin GPS en ninguna parte pero con edificio: esa es la ubicación que dio el inspector.
        sector = edificio; sinUbicacion = false; sectorOrigen = 'edificio';
      }
      // INSPECTOR y ESTADO: el check-in del día manda; si no hubo, la ronda.
      const vs = (visitas.get(`${m.id}|${fecha}`) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
      const r = rondas.get(`${m.id}|${fecha}`);
      const dia = r ? Math.max(0, num(r.dia)) : 0;
      const noche = r ? Math.max(0, num(r.noche)) : 0;
      const total = redondear(Math.max(0, dia + noche - (r ? Math.max(0, num(r.parada)) : 0)));
      let inspector = '—', estado = '—';
      if (vs.length) {
        const v = vs[vs.length - 1];
        inspector = limpio(v.inspector) || '—';
        estado = etiquetaEstado(v.estado);
      } else if (r) {
        inspector = limpio(r.inspectorDia) || limpio(r.inspectorNoche) || '—';
        estado = total > 0 ? 'Trabajó (sin check-in)' : limpio(r.estado).toLowerCase() === 'parada' ? 'Parada' : 'Sin horas';
      } else {
        estado = 'Solo ubicación';
      }
      filas.push({ fecha, maquina: m, sector, sectorDesde, sectorOrigen, sinUbicacion, edificio, edificioArrastrado, inspector, estado, dia: redondear(dia), noche: redondear(noche), total });
    });
  });
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || cmp(a.maquina.code, b.maquina.code) || cmp(a.maquina.placa, b.maquina.placa));
}

// ── RESUMEN, ALCANCE Y PAPEL ────────────────────────────────────────────────

export type ResumenUbicaciones = { filas: number; maquinas: number; dias: number; horas: number; sinUbicacion: number; arrastradas: number; sectores: { nombre: string; filas: number; horas: number }[] };

export function resumenUbicaciones(filas: readonly FilaUbicacion[]): ResumenUbicaciones {
  const maqs = new Set<string>(), dias = new Set<string>();
  const porSector = new Map<string, { filas: number; horas: number }>();
  let horas = 0, sinUbicacion = 0, arrastradas = 0;
  filas.forEach((f) => {
    maqs.add(f.maquina.id); dias.add(f.fecha); horas += f.total;
    if (f.sinUbicacion) sinUbicacion += 1; else if (f.sectorOrigen !== 'dia') arrastradas += 1;
    const s = porSector.get(f.sector) ?? { filas: 0, horas: 0 };
    s.filas += 1; s.horas = redondear(s.horas + f.total); porSector.set(f.sector, s);
  });
  return {
    filas: filas.length, maquinas: maqs.size, dias: dias.size, horas: redondear(horas), sinUbicacion, arrastradas,
    sectores: Array.from(porSector, ([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.horas - a.horas || b.filas - a.filas || cmp(a.nombre, b.nombre)),
  };
}

export type AlcanceUbicaciones = { empresas: string[]; clasificaciones: string[]; maquinas: string[] };

export function alcanceUbicacionesEnPalabras(desde: string, hasta: string, f: AlcanceUbicaciones, o: OpcionesUbicaciones, hayBitacora: boolean, r: ResumenUbicaciones): string[] {
  const l: string[] = [`Del ${dmy(desde)} al ${dmy(hasta)} · ${r.dias} día(s) con registros · ${r.maquinas} máquina(s) · ${r.filas} renglón(es).`];
  l.push(f.empresas.length ? `Empresas: solo ${f.empresas.join(', ')}.` : 'Empresas: todas.');
  if (f.clasificaciones.length) l.push(`Clasificación: ${f.clasificaciones.join(', ')}.`);
  if (f.maquinas.length) l.push(`Máquinas: ${f.maquinas.length <= 4 ? f.maquinas.join(', ') : `${f.maquinas.length} elegidas`}.`);
  l.push('El sector sale del punto GPS que guardó el inspector ese día. «registrada el DD/MM» = ese día nadie lo guardó y vale la del siguiente día en que sí; «desde el DD/MM» = no hubo ninguna después y vale la última anterior; «ubicación actual» = solo se conoce la de hoy en el catálogo; «según edificio/obra» = la máquina no tiene GPS en ninguna parte y vale el edificio que eligió el inspector.');
  if (r.sinUbicacion) l.push(`⚠️ ${r.sinUbicacion} renglón(es) de máquinas sin GPS y sin edificio: no hay dónde ponerlas.`);
  if (!hayBitacora) l.push('⚠️ La bitácora de edificios no se pudo leer: el edificio/obra es el de HOY en la ficha (marcado *).');
  l.push(ocultosUbicacionesEnPalabras(o));
  return l;
}

export const CSS_UBICACIONES = `
  .r{text-align:right}
  .ub table{table-layout:fixed;width:100%;font-size:8.5px}
  .ub th,.ub td{padding:3px 4px;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
  .ub th.r,.ub td.r{width:46px}
  .ub-res{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .ub-res div{background:#F1F5F9;border-radius:6px;padding:6px 10px;font-size:11px}
  .ub-res b{font-size:14px;display:block}
  .ub-arr{color:#92400E;font-size:9px}
  .ub-sin{color:#B91C1C;font-weight:700}
  .ub-alc{margin-top:12px;padding:8px 10px;background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;font-size:10.5px}
`;

export type DatosPapelUbicaciones = {
  desde: string; hasta: string; filas: FilaUbicacion[]; opciones: OpcionesUbicaciones;
  alcance: AlcanceUbicaciones; hayBitacora: boolean;
};

export function cuerpoUbicaciones(d: DatosPapelUbicaciones): string {
  const o = d.opciones;
  const r = resumenUbicaciones(d.filas);
  const cols = columnasUbicaciones(o);
  const titulos: Record<ColumnaUbicacion, string> = {
    fecha: 'Fecha', code: 'Máquina', marcaModelo: tituloMarcaModeloUbic(o), placa: 'Serial / Placa', empresa: 'Empresa',
    sector: 'Sector (GPS)', edificio: 'Edificio / obra', inspector: 'Inspector', estado: 'Estado', dia: '☀️ Día', noche: '🌙 Noche', total: 'Total h',
  };
  const numCols = new Set<ColumnaUbicacion>(['dia', 'noche', 'total']);
  const h = (n: number) => (n > 0 ? String(n) : '—');
  const celda = (f: FilaUbicacion, c: ColumnaUbicacion): string => {
    switch (c) {
      case 'fecha': return dmy(f.fecha);
      case 'code': return esc(f.maquina.code);
      case 'marcaModelo': return esc([o.sinMarca ? '' : f.maquina.marca, o.sinModelo ? '' : f.maquina.modelo].filter(Boolean).join(' ') || '—');
      case 'placa': return esc(f.maquina.placa || '—');
      case 'empresa': return esc(f.maquina.empresa);
      case 'sector': {
        if (f.sinUbicacion) return `<span class="ub-sin">${SIN_UBIC}</span>`;
        const nota = f.sectorOrigen === 'posterior' ? `registrada el ${dmy(f.sectorDesde)}`
          : f.sectorOrigen === 'anterior' ? `desde el ${dmy(f.sectorDesde)}`
            : f.sectorOrigen === 'catalogo' ? 'ubicación actual'
              : f.sectorOrigen === 'edificio' ? 'según edificio/obra' : '';
        return `${esc(f.sector)}${nota ? `<br/><span class="ub-arr">${nota}</span>` : ''}`;
      }
      case 'edificio': return `${esc(f.edificio)}${f.edificioArrastrado ? ' *' : ''}`;
      case 'inspector': return esc(f.inspector);
      case 'estado': return esc(f.estado);
      case 'dia': return h(f.dia);
      case 'noche': return h(f.noche);
      default: return h(f.total);
    }
  };
  const partes: string[] = [];
  partes.push(`<div class="ub-res">
    <div><b>${r.maquinas}</b>máquina(s)</div><div><b>${r.dias}</b>día(s)</div><div><b>${r.filas}</b>renglones</div>
    ${o.sinHoras ? '' : `<div><b>${r.horas} h</b>trabajadas</div>`}
    <div><b>${r.sinUbicacion}</b>sin ubicación</div><div><b>${r.arrastradas}</b>ubicación completada</div>
  </div>`);
  if (!o.sinSector && r.sectores.length) {
    partes.push(`<h3>Dónde trabajaron</h3><table><thead><tr><th>Sector</th><th class="r">Renglones</th>${o.sinHoras ? '' : '<th class="r">Horas</th>'}</tr></thead>
      <tbody>${r.sectores.map((s) => `<tr><td>${esc(s.nombre)}</td><td class="r">${s.filas}</td>${o.sinHoras ? '' : `<td class="r">${s.horas}</td>`}</tr>`).join('')}</tbody></table>`);
  }
  // Un bloque por día: se lee como el parte del día.
  const porDia = new Map<string, FilaUbicacion[]>();
  d.filas.forEach((f) => (porDia.get(f.fecha) ?? porDia.set(f.fecha, []).get(f.fecha)!).push(f));
  if (!porDia.size) partes.push('<p class="muted">Sin registros en el rango.</p>');
  porDia.forEach((fs, fecha) => {
    const hrs = redondear(fs.reduce((a, f) => a + f.total, 0));
    partes.push(`<h3>${dmy(fecha)} — ${fs.length} máquina(s)${o.sinHoras ? '' : ` · ${hrs} h`}</h3>
      <table><thead><tr>${cols.filter((c) => c !== 'fecha').map((c) => `<th${numCols.has(c) ? ' class="r"' : ''}>${titulos[c]}</th>`).join('')}</tr></thead>
      <tbody>${fs.map((f) => `<tr>${cols.filter((c) => c !== 'fecha').map((c) => `<td${numCols.has(c) ? ' class="r"' : ''}>${celda(f, c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  });
  if (!o.sinAlcance) partes.push(`<div class="ub-alc"><b>Alcance del informe</b><br/>${alcanceUbicacionesEnPalabras(d.desde, d.hasta, d.alcance, o, d.hayBitacora, r).map(esc).join('<br/>')}</div>`);
  // Envuelto en `.ub`: la tabla lleva 12 columnas y sin ancho fijo se salía de la hoja
  // (las horas quedaban cortadas a la derecha, visto en el PDF del 22-sep-2026).
  return `<div class="ub">${partes.join('\n')}</div>`;
}
