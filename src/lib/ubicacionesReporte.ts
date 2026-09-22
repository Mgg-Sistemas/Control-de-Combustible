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
// ⭐ TODAS LAS MÁQUINAS TIENEN CARDINAL (Este/Oeste): GPS → área de la obra → las demás
//    máquinas de esa obra → ficha → al azar (estable por id). Ver «REFERENCIA CARDINAL».
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

// ── REFERENCIA CARDINAL (ESTE / OESTE) ──────────────────────────────────────
//
// Pedido del cliente (22-sep-2026): «una columna que sea referencia cardinal, que
// coloque el Este u Oeste al que le corresponda, que el alcance diga a qué áreas
// responde el Este y el Oeste, y TODAS las máquinas deberían tener referencia
// cardinal».
//
// El litoral se parte en dos: del patio de Camurí Chico hacia Naiguatá es el ESTE;
// de La Guaira hacia Catia La Mar y el aeropuerto es el OESTE. Cuatro fuentes, en
// este orden, y ninguna inventa geografía:
//   1. gps   — el sector del día ya viene «Este · Macuto» / «Oeste · Aeropuerto».
//   2. area  — el nombre del edificio/obra dice el área («… - CATIA LA MAR»).
//   3. obra  — las demás máquinas CON GPS en ESE MISMO edificio: el cardinal se
//              aprende de los datos en vez de suponerlo («Res Coral beach» no
//              nombra su área, pero las que sí tienen GPS ahí la delatan).
//   4. ficha — la columna `sector` del catálogo, y SOLO si dice Este u Oeste: hay
//              máquinas con «CDF» o «Escuela Naval» ahí, y eso no es un cardinal.
//   5. azar  — «no me puede quedar nada sin punto cardinal, colócale uno random»
//              (cliente, 22-sep-2026). Se reparte por el id de la máquina, así la
//              misma máquina cae siempre del mismo lado y el papel no baila entre
//              una impresión y la siguiente. La celda lo dice («al azar») y el
//              alcance cuenta cuántos, igual que el Conteo reparte 50/50 sin GPS.
export type Cardinal = 'ESTE' | 'OESTE';
export type OrigenCardinal = 'gps' | 'area' | 'obra' | 'ficha' | 'azar';

/** Cardinal «al azar» pero ESTABLE: el mismo id da siempre el mismo lado. */
export function cardinalAlAzar(id: unknown): Cardinal {
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 'ESTE' : 'OESTE';
}

const sinAcentos = (v: unknown) => limpio(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Áreas del litoral con su cardinal. Lo más específico primero («catia la mar» antes
 *  que cualquier regla suelta). Solo áreas que el propio catálogo de edificios nombra. */
const AREAS_CARDINALES: { re: RegExp; area: string; cardinal: Cardinal }[] = [
  // OESTE — de La Guaira hacia Catia La Mar, Urimare y el aeropuerto.
  { re: /catia la ?mar|colinas de cat|escuela naval|litoral suites|atlantida/, area: 'Catia La Mar', cardinal: 'OESTE' },
  { re: /urimare|eduvig|eduvig?es/, area: 'Urimare', cardinal: 'OESTE' },
  { re: /maiquetia|aeropuerto/, area: 'Aeropuerto', cardinal: 'OESTE' },
  { re: /playa grande/, area: 'Playa Grande', cardinal: 'OESTE' },
  { re: /\bmamo\b/, area: 'Mamo', cardinal: 'OESTE' },
  { re: /\bpariata\b/, area: 'Pariata', cardinal: 'OESTE' },
  { re: /el chorro/, area: 'El Chorro', cardinal: 'OESTE' },
  { re: /trebol/, area: 'El Trébol', cardinal: 'OESTE' },
  { re: /franja costera/, area: 'Franja Costera', cardinal: 'OESTE' },
  { re: /hugo chavez/, area: 'Hugo Chávez', cardinal: 'OESTE' },
  { re: /centrocatia/, area: 'Centrocatia', cardinal: 'OESTE' },
  { re: /catamare/, area: 'Catamare', cardinal: 'OESTE' },
  { re: /bolipuerto|puerto de la guaira/, area: 'La Guaira', cardinal: 'OESTE' },
  // ESTE — de Camurí Chico hacia Caraballeda y Naiguatá.
  { re: /camuri/, area: 'Camurí Chico', cardinal: 'ESTE' },
  { re: /tanaguaren/, area: 'Tanaguarena', cardinal: 'ESTE' },
  { re: /naiguata/, area: 'Naiguatá', cardinal: 'ESTE' },
  { re: /\bosma\b/, area: 'Osma', cardinal: 'ESTE' },
  { re: /corales/, area: 'Los Corales', cardinal: 'ESTE' },
  { re: /caraballeda/, area: 'Caraballeda', cardinal: 'ESTE' },
  { re: /palmar/, area: 'El Palmar', cardinal: 'ESTE' },
  { re: /caribe/, area: 'Caribe', cardinal: 'ESTE' },
  { re: /macuto|punta de brisas|punta piedra/, area: 'Macuto', cardinal: 'ESTE' },
  { re: /\balamo\b/, area: 'Álamo', cardinal: 'ESTE' },
  { re: /san julian/, area: 'Caraballeda', cardinal: 'ESTE' },
];

/** El cardinal (y el área) que dice un texto: «Este · Macuto», «PATIO - CAMURI CHICO»,
 *  «Oeste». Vacío cuando el texto no nombra ningún área conocida. */
export function zonaCardinal(texto: unknown): { cardinal: Cardinal | ''; area: string } {
  const t = limpio(texto);
  if (!t) return { cardinal: '', area: '' };
  const pre = t.match(/^(este|oeste)\s*(?:·|-|:)\s*(.+)$/i);
  if (pre) return { cardinal: pre[1].toUpperCase() === 'OESTE' ? 'OESTE' : 'ESTE', area: limpio(pre[2]) };
  const n = sinAcentos(t);
  if (n === 'este') return { cardinal: 'ESTE', area: '' };
  if (n === 'oeste') return { cardinal: 'OESTE', area: '' };
  for (const a of AREAS_CARDINALES) if (a.re.test(n)) return { cardinal: a.cardinal, area: a.area };
  return { cardinal: '', area: '' };
}

// ── QUÉ SE OCULTA (las pastillas) ───────────────────────────────────────────

export type OpcionesUbicaciones = {
  sinMarca: boolean; sinModelo: boolean; sinPlaca: boolean; sinEmpresa: boolean;
  sinCardinal: boolean; sinSector: boolean; sinEdificio: boolean; sinInspector: boolean; sinEstado: boolean;
  sinHoras: boolean; sinAlcance: boolean;
};
export const OPCIONES_UBICACIONES_COMPLETO: OpcionesUbicaciones = {
  sinMarca: false, sinModelo: false, sinPlaca: false, sinEmpresa: false,
  sinCardinal: false, sinSector: false, sinEdificio: false, sinInspector: false, sinEstado: false,
  sinHoras: false, sinAlcance: false,
};
export const PASTILLAS_UBICACIONES: { key: keyof OpcionesUbicaciones; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', largo: 'serial/placa', archivo: 'sin placa' },
  { key: 'sinEmpresa', chip: '🚫 Empresa', largo: 'empresa', archivo: 'sin empresa' },
  { key: 'sinCardinal', chip: '🚫 Cardinal (E/O)', largo: 'referencia cardinal', archivo: 'sin cardinal' },
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

export type ColumnaUbicacion = 'fecha' | 'code' | 'marcaModelo' | 'placa' | 'empresa' | 'cardinal' | 'sector' | 'edificio' | 'inspector' | 'estado' | 'dia' | 'noche' | 'total';
/** Fecha, máquina y … SIEMPRE salen: son el histórico. Ocultar columnas nunca saca filas. */
export function columnasUbicaciones(o: OpcionesUbicaciones): ColumnaUbicacion[] {
  const c: ColumnaUbicacion[] = ['fecha', 'code'];
  if (!o.sinMarca || !o.sinModelo) c.push('marcaModelo');
  if (!o.sinPlaca) c.push('placa');
  if (!o.sinEmpresa) c.push('empresa');
  if (!o.sinCardinal) c.push('cardinal');
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
  /** La columna `sector` del catálogo, escrita a mano («Este», «Oeste», y a veces
   *  cualquier otra cosa). Último recurso del cardinal, y solo si dice un cardinal. */
  cardinalFicha?: string | null;
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
  /** ESTE / OESTE (siempre hay uno) y el área que lo justifica («Macuto», o '' si fue al azar). */
  cardinal: Cardinal; area: string; cardinalOrigen: OrigenCardinal;
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
      // CARDINAL: si el sector lo dice (viene del GPS), ese; si no, el que nombre el
      // edificio/obra. Lo que quede vacío se resuelve abajo, ya con todas las filas.
      let cardinal: Cardinal | '' = '', area = '', cardinalOrigen: OrigenCardinal = 'azar';
      const zSec = sinUbicacion ? { cardinal: '' as const, area: '' } : zonaCardinal(sector);
      if (zSec.cardinal) {
        cardinal = zSec.cardinal; area = zSec.area;
        // Con origen «edificio» el sector ES el nombre de la obra, no un polígono del mapa.
        cardinalOrigen = sectorOrigen === 'edificio' ? 'area' : 'gps';
      } else {
        const zEd = zonaCardinal(edificio);
        if (zEd.cardinal) { cardinal = zEd.cardinal; area = zEd.area; cardinalOrigen = 'area'; }
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
      // Sin resolver todavía: el segundo pase (obra, ficha, azar) lo cierra. Mientras, el azar.
      filas.push({ fecha, maquina: m, sector, sectorDesde, sectorOrigen, sinUbicacion, cardinal: cardinal || cardinalAlAzar(m.id), area, cardinalOrigen, edificio, edificioArrastrado, inspector, estado, dia: redondear(dia), noche: redondear(noche), total });
    });
  });
  completarCardinal(filas);
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || cmp(a.maquina.code, b.maquina.code) || cmp(a.maquina.placa, b.maquina.placa));
}

/**
 * Rellena el cardinal que faltó. Primero por OBRA: el edificio hereda el cardinal que
 * le dieron las filas con GPS de ese mismo sitio (una obra no está en dos cardinales;
 * si hubiera empate manda el ESTE, que es donde está casi toda la flota). Después, por
 * FICHA: la columna `sector` del catálogo, solo si dice un cardinal. Y lo que aún
 * quede, AL AZAR (estable por máquina). Se hace en un segundo pase porque la obra de
 * una máquina sin GPS la delatan las OTRAS máquinas.
 */
function completarCardinal(filas: FilaUbicacion[]): void {
  const votos = new Map<string, { ESTE: number; OESTE: number; area: string }>();
  filas.forEach((f) => {
    if (f.cardinalOrigen !== 'gps' || !f.cardinal || f.edificio === '—') return;
    const k = sinAcentos(f.edificio);
    const v = votos.get(k) ?? { ESTE: 0, OESTE: 0, area: '' };
    v[f.cardinal as 'ESTE' | 'OESTE'] += 1;
    if (!v.area && f.area) v.area = f.area;
    votos.set(k, v);
  });
  filas.forEach((f) => {
    if (f.cardinalOrigen !== 'azar') return;
    const v = f.edificio !== '—' ? votos.get(sinAcentos(f.edificio)) : undefined;
    if (v && (v.ESTE || v.OESTE)) {
      f.cardinal = v.ESTE >= v.OESTE ? 'ESTE' : 'OESTE'; f.area = v.area; f.cardinalOrigen = 'obra';
      return;
    }
    const ficha = zonaCardinal(f.maquina.cardinalFicha);
    if (ficha.cardinal) { f.cardinal = ficha.cardinal; f.area = ficha.area; f.cardinalOrigen = 'ficha'; }
    // Si no: se queda con el azar que ya traía (estable por id).
  });
}

// ── RESUMEN, ALCANCE Y PAPEL ────────────────────────────────────────────────

/** Cuántas máquinas y renglones caen en un cardinal, y en qué áreas. */
export type ResumenCardinal = { cardinal: Cardinal; filas: number; maquinas: number; areas: string[] };
export type ResumenUbicaciones = { filas: number; maquinas: number; dias: number; horas: number; sinUbicacion: number; arrastradas: number; sectores: { nombre: string; filas: number; horas: number }[]; cardinales: ResumenCardinal[]; /** Máquinas cuyo cardinal salió al azar. */ alAzar: number };

export function resumenUbicaciones(filas: readonly FilaUbicacion[]): ResumenUbicaciones {
  const maqs = new Set<string>(), dias = new Set<string>();
  const porSector = new Map<string, { filas: number; horas: number }>();
  const porCardinal = new Map<string, { filas: number; maqs: Set<string>; areas: Set<string> }>();
  const azar = new Set<string>();
  let horas = 0, sinUbicacion = 0, arrastradas = 0;
  filas.forEach((f) => {
    maqs.add(f.maquina.id); dias.add(f.fecha); horas += f.total;
    if (f.sinUbicacion) sinUbicacion += 1; else if (f.sectorOrigen !== 'dia') arrastradas += 1;
    const s = porSector.get(f.sector) ?? { filas: 0, horas: 0 };
    s.filas += 1; s.horas = redondear(s.horas + f.total); porSector.set(f.sector, s);
    if (f.cardinalOrigen === 'azar') azar.add(f.maquina.id);
    const c = porCardinal.get(f.cardinal) ?? { filas: 0, maqs: new Set<string>(), areas: new Set<string>() };
    c.filas += 1; c.maqs.add(f.maquina.id); if (f.area) c.areas.add(f.area);
    porCardinal.set(f.cardinal, c);
  });
  return {
    filas: filas.length, maquinas: maqs.size, dias: dias.size, horas: redondear(horas), sinUbicacion, arrastradas, alAzar: azar.size,
    sectores: Array.from(porSector, ([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.horas - a.horas || b.filas - a.filas || cmp(a.nombre, b.nombre)),
    // Siempre ESTE primero: es el orden en que el cliente los nombra.
    cardinales: (['ESTE', 'OESTE'] as const).filter((c) => porCardinal.has(c)).map((c) => {
      const v = porCardinal.get(c)!;
      return { cardinal: c as Cardinal, filas: v.filas, maquinas: v.maqs.size, areas: Array.from(v.areas).sort(cmp) };
    }),
  };
}

export type AlcanceUbicaciones = { empresas: string[]; clasificaciones: string[]; maquinas: string[] };

// Pedido del cliente (22-sep-2026): «que el alcance no dé tanta información, que sea más
// resumido y diga cuántas máquinas hay entre Este y Oeste y en qué áreas». Las leyendas
// de las celdas («registrada el», «según edificio/obra», «al azar») viven en el manual.
export function alcanceUbicacionesEnPalabras(desde: string, hasta: string, f: AlcanceUbicaciones, o: OpcionesUbicaciones, hayBitacora: boolean, r: ResumenUbicaciones): string[] {
  const l: string[] = [`Del ${dmy(desde)} al ${dmy(hasta)} · ${r.dias} día(s) · ${r.maquinas} máquina(s) · ${r.filas} renglón(es).`];
  l.push(f.empresas.length ? `Empresas: solo ${f.empresas.join(', ')}.` : 'Empresas: todas.');
  if (f.clasificaciones.length) l.push(`Clasificación: ${f.clasificaciones.join(', ')}.`);
  if (f.maquinas.length) l.push(`Máquinas: ${f.maquinas.length <= 4 ? f.maquinas.join(', ') : `${f.maquinas.length} elegidas`}.`);
  if (!o.sinCardinal) {
    r.cardinales.forEach((c) => l.push(`${c.cardinal}: ${c.maquinas} máquina(s)${c.areas.length ? ` · ${c.areas.join(', ')}` : ''}.`));
    if (r.alAzar) l.push(`${r.alAzar} máquina(s) sin GPS ni obra conocida: repartidas al azar entre Este y Oeste (la celda dice «al azar»).`);
  }
  if (!hayBitacora) l.push('⚠️ La bitácora de edificios no se pudo leer: el edificio/obra es el de HOY en la ficha (marcado *).');
  const ocultos = PASTILLAS_UBICACIONES.filter((p) => o[p.key]).map((p) => p.largo);
  if (ocultos.length) l.push(`No sale: ${ocultos.join(', ')}.`);
  return l;
}

export const CSS_UBICACIONES = `
  .r{text-align:right}
  .ub table{table-layout:fixed;width:100%;font-size:8.5px}
  .ub th,.ub td{padding:3px 4px;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
  .ub th.r,.ub td.r{width:46px}
  .ub th.cd,.ub td.cd{width:44px}
  .ub-res{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .ub-res div{background:#F1F5F9;border-radius:6px;padding:6px 10px;font-size:11px}
  .ub-res b{font-size:14px;display:block}
  .ub-arr{color:#92400E;font-size:9px}
  .ub-sin{color:#B91C1C;font-weight:700}
  .ub-alc{margin-top:12px;padding:8px 10px;background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;font-size:10.5px}
  .ub h3.sect{margin:18px 0 6px;font-size:15px;color:#fff;background:#1E3A5F;padding:7px 12px;border-radius:6px}
  .ub h3.sect span{font-weight:400;color:#CFE0F2;font-size:11px}
  .ub h4.sub2{margin:12px 0 3px;font-size:12.5px;color:#1E3A5F}
  .ub h4.sub2 span{font-weight:400;color:#555;font-size:11px}
  .ub td.c,.ub th.c{text-align:center;width:26px}
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
    cardinal: 'Cardinal', sector: 'Sector (GPS)', edificio: 'Edificio / obra', inspector: 'Inspector', estado: 'Estado', dia: '☀️ Día', noche: '🌙 Noche', total: 'Total h',
  };
  const numCols = new Set<ColumnaUbicacion>(['dia', 'noche', 'total']);
  const claseDe = (c: ColumnaUbicacion) => (numCols.has(c) ? ' class="r"' : c === 'cardinal' ? ' class="cd"' : '');
  const h = (n: number) => (n > 0 ? String(n) : '—');
  const celda = (f: FilaUbicacion, c: ColumnaUbicacion): string => {
    switch (c) {
      case 'fecha': return dmy(f.fecha);
      case 'code': return esc(f.maquina.code);
      case 'marcaModelo': return esc([o.sinMarca ? '' : f.maquina.marca, o.sinModelo ? '' : f.maquina.modelo].filter(Boolean).join(' ') || '—');
      case 'placa': return esc(f.maquina.placa || '—');
      // Siempre hay cardinal; si fue al azar, la celda lo dice.
      case 'cardinal': return `${f.cardinal}${f.cardinalOrigen === 'azar' ? '<br/><span class="ub-arr">al azar</span>' : ''}`;
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
    ${o.sinCardinal ? '' : r.cardinales.map((c) => `<div><b>${c.maquinas}</b>al ${c.cardinal === 'ESTE' ? 'Este' : 'Oeste'}</div>`).join('')}
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
      <table><thead><tr>${cols.filter((c) => c !== 'fecha').map((c) => `<th${claseDe(c)}>${titulos[c]}</th>`).join('')}</tr></thead>
      <tbody>${fs.map((f) => `<tr>${cols.filter((c) => c !== 'fecha').map((c) => `<td${claseDe(c)}>${celda(f, c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  });
  if (!o.sinAlcance) partes.push(`<div class="ub-alc"><b>Alcance del informe</b><br/>${alcanceUbicacionesEnPalabras(d.desde, d.hasta, d.alcance, o, d.hayBitacora, r).map(esc).join('<br/>')}</div>`);
  // Envuelto en `.ub`: la tabla lleva 12 columnas y sin ancho fijo se salía de la hoja
  // (las horas quedaban cortadas a la derecha, visto en el PDF del 22-sep-2026).
  return `<div class="ub">${partes.join('\n')}</div>`;
}

// ── EL PAPEL RESUMIDO (una línea por máquina, agrupado Este/Oeste) ──────────
//
// Pedido del cliente (22-sep-2026): «que sea como el de máquinas por sector en el
// mapa, y tener un PDF más genérico, más resumido, en ese mismo apartado». El
// detallado (`cuerpoUbicaciones`) es el parte día por día; este es la foto del
// rango: 🟢 SECTOR ESTE / 🟠 SECTOR OESTE → área → una línea por máquina.
//
// La máquina se agrupa por su ÚLTIMA ubicación del rango (es donde está ahora), y si
// se movió, la línea lo dice: sin eso, una máquina que cambió de obra saldría en un
// solo grupo sin avisar que estuvo en otro.

export type MaquinaResumen = {
  maquina: MaquinaUbic;
  cardinal: Cardinal; area: string; sector: string;
  dias: number; horas: number; edificio: string; inspector: string; estado: string;
  /** Cuántos sectores distintos tuvo en el rango (1 = no se movió). */
  sectores: number;
};

/** Una línea por máquina: sus días con registro, sus horas y dónde terminó el rango. */
export function resumirPorMaquina(filas: readonly FilaUbicacion[]): MaquinaResumen[] {
  const porMaq = new Map<string, FilaUbicacion[]>();
  filas.forEach((f) => (porMaq.get(f.maquina.id) ?? porMaq.set(f.maquina.id, []).get(f.maquina.id)!).push(f));
  const out: MaquinaResumen[] = [];
  porMaq.forEach((fs) => {
    const orden = fs.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    const ult = orden[orden.length - 1];
    const dias = new Set(orden.map((f) => f.fecha)).size;
    const horas = redondear(orden.reduce((a, f) => a + f.total, 0));
    // El último inspector y estado que NO sean «—»: el del último día puede venir vacío.
    let inspector = '—', estado = ult.estado;
    for (let i = orden.length - 1; i >= 0; i--) { if (orden[i].inspector !== '—') { inspector = orden[i].inspector; break; } }
    out.push({
      maquina: ult.maquina, cardinal: ult.cardinal, area: ult.area, sector: ult.sector,
      dias, horas, edificio: ult.edificio, inspector, estado,
      sectores: new Set(orden.map((f) => f.sector)).size,
    });
  });
  return out.sort((a, b) => cmp(a.maquina.code, b.maquina.code) || cmp(a.maquina.placa, b.maquina.placa));
}

export type GrupoArea = { nombre: string; maquinas: MaquinaResumen[]; horas: number };
export type GrupoCardinal = { cardinal: Cardinal; titulo: string; emoji: string; maquinas: number; horas: number; areas: GrupoArea[] };

/** Los tres bloques del papel, en el orden y con los colores del mapa. */
export function agruparPorCardinal(res: readonly MaquinaResumen[]): GrupoCardinal[] {
  const def: { cardinal: Cardinal; titulo: string; emoji: string }[] = [
    { cardinal: 'ESTE', titulo: 'SECTOR ESTE', emoji: '🟢' },
    { cardinal: 'OESTE', titulo: 'SECTOR OESTE', emoji: '🟠' },
  ];
  return def.map((d) => {
    const list = res.filter((m) => m.cardinal === d.cardinal);
    const porArea = new Map<string, MaquinaResumen[]>();
    // Sabemos el cardinal (por la ficha) pero no el sitio: se dice así, y va al final.
    list.forEach((m) => { const k = m.area || (m.sector === SIN_UBIC ? 'Sin ubicación conocida' : m.sector) || 'Sin área'; (porArea.get(k) ?? porArea.set(k, []).get(k)!).push(m); });
    const areas: GrupoArea[] = Array.from(porArea, ([nombre, maquinas]) => ({
      nombre, maquinas, horas: redondear(maquinas.reduce((a, m) => a + m.horas, 0)),
    })).sort((a, b) => Number(a.nombre.startsWith('Sin ')) - Number(b.nombre.startsWith('Sin ')) || b.maquinas.length - a.maquinas.length || cmp(a.nombre, b.nombre));
    return { ...d, maquinas: list.length, horas: redondear(list.reduce((a, m) => a + m.horas, 0)), areas };
  }).filter((g) => g.maquinas > 0);
}

export function cuerpoUbicacionesResumen(d: DatosPapelUbicaciones): string {
  const o = d.opciones;
  const r = resumenUbicaciones(d.filas);
  const grupos = agruparPorCardinal(resumirPorMaquina(d.filas));
  const cols: { t: string; c?: string; v: (m: MaquinaResumen, i: number) => string }[] = [
    { t: '#', c: 'c', v: (_m, i) => String(i + 1) },
    { t: 'Máquina', v: (m) => esc(m.maquina.code) },
  ];
  if (!o.sinMarca || !o.sinModelo) cols.push({ t: tituloMarcaModeloUbic(o), v: (m) => esc([o.sinMarca ? '' : m.maquina.marca, o.sinModelo ? '' : m.maquina.modelo].filter(Boolean).join(' ') || '—') });
  if (!o.sinPlaca) cols.push({ t: 'Serial / Placa', v: (m) => esc(m.maquina.placa || '—') });
  if (!o.sinEdificio) cols.push({ t: 'Edificio / obra', v: (m) => esc(m.edificio) });
  if (!o.sinInspector) cols.push({ t: 'Inspector', v: (m) => esc(m.inspector) });
  if (!o.sinEstado) cols.push({ t: 'Estado', v: (m) => esc(m.estado) });
  cols.push({ t: 'Días', c: 'r', v: (m) => String(m.dias) });
  if (!o.sinHoras) cols.push({ t: 'Total h', c: 'r', v: (m) => (m.horas > 0 ? String(m.horas) : '—') });
  if (!o.sinEmpresa) cols.push({ t: 'Empresa', v: (m) => esc(m.maquina.empresa) });

  const partes: string[] = [];
  partes.push(`<div class="ub-res">
    <div><b>${r.maquinas}</b>máquina(s)</div><div><b>${r.dias}</b>día(s)</div>
    ${o.sinHoras ? '' : `<div><b>${r.horas} h</b>trabajadas</div>`}
    ${grupos.map((g) => `<div><b>${g.maquinas}</b>${g.emoji} ${g.titulo.replace('SECTOR ', '')}</div>`).join('')}
  </div>`);
  if (!grupos.length) partes.push('<p class="muted">Sin registros en el rango.</p>');
  grupos.forEach((g) => {
    partes.push(`<h3 class="sect">${g.emoji} ${g.titulo} <span>· ${g.maquinas} máquina(s)${o.sinHoras ? '' : ` · ${g.horas} h`}</span></h3>`);
    g.areas.forEach((a) => {
      partes.push(`<h4 class="sub2">📍 ${esc(a.nombre)} <span>· ${a.maquinas.length} máquina(s)${o.sinHoras ? '' : ` · ${a.horas} h`}</span></h4>
        <table><thead><tr>${cols.map((c) => `<th${c.c ? ` class="${c.c}"` : ''}>${c.t}</th>`).join('')}</tr></thead>
        <tbody>${a.maquinas.map((m, i) => `<tr>${cols.map((c) => `<td${c.c ? ` class="${c.c}"` : ''}>${c.v(m, i)}${c.t === 'Máquina' && m.sectores > 1 ? `<br/><span class="ub-arr">estuvo en ${m.sectores} sitios</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    });
  });
  if (!o.sinAlcance) partes.push(`<div class="ub-alc"><b>Alcance del informe</b><br/>${alcanceUbicacionesEnPalabras(d.desde, d.hasta, d.alcance, o, d.hayBitacora, r).map(esc).join('<br/>')}</div>`);
  return `<div class="ub">${partes.join('\n')}</div>`;
}
