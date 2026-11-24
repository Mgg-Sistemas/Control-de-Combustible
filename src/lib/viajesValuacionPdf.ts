// 📑 SOPORTE DE MEDICIÓN POR PARTIDA Y REGISTRO DIARIO DE ACARREO Y PESAJE (24-nov-2026).
//
// Genera el paquete PDF multipágina estilo "Departamento de Administración de Contratos":
//   - Página 1: Carátula contractual + "1. REGISTRO DIARIO DEL PERÍODO" (todos los días,
//     incluyendo "Sin actividad", con acumulado de toneladas/viajes y barras de rendimiento).
//   - Página 2: "2. DISTRIBUCIÓN POR FRENTES DE TRABAJO" + "3. CONCILIACIÓN DE LA PARTIDA"
//     + bloque de 3 firmas (ELABORA / CONFORMA / REVISA).
//   - Páginas 3..N: Una hoja horizontal por cada día con viajes ("Registro diario de acarreo y
//     pesaje"), con detalle viaje a viaje, resumen por frente de origen y 4 firmas diarias.
//
// ⭐ Módulo PURO (sin React ni Supabase) para poder probarlo directo en Node.

export type ViajeValuacion = {
  id: string;
  registered_at: string;
  machinery_id: string | null;
  machine_code?: string | null;
  placa_snap?: string | null;
  chofer_name?: string | null;
  shift?: 'day' | 'night' | string | null;
  peso_tara_kg?: number | string | null;
  peso_bruto_kg?: number | string | null;
  peso_neto_kg?: number | string | null;
  frente_id?: string | null;
  frente_nombre?: string | null;
  ubicacion_nombre?: string | null;
  proyecto_operacion?: string | null;
  company_id?: string | null;
  material_nombre?: string | null;
  sentido?: string | null;
  responsable_id?: string | null;
  responsable_nombre?: string | null;
};

export type MaquinaValuacion = {
  id: string;
  code: string;
  plate?: string | null;
  serial?: string | null;
};

export type ConfigValuacion = {
  departamento: string;
  titulo: string;
  subtituloDiario: string;
  contratista: string;
  contrato: string;
  valuacion: string;
  itemNro: string;
  codigo: string;
  unidad: string;
  contratado: string;
  partida: string;
  sitioDisposicion: string;
  acumuladoAnterior: string;
  conLogoInstitucional: boolean;
  // Firmas Página 2 (3 columnas)
  elaboraTitulo: string;
  elaboraEmpresa: string;
  elaboraNombre: string;
  elaboraCi: string;
  conformaTitulo: string;
  conformaEmpresa: string;
  conformaNombre: string;
  conformaCi: string;
  revisaTitulo: string;
  revisaEmpresa: string;
  revisaNombre: string;
  revisaCi: string;
  // Firmas Páginas 3..N (4 columnas)
  sup1Cargo: string;
  sup1Ente: string;
  sup1Nombre: string;
  sup1Ci: string;
  sup2Cargo: string;
  sup2Ente: string;
  sup2Nombre: string;
  sup2Ci: string;
  sup3Cargo: string;
  sup3Ente: string;
  sup3Nombre: string;
  sup3Ci: string;
  sup4Cargo: string;
  sup4Ente: string;
  sup4Nombre: string;
  sup4Ci: string;
};

export const CONFIG_VALUACION_INICIAL: ConfigValuacion = {
  departamento: 'DEPARTAMENTO DE ADMINISTRACIÓN DE CONTRATOS',
  titulo: 'Soporte de medición por partida',
  subtituloDiario: 'Registro diario de acarreo y pesaje',
  contratista: 'GOLDEN TOUCH',
  contrato: 'Acuerdo de Subcontratista',
  valuacion: '01 (UNO)',
  itemNro: '1',
  codigo: '',
  unidad: 't',
  contratado: '-',
  partida: 'Operación del CDT y transporte del material procesado al CDF',
  sitioDisposicion: '',
  acumuladoAnterior: '',
  conLogoInstitucional: true,
  elaboraTitulo: 'Representante Subcontratista',
  elaboraEmpresa: 'GOLDEN TOUCH',
  elaboraNombre: '',
  elaboraCi: '',
  conformaTitulo: 'Gerente de Operaciones',
  conformaEmpresa: 'Miyamoto International Inc.',
  conformaNombre: 'Ing. Miguel Ordoñez',
  conformaCi: 'V-6.968.323',
  revisaTitulo: 'Administración de Contratos',
  revisaEmpresa: 'Miyamoto International Inc.',
  revisaNombre: 'Ing. Marielys Barrena',
  revisaCi: 'V-17.426.579',
  sup1Cargo: 'SUPERVISOR DE ROMANA',
  sup1Ente: 'Designado por GOLDEN TOUCH',
  sup1Nombre: '',
  sup1Ci: '',
  sup2Cargo: 'SUPERVISOR DE ROMANA',
  sup2Ente: 'Designado por Miyamoto International Inc.',
  sup2Nombre: '',
  sup2Ci: '',
  sup3Cargo: 'SUPERVISOR DE CAMPO',
  sup3Ente: 'Designado por Miyamoto International Inc.',
  sup3Nombre: '',
  sup3Ci: '',
  sup4Cargo: 'SUPERVISOR DE ROMANA',
  sup4Ente: 'Designado por MPPOP',
  sup4Nombre: 'Jonaikel Borges',
  sup4Ci: 'V-27.042.767',
};

export function escHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Jornada (7am a 7am Caracas UTC-4) de un instante ISO. */
export function jornadaDeInstante(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t - 11 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Hora local de Caracas HH:mm a partir de un instante ISO. */
export function horaCaracas(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t - 4 * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function diaSemanaEs(iso: string): string {
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return DIAS_SEMANA[new Date(t).getUTCDay()] ?? '';
}

export function dmy(iso: string): string {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

export function dm(iso: string): string {
  const [, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return m && d ? `${d}/${m}` : '—';
}

/** Formato numérico estilo contrato: miles con coma y decimales con punto (ej. 7,028.86). */
export function fmtDec(n: number, dec = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  const [ent, d] = Math.abs(v).toFixed(dec).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? '-' : ''}${miles}${dec > 0 ? `.${d}` : ''}`;
}

export function fmtInt(n: number): string {
  return fmtDec(Math.round(n), 0);
}

/** Lista inclusiva de todas las fechas YYYY-MM-DD entre desde y hasta. */
export function listarDiasPeriodo(desde: string, hasta: string): string[] {
  const t0 = Date.parse(`${desde.slice(0, 10)}T12:00:00Z`);
  const t1 = Date.parse(`${hasta.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return [];
  const res: string[] = [];
  for (let t = t0; t <= t1 && res.length < 366; t += 86400000) {
    res.push(new Date(t).toISOString().slice(0, 10));
  }
  return res;
}

export type FilaDiariaValuacion = {
  fecha: string;
  soporte: 'Control diario' | 'Sin actividad';
  viajes: number;
  cantidadT: number;
  acumuladoT: number;
  viajesAcum: number;
  viajesDetalle: ViajeValuacion[];
};

export type FrenteResumenValuacion = {
  numero: number;
  nombre: string;
  inicio: string;
  cierre: string;
  cantidadT: number;
  viajes: number;
  estado: string;
  avancePct: number;
  actaCierre: string;
};

export type DatosValuacion = {
  dias: FilaDiariaValuacion[];
  diasActivos: FilaDiariaValuacion[];
  totalViajes: number;
  totalT: number;
  maxDiaT: number;
  frentes: FrenteResumenValuacion[];
  totalFrentesT: number;
  cuadraFrentes: boolean;
  acumuladoAnteriorT: number | null;
  acumuladoAFechaT: number;
  saldoContractualT: number | null;
  sitioInferido: string;
  totalPaginas: number;
};

export function construirDatosValuacion(
  viajes: readonly ViajeValuacion[],
  desde: string,
  hasta: string,
  cfg: Pick<ConfigValuacion, 'acumuladoAnterior' | 'contratado' | 'sitioDisposicion'>
): DatosValuacion {
  const fechas = listarDiasPeriodo(desde, hasta);
  const porDia = new Map<string, ViajeValuacion[]>();
  const sitios = new Set<string>();

  (viajes ?? []).forEach((v) => {
    if (!v?.id) return;
    const j = jornadaDeInstante(v.registered_at);
    if (!j || j < desde || j > hasta) return;
    const list = porDia.get(j) ?? [];
    list.push(v);
    porDia.set(j, list);
    const ub = String(v.ubicacion_nombre ?? '').trim();
    if (ub) sitios.add(ub);
  });

  let acumT = 0;
  let acumViajes = 0;
  let maxDiaT = 0;

  const dias: FilaDiariaValuacion[] = fechas.map((fecha) => {
    const lista = (porDia.get(fecha) ?? []).slice().sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at)));
    const viajesDia = lista.length;
    const kgDia = lista.reduce((s, v) => s + num(v.peso_neto_kg), 0);
    const cantT = r2(kgDia / 1000);
    if (viajesDia > 0) {
      acumT = r2(acumT + cantT);
      acumViajes += viajesDia;
      if (cantT > maxDiaT) maxDiaT = cantT;
    }
    return {
      fecha,
      soporte: viajesDia > 0 ? 'Control diario' : 'Sin actividad',
      viajes: viajesDia,
      cantidadT: cantT,
      acumuladoT: acumT,
      viajesAcum: acumViajes,
      viajesDetalle: lista,
    };
  });

  const diasActivos = dias.filter((d) => d.viajes > 0);
  const totalT = r2(dias.reduce((s, d) => s + d.cantidadT, 0));
  const totalViajes = dias.reduce((s, d) => s + d.viajes, 0);

  // Agrupación por frentes de trabajo
  const frentesMap = new Map<string, { nombre: string; inicio: string; kg: number; viajes: number }>();
  diasActivos.forEach((d) => {
    d.viajesDetalle.forEach((v) => {
      const nombre = String(v.frente_nombre ?? '').trim() || 'Sin frente';
      const cur = frentesMap.get(nombre) ?? { nombre, inicio: d.fecha, kg: 0, viajes: 0 };
      if (d.fecha < cur.inicio) cur.inicio = d.fecha;
      cur.kg += num(v.peso_neto_kg);
      cur.viajes += 1;
      frentesMap.set(nombre, cur);
    });
  });

  const frentes: FrenteResumenValuacion[] = Array.from(frentesMap.values())
    .sort((a, b) => b.kg - a.kg || a.nombre.localeCompare(b.nombre, 'es'))
    .map((f, idx) => {
      const cantidadT = r2(f.kg / 1000);
      return {
        numero: idx + 1,
        nombre: f.nombre,
        inicio: f.inicio,
        cierre: '-',
        cantidadT,
        viajes: f.viajes,
        estado: 'En proceso',
        avancePct: totalT > 0 ? r2((cantidadT / totalT) * 100) : 0,
        actaCierre: '-',
      };
    });

  const totalFrentesT = r2(frentes.reduce((s, f) => s + f.cantidadT, 0));
  const cuadraFrentes = Math.abs(totalFrentesT - totalT) < 0.02;

  const antRaw = String(cfg.acumuladoAnterior ?? '').trim().replace(',', '.');
  const antParsed = antRaw && Number.isFinite(Number(antRaw)) ? Number(antRaw) : null;
  const acumuladoAFechaT = r2((antParsed ?? 0) + totalT);

  const contRaw = String(cfg.contratado ?? '').trim().replace(/,/g, '');
  const contParsed = contRaw && contRaw !== '-' && Number.isFinite(Number(contRaw)) ? Number(contRaw) : null;
  const saldoContractualT = contParsed != null ? r2(contParsed - acumuladoAFechaT) : null;

  const sitioInferido = String(cfg.sitioDisposicion ?? '').trim() || Array.from(sitios).join(' · ') || '—';

  return {
    dias,
    diasActivos,
    totalViajes,
    totalT,
    maxDiaT,
    frentes,
    totalFrentesT,
    cuadraFrentes,
    acumuladoAnteriorT: antParsed,
    acumuladoAFechaT,
    saldoContractualT,
    sitioInferido,
    totalPaginas: 2 + diasActivos.length,
  };
}

function headerInstitucionalHtml(cfg: ConfigValuacion, subtitulo: string): string {
  const logoHtml = cfg.conLogoInstitucional
    ? `<div class="inst-row">
        <div class="inst-flag" aria-hidden="true">
          <div style="background:#FFCC00;height:33%"></div>
          <div style="background:#00247D;height:34%"></div>
          <div style="background:#CF142B;height:33%"></div>
        </div>
        <div class="inst-text">
          <div class="inst-sup">Vicepresidencia Sectorial de</div>
          <div class="inst-main">OBRAS PÚBLICAS Y SERVICIOS</div>
        </div>
        <div class="inst-sep"></div>
        <div class="inst-miyamoto">miyamoto<span class="dot">.</span></div>
      </div>`
    : '';
  return `
    ${logoHtml}
    <div class="dept">${escHtml(cfg.departamento)}</div>
    <div class="doc-h1">${escHtml(subtitulo)}</div>
    <div class="cyan-line"></div>
  `;
}

function footerHtml(pagina: number, total: number): string {
  return `
    <div class="page-foot">
      <span>Departamento de Administración de Contratos</span>
      <span>Página ${pagina} de ${total}</span>
    </div>
  `;
}

export function generarHtmlValuacionPdf(opts: {
  viajes: readonly ViajeValuacion[];
  maquinas: readonly MaquinaValuacion[];
  /** Respaldo de chofer por `machinery_id|shift` (cuando `chofer_name` viene vacío en viajes previos). */
  choferesPorCamionTurno?: ReadonlyMap<string, string> | Record<string, string>;
  desde: string;
  hasta: string;
  config: ConfigValuacion;
}): string {
  const { viajes, maquinas, choferesPorCamionTurno, desde, hasta, config: cfg } = opts;
  const datos = construirDatosValuacion(viajes, desde, hasta, cfg);
  const maqById = new Map<string, MaquinaValuacion>();
  (maquinas ?? []).forEach((m) => maqById.set(m.id, m));

  const getChoferMapa = (k: string): string => {
    if (!choferesPorCamionTurno) return '';
    if (choferesPorCamionTurno instanceof Map) return String(choferesPorCamionTurno.get(k) ?? '').trim();
    return String((choferesPorCamionTurno as Record<string, string>)[k] ?? '').trim();
  };

  const choferDe = (v: ViajeValuacion): string => {
    const snap = String(v.chofer_name ?? '').trim();
    if (snap) return snap;
    if (!v.machinery_id) return '';
    const turnoRaw = String(v.shift ?? '').trim().toLowerCase();
    let turno: 'day' | 'night' = turnoRaw === 'night' ? 'night' : 'day';
    if (turnoRaw !== 'day' && turnoRaw !== 'night') {
      const hh = Number(horaCaracas(v.registered_at).slice(0, 2));
      turno = Number.isFinite(hh) && (hh < 7 || hh >= 19) ? 'night' : 'day';
    }
    return (
      getChoferMapa(`${v.machinery_id}|${turno}`) ||
      getChoferMapa(`${v.machinery_id}|day`) ||
      getChoferMapa(`${v.machinery_id}|night`)
    );
  };

  const placaDe = (v: ViajeValuacion): string => {
    const snap = String(v.placa_snap ?? '').trim();
    if (snap) return snap;
    const m = v.machinery_id ? maqById.get(v.machinery_id) : undefined;
    return String(m?.plate ?? '').trim() || String(m?.serial ?? '').trim() || '—';
  };

  const tipoVehiculoDe = (v: ViajeValuacion): string => {
    const m = v.machinery_id ? maqById.get(v.machinery_id) : undefined;
    return String(v.machine_code ?? '').trim() || String(m?.code ?? '').trim() || '—';
  };

  // ── Página 1: Carátula + Registro Diario del Período ────────────────────────
  const filasP1 = datos.dias.map((d) => {
    const activo = d.viajes > 0;
    const pct = activo && datos.maxDiaT > 0 ? Math.max(4, Math.round((d.cantidadT / datos.maxDiaT) * 100)) : 0;
    const barCell = activo
      ? `<div class="bar-wrap"><span class="bar-dt">${dm(d.fecha)}</span><span class="bar-fill" style="width:${Math.round(pct * 0.65)}%"></span><span class="bar-val">${fmtDec(d.cantidadT)}</span></div>`
      : `<div class="bar-wrap"><span class="bar-dt">${dm(d.fecha)}</span><span class="bar-dash">–</span></div>`;

    return `
      <tr>
        <td class="c">${dmy(d.fecha)}</td>
        <td class="c">${d.soporte}</td>
        <td class="c">${activo ? d.viajes : '–'}</td>
        <td class="c">${activo ? fmtDec(d.cantidadT) : '–'}</td>
        <td class="c">${d.acumuladoT > 0 ? fmtDec(d.acumuladoT) : '–'}</td>
        <td class="c">${d.viajesAcum > 0 ? d.viajesAcum : '–'}</td>
        <td class="bar-td">${barCell}</td>
      </tr>
    `;
  }).join('');

  const page1 = `
    <div class="page page-portrait">
      ${headerInstitucionalHtml(cfg, cfg.titulo)}
      <table class="meta-tbl">
        <tr>
          <td class="lbl">CONTRATISTA</td><td class="val b">${escHtml(cfg.contratista)}</td>
          <td class="lbl">CONTRATO</td><td class="val">${escHtml(cfg.contrato)}</td>
        </tr>
        <tr>
          <td class="lbl">VALUACIÓN</td><td class="val b">${escHtml(cfg.valuacion)}</td>
          <td class="lbl">PERÍODO</td><td class="val">${dmy(desde)} al ${dmy(hasta)}</td>
        </tr>
        <tr>
          <td class="lbl">ÍTEM N°</td><td class="val b c">${escHtml(cfg.itemNro)}</td>
          <td class="lbl" style="width:12%">CÓDIGO</td><td class="val" style="padding:0">
            <table class="inner-meta"><tr>
              <td style="width:25%">${escHtml(cfg.codigo)}</td>
              <td class="lbl" style="width:20%">UNIDAD</td>
              <td class="b c" style="width:15%">${escHtml(cfg.unidad)}</td>
              <td class="lbl" style="width:22%">CONTRATADO</td>
              <td class="c" style="width:18%">${escHtml(cfg.contratado || '-')}</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td class="lbl">PARTIDA</td><td class="val" colspan="3">${escHtml(cfg.partida)}</td>
        </tr>
      </table>

      <table class="grid-tbl" style="margin-top:10px">
        <thead>
          <tr class="sec-head"><th colspan="7">1 &nbsp; REGISTRO DIARIO DEL PERÍODO</th></tr>
          <tr class="col-head">
            <th style="width:12%">Fecha</th>
            <th style="width:14%">Soporte</th>
            <th style="width:8%">Viajes</th>
            <th style="width:11%">Cantidad</th>
            <th style="width:11%">Acumulado</th>
            <th style="width:9%">Viajes acum.</th>
            <th style="width:35%">Rendimiento diario</th>
          </tr>
        </thead>
        <tbody>${filasP1}</tbody>
        <tfoot>
          <tr class="tot-row">
            <td colspan="2" class="c b">TOTAL</td>
            <td class="c b">${datos.totalViajes}</td>
            <td class="c b cyan-cell">${fmtDec(datos.totalT)}</td>
            <td colspan="3" style="background:#fff;border-right:none;border-bottom:none"></td>
          </tr>
        </tfoot>
      </table>
      ${footerHtml(1, datos.totalPaginas)}
    </div>
  `;

  // ── Página 2: Distribución por frentes + Conciliación + 3 Firmas ────────────
  const filasFrentes = datos.frentes.length > 0
    ? datos.frentes.map((f) => `
      <tr>
        <td class="c">${f.numero}</td>
        <td>${escHtml(f.nombre)}</td>
        <td class="c">${dmy(f.inicio)}</td>
        <td class="c">${escHtml(f.cierre)}</td>
        <td class="r b">${fmtDec(f.cantidadT)}</td>
        <td class="c">${escHtml(f.estado)}</td>
        <td class="c">${fmtDec(f.avancePct, 1)}%</td>
        <td class="c">${escHtml(f.actaCierre)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="8" class="c muted">Sin frentes registrados en el período</td></tr>`;

  const difFrentes = r2(datos.totalT - datos.totalFrentesT);
  const page2 = `
    <div class="page page-portrait">
      ${headerInstitucionalHtml(cfg, cfg.titulo)}

      <table class="grid-tbl">
        <thead>
          <tr class="sec-head"><th colspan="8">2 &nbsp; DISTRIBUCIÓN POR FRENTES DE TRABAJO</th></tr>
          <tr class="col-head">
            <th style="width:8%">Frente N°</th>
            <th style="width:31%">Denominación</th>
            <th style="width:11%">Inicio</th>
            <th style="width:9%">Cierre</th>
            <th style="width:11%">Cantidad</th>
            <th style="width:11%">Estado</th>
            <th style="width:8%">Avance</th>
            <th style="width:11%">Acta de cierre N°</th>
          </tr>
        </thead>
        <tbody>${filasFrentes}</tbody>
        <tfoot>
          <tr class="tot-row">
            <td colspan="4" class="r b">TOTAL POR FRENTES</td>
            <td class="r b">${fmtDec(datos.totalFrentesT)}</td>
            <td colspan="3" class="c b">${datos.cuadraFrentes ? 'Cuadra' : `Dif: ${fmtDec(difFrentes)}`}</td>
          </tr>
        </tfoot>
      </table>

      <table class="grid-tbl" style="margin-top:14px">
        <thead>
          <tr class="sec-head"><th colspan="4">3 &nbsp; CONCILIACIÓN DE LA PARTIDA</th></tr>
          <tr class="col-head">
            <th style="width:52%">Concepto</th>
            <th style="width:16%">Cantidad</th>
            <th style="width:16%">Diferencia</th>
            <th style="width:16%">Resultado</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Medido en el período (registro diario)</td>
            <td class="c b">${fmtDec(datos.totalT)}</td>
            <td class="c">-</td>
            <td class="c">-</td>
          </tr>
          <tr>
            <td>Relacionado en el período (Relación de cantidades ejecutadas)</td>
            <td class="c b">${fmtDec(datos.totalT)}</td>
            <td class="c">–</td>
            <td class="c b">CUADRA</td>
          </tr>
          <tr>
            <td>Distribuido por frentes</td>
            <td class="c b">${fmtDec(datos.totalFrentesT)}</td>
            <td class="c">${datos.cuadraFrentes ? '–' : fmtDec(difFrentes)}</td>
            <td class="c b">${datos.cuadraFrentes ? 'CUADRA' : 'REVISAR'}</td>
          </tr>
          <tr>
            <td>Acumulado anterior (Relación de cantidades ejecutadas)</td>
            <td class="c">${datos.acumuladoAnteriorT != null ? fmtDec(datos.acumuladoAnteriorT) : '-'}</td>
            <td class="c">-</td>
            <td class="c">-</td>
          </tr>
          <tr>
            <td>Acumulado a la fecha (anterior + medido)</td>
            <td class="c b">${fmtDec(datos.acumuladoAFechaT)}</td>
            <td class="c">-</td>
            <td class="c">-</td>
          </tr>
          <tr>
            <td>Saldo contractual de la partida</td>
            <td class="c">${datos.saldoContractualT != null ? fmtDec(datos.saldoContractualT) : '-'}</td>
            <td class="c">-</td>
            <td class="c">-</td>
          </tr>
        </tbody>
      </table>

      <table class="sign-tbl" style="margin-top:18px">
        <tr class="sign-head">
          <th>ELABORA</th>
          <th>CONFORMA</th>
          <th>REVISA</th>
        </tr>
        <tr class="sign-role">
          <td><b>${escHtml(cfg.elaboraTitulo)}</b><br/><b>${escHtml(cfg.elaboraEmpresa)}</b></td>
          <td><b>${escHtml(cfg.conformaTitulo)}</b><br/><b>${escHtml(cfg.conformaEmpresa)}</b></td>
          <td><b>${escHtml(cfg.revisaTitulo)}</b><br/><b>${escHtml(cfg.revisaEmpresa)}</b></td>
        </tr>
        <tr class="sign-box">
          <td><div class="firma-sello">Firma y sello</div></td>
          <td><div class="firma-sello">Firma y sello</div></td>
          <td><div class="firma-sello">Firma y sello</div></td>
        </tr>
        <tr class="sign-data">
          <td>Nombre: ${escHtml(cfg.elaboraNombre)}</td>
          <td>Nombre: ${escHtml(cfg.conformaNombre)}</td>
          <td>Nombre: ${escHtml(cfg.revisaNombre)}</td>
        </tr>
        <tr class="sign-data">
          <td>C.I.: ${escHtml(cfg.elaboraCi)}</td>
          <td>C.I.: ${escHtml(cfg.conformaCi)}</td>
          <td>C.I.: ${escHtml(cfg.revisaCi)}</td>
        </tr>
      </table>

      ${footerHtml(2, datos.totalPaginas)}
    </div>
  `;

  // ── Páginas 3..N: Registro diario de acarreo y pesaje (landscape) ───────────
  const pagesDiarias = datos.diasActivos.map((d, idx) => {
    const regNro = idx + 1;
    const pagNro = 3 + idx;
    let totalNetoKg = 0;

    const filasViajes = d.viajesDetalle.map((v, i) => {
      const tara = v.peso_tara_kg != null && num(v.peso_tara_kg) > 0 ? fmtInt(num(v.peso_tara_kg)) : '';
      const bruto = v.peso_bruto_kg != null && num(v.peso_bruto_kg) > 0 ? fmtInt(num(v.peso_bruto_kg)) : '';
      const netoKg = num(v.peso_neto_kg);
      totalNetoKg += netoKg;
      const netoT = r2(netoKg / 1000);
      const frente = String(v.frente_nombre ?? '').trim() || 'Sin frente';

      return `
        <tr>
          <td class="c">${i + 1}</td>
          <td class="c">${horaCaracas(v.registered_at)}</td>
          <td class="c b">${escHtml(placaDe(v))}</td>
          <td>${escHtml(tipoVehiculoDe(v))}</td>
          <td>${escHtml(choferDe(v))}</td>
          <td class="r">${tara}</td>
          <td class="r">${bruto}</td>
          <td class="r">${netoKg > 0 ? fmtInt(netoKg) : '—'}</td>
          <td class="r b">${netoKg > 0 ? fmtDec(netoT) : '—'}</td>
          <td>${escHtml(frente)}</td>
        </tr>
      `;
    }).join('');

    const totalNetoT = r2(totalNetoKg / 1000);

    // Resumen por frente del día
    const fDiaMap = new Map<string, { nombre: string; viajes: number; kg: number }>();
    d.viajesDetalle.forEach((v) => {
      const nombre = String(v.frente_nombre ?? '').trim() || 'Sin frente';
      const cur = fDiaMap.get(nombre) ?? { nombre, viajes: 0, kg: 0 };
      cur.viajes += 1;
      cur.kg += num(v.peso_neto_kg);
      fDiaMap.set(nombre, cur);
    });
    const fDiaArr = Array.from(fDiaMap.values()).sort((a, b) => b.kg - a.kg || a.nombre.localeCompare(b.nombre, 'es'));
    const fDiaRows = fDiaArr.map((f) => {
      const t = r2(f.kg / 1000);
      const pct = totalNetoT > 0 ? r2((t / totalNetoT) * 100) : (d.viajes > 0 ? r2((f.viajes / d.viajes) * 100) : 0);
      return `
        <tr>
          <td>${escHtml(f.nombre)}</td>
          <td class="c">${f.viajes}</td>
          <td class="c">${fmtDec(t)}</td>
          <td class="c">${fmtDec(pct, 1)}%</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="page page-landscape">
        ${headerInstitucionalHtml(cfg, cfg.subtituloDiario)}

        <table class="meta-tbl">
          <tr>
            <td class="lbl" style="width:12%">CONTRATISTA</td>
            <td class="val b" style="width:30%">${escHtml(cfg.contratista)}</td>
            <td class="lbl" style="width:12%">REGISTRO N°</td>
            <td class="val c b" style="width:8%">${regNro}</td>
            <td class="lbl" style="width:10%">FECHA</td>
            <td class="val c b" style="width:14%">${dmy(d.fecha)}</td>
            <td class="val c b" style="width:14%">${escHtml(diaSemanaEs(d.fecha))}</td>
          </tr>
          <tr>
            <td class="lbl">CONTRATO N°</td>
            <td class="val">${escHtml(cfg.contrato)}</td>
            <td class="lbl">SITIO DE DISPOSICIÓN</td>
            <td class="val" colspan="4">${escHtml(datos.sitioInferido)}</td>
          </tr>
        </table>

        <table class="grid-tbl" style="margin-top:8px">
          <thead>
            <tr class="col-head">
              <th style="width:4%">N°</th>
              <th style="width:6%">Hora</th>
              <th style="width:10%">Placa</th>
              <th style="width:16%">Tipo de vehículo</th>
              <th style="width:15%">Conductor</th>
              <th style="width:8%">Tara (kg)</th>
              <th style="width:8%">Bruto (kg)</th>
              <th style="width:9%">Neto (kg)</th>
              <th style="width:8%">Neto (t)</th>
              <th style="width:16%">Frente de origen</th>
            </tr>
          </thead>
          <tbody>${filasViajes}</tbody>
          <tfoot>
            <tr class="tot-row">
              <td colspan="6" class="b" style="background:#e9edf2">VIAJES REGISTRADOS: ${d.viajes}</td>
              <td class="r b">TOTAL</td>
              <td class="r b">${fmtInt(totalNetoKg)}</td>
              <td class="r b cyan-cell">${fmtDec(totalNetoT)}</td>
              <td style="background:#e9edf2"></td>
            </tr>
          </tfoot>
        </table>

        <table class="grid-tbl" style="width:52%;margin-top:8px">
          <thead>
            <tr class="sec-head"><th colspan="4">RESUMEN POR FRENTE DE ORIGEN</th></tr>
            <tr class="col-head">
              <th style="width:46%">Frente</th>
              <th style="width:14%">Viajes</th>
              <th style="width:20%">Neto (t)</th>
              <th style="width:20%">% del día</th>
            </tr>
          </thead>
          <tbody>${fDiaRows}</tbody>
          <tfoot>
            <tr class="tot-row">
              <td class="r b">TOTAL</td>
              <td class="c b">${d.viajes}</td>
              <td class="c b">${fmtDec(totalNetoT)}</td>
              <td class="c b">Cuadra</td>
            </tr>
          </tfoot>
        </table>

        <table class="sign-tbl" style="margin-top:10px">
          <tr class="sign-head">
            <th style="width:25%">${escHtml(cfg.sup1Cargo)}</th>
            <th style="width:25%">${escHtml(cfg.sup2Cargo)}</th>
            <th style="width:25%">${escHtml(cfg.sup3Cargo)}</th>
            <th style="width:25%">${escHtml(cfg.sup4Cargo)}</th>
          </tr>
          <tr class="sign-role">
            <td>${escHtml(cfg.sup1Ente)}</td>
            <td>${escHtml(cfg.sup2Ente)}</td>
            <td>${escHtml(cfg.sup3Ente)}</td>
            <td>${escHtml(cfg.sup4Ente)}</td>
          </tr>
          <tr class="sign-box">
            <td><div class="firma-sello">Firma y sello</div></td>
            <td><div class="firma-sello">Firma y sello</div></td>
            <td><div class="firma-sello">Firma y sello</div></td>
            <td><div class="firma-sello">Firma y sello</div></td>
          </tr>
          <tr class="sign-data">
            <td>Nombre: ${escHtml(cfg.sup1Nombre)}</td>
            <td>Nombre: ${escHtml(cfg.sup2Nombre)}</td>
            <td>Nombre: ${escHtml(cfg.sup3Nombre)}</td>
            <td>Nombre: ${escHtml(cfg.sup4Nombre)}</td>
          </tr>
          <tr class="sign-data">
            <td>C.I.: ${escHtml(cfg.sup1Ci)}</td>
            <td>C.I.: ${escHtml(cfg.sup2Ci)}</td>
            <td>C.I.: ${escHtml(cfg.sup3Ci)}</td>
            <td>C.I.: ${escHtml(cfg.sup4Ci)}</td>
          </tr>
        </table>

        ${footerHtml(pagNro, datos.totalPaginas)}
      </div>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escHtml(cfg.titulo)} — ${dmy(desde)} al ${dmy(hasta)}</title>
<style>
  @page { size: letter; margin: 11mm 12mm 12mm 12mm; }
  @page portraitPage { size: letter portrait; margin: 11mm 12mm 12mm 12mm; }
  @page landscapePage { size: letter landscape; margin: 10mm 12mm 10mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 9.5px; }
  .page { position: relative; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page-portrait { page: portraitPage; }
  .page-landscape { page: landscapePage; }
  .inst-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .inst-flag { width: 28px; height: 18px; border: 1px solid #d1d5db; overflow: hidden; border-radius: 2px; }
  .inst-text { line-height: 1.1; color: #16324F; }
  .inst-sup { font-size: 8px; font-weight: 600; }
  .inst-main { font-size: 8.5px; font-weight: 900; letter-spacing: .2px; }
  .inst-sep { width: 1px; height: 22px; background: #9ca3af; margin: 0 4px; }
  .inst-miyamoto { font-size: 13px; font-weight: 800; color: #1f2937; letter-spacing: -.3px; }
  .inst-miyamoto .dot { color: #0084B4; }
  .dept { font-size: 8.5px; font-weight: 700; color: #4b5563; letter-spacing: .3px; margin-bottom: 2px; }
  .doc-h1 { font-size: 14px; font-weight: 800; color: #1f2937; margin-bottom: 4px; }
  .cyan-line { height: 2px; background: #0084B4; margin-bottom: 8px; }

  .meta-tbl { width: 100%; border-collapse: collapse; font-size: 9px; }
  .meta-tbl td { border: 1px solid #9ca3af; padding: 4px 6px; }
  .meta-tbl .lbl { background: #e6f2f8; color: #1f2937; font-weight: 700; width: 14%; }
  .meta-tbl .val { background: #fff; }
  .inner-meta { width: 100%; border-collapse: collapse; }
  .inner-meta td { border: none; border-right: 1px solid #9ca3af; padding: 4px 5px; }
  .inner-meta td:last-child { border-right: none; }

  .grid-tbl { width: 100%; border-collapse: collapse; font-size: 8.8px; }
  .grid-tbl th, .grid-tbl td { border: 1px solid #9ca3af; padding: 3px 5px; }
  .grid-tbl .sec-head th { background: #2d2d2d; color: #fff; text-align: left; font-size: 9px; font-weight: 800; padding: 4px 6px; letter-spacing: .3px; }
  .grid-tbl .col-head th { background: #d9dce0; color: #111827; font-weight: 800; text-align: center; padding: 4px 4px; }
  .grid-tbl tbody tr:nth-child(even) { background: #f8fafc; }
  .tot-row td { background: #d9dce0; border-top: 1.5px solid #4b5563; padding: 4px 5px; }
  .cyan-cell { background: #0084B4 !important; color: #fff !important; }

  .bar-td { background: #e8f3f9 !important; padding: 2px 6px !important; }
  .bar-wrap { display: flex; align-items: center; gap: 5px; }
  .bar-dt { width: 28px; color: #374151; font-size: 8px; }
  .bar-fill { display: inline-block; height: 9px; background: #0072B2; border-radius: 1px; }
  .bar-val { font-size: 8px; font-weight: 700; color: #111827; }
  .bar-dash { font-size: 8px; color: #6b7280; }

  .sign-tbl { width: 100%; border-collapse: collapse; font-size: 8.5px; page-break-inside: avoid; break-inside: avoid; }
  .sign-tbl th, .sign-tbl td { border: 1px solid #9ca3af; padding: 3px 6px; }
  .sign-head th { background: #d9dce0; color: #111827; font-weight: 800; text-align: center; padding: 4px; }
  .sign-role td { text-align: center; padding: 5px 6px; background: #fff; }
  .sign-box td { height: 34px; vertical-align: bottom; text-align: center; background: #fff; }
  .firma-sello { color: #9ca3af; font-style: italic; font-size: 7.5px; }
  .sign-data td { background: #fff; text-align: left; }

  .page-foot { margin-top: 10px; display: flex; justify-content: space-between; font-size: 7.5px; color: #6b7280; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 800; }
  .muted { color: #6b7280; }
</style>
</head>
<body>
  ${page1}
  ${page2}
  ${pagesDiarias}
</body>
</html>`;
}
