import { supabase, selectAllRows } from './supabase';
import { pdfDocument, exportPdf } from './pdf';
import { cmpText } from './text';
import { sectorOf, sectorLabel } from './mapZones';
import { listVisits } from './supervisorVisits';

/**
 * Reporte de INSPECTORES (jornadas de inspección) en PDF.
 *
 * Reglas del cliente:
 * - Agrupado POR INSPECTOR. Cada jornada de inspección la registra un inspector
 *   (`machine_rounds.recorded_by`) y pertenece a un TURNO (`jornada_shift`):
 *   ☀️ Día o 🌙 Noche. La jornada de DÍA es de un inspector y la de NOCHE de otro.
 * - El filtro permite ver solo Día, solo Noche o AMBOS (juntos, con secciones
 *   separadas por turno → inspector).
 * - Por inspector: sus máquinas con horas de día, de noche y TOTAL; y un desglose
 *   por SECTOR (máquinas agrupadas por `machinery.sector`) con subtotales.
 * - Si una máquina CAMBIÓ de ubicación durante la jornada (más de un check-in en
 *   `supervisor_visits` con ubicación distinta), se listan TODAS las ubicaciones.
 * - Al final, líneas de FIRMA para el/los inspector(es).
 * - Se filtra a los usuarios ADMIN (mismo criterio que la Supervisión).
 */
export type InspectorShift = 'day' | 'night' | 'both';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const r2 = (n: number) => Math.round(n * 100) / 100;

type Turno = 'day' | 'night';
type Mach = { id: string; code: string; company: string; sector: string; dayH: number; nightH: number };
type LocInfo = { key: string; label: string; at: string };

/** Etiqueta legible + clave para deduplicar una ubicación (GPS del check-in + edificio/referencia). */
function locLabel(lat: number | null, lng: number | null, ref: string | null): { key: string; label: string } {
  const cleanRef = (ref && String(ref).trim()) || '';
  // Ignora referencias que son SOLO números (p. ej. "46564.0"): no aportan lugar.
  const meaningfulRef = cleanRef && !/^[\d.,\s\/-]+$/.test(cleanRef) ? cleanRef : '';
  const sec = lat != null && lng != null ? sectorOf(lat, lng) : null;
  const secTxt = sec ? sectorLabel(sec) : '';
  const parts: string[] = [];
  if (meaningfulRef) parts.push(meaningfulRef);
  if (secTxt) parts.push(secTxt);
  if (lat != null && lng != null) parts.push(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  const label = parts.length ? parts.join(' · ') : 'Sin ubicación';
  // Clave: coordenadas redondeadas (≈11 m) o, si no hay GPS, el edificio/referencia.
  const key = lat != null && lng != null ? `${lat.toFixed(4)},${lng.toFixed(4)}` : (meaningfulRef.toLowerCase() || 'sin');
  return { key, label };
}

/**
 * Genera y exporta el PDF del reporte de inspectores para un día y un turno.
 * @param date  día ISO "AAAA-MM-DD"
 * @param shift 'day' | 'night' | 'both'
 * @param companies (opcional) filtra por nombre de empresa (vacío/null = todas)
 * @returns true si el usuario confirmó (imprimió/guardó), false si canceló.
 */
export async function generateInspectorReport(opts: { date: string; shift: InspectorShift; companies?: string[] | null }): Promise<boolean> {
  const { date, shift } = opts;
  const cos = opts.companies && opts.companies.length ? opts.companies : null;
  const wantDay = shift === 'day' || shift === 'both';
  const wantNight = shift === 'night' || shift === 'both';

  // 1) Perfiles: nombre por id y set de admins (a excluir, como en Supervisión).
  const { data: profs } = await supabase.from('profiles').select('id, full_name, role');
  const nameById: Record<string, string> = {};
  const adminIds = new Set<string>();
  ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) nameById[p.id] = p.full_name; if (p.role === 'admin') adminIds.add(p.id); });

  // 2) Jornadas de inspección del día (machine_rounds con recorded_by = inspector).
  const rounds = await selectAllRows(
    'machine_rounds',
    'machinery_id, day_hours, night_hours, jornada_shift, recorded_by, jornada_start_at, machine:machinery_id(code, serial, plate, sector, parroquia, company:company_id(name))',
    (q) => q.eq('round_date', date)
  );

  // 3) Ubicaciones por máquina (todos los check-in del día, ubicaciones distintas).
  const visits = await listVisits(date);
  const locByMachine = new Map<string, LocInfo[]>();
  visits.forEach((v) => {
    const lat = (v.lat ?? v.machineLat ?? null) as number | null;
    const lng = (v.lng ?? v.machineLng ?? null) as number | null;
    const { key, label } = locLabel(lat, lng, v.machineRef ?? null);
    const arr = locByMachine.get(v.machinery_id) ?? [];
    if (!arr.some((x) => x.key === key)) arr.push({ key, label, at: v.visited_at });
    locByMachine.set(v.machinery_id, arr);
  });
  const machineLocs = (id: string): LocInfo[] =>
    (locByMachine.get(id) ?? []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // 4) Agregación: turno → inspector → máquina (suma horas día/noche por máquina).
  const data = new Map<Turno, Map<string, Map<string, Mach>>>();
  const inspectorsAll = new Set<string>();
  ((rounds ?? []) as any[]).forEach((r) => {
    const rb = (r.recorded_by ?? null) as string | null;
    if (!rb || adminIds.has(rb)) return; // solo jornadas de inspector; sin admins
    const dayH = Number(r.day_hours) || 0;
    const nightH = Number(r.night_hours) || 0;
    if (!(r.jornada_start_at || dayH > 0 || nightH > 0)) return; // jornada abierta o con horas
    const turno: Turno = r.jornada_shift === 'night' ? 'night'
      : r.jornada_shift === 'day' ? 'day'
      : (nightH > 0 && dayH === 0 ? 'night' : 'day');
    if (turno === 'day' && !wantDay) return;
    if (turno === 'night' && !wantNight) return;
    const mm = r.machine || {};
    const company = mm.company?.name ?? 'Sin empresa';
    if (cos && !cos.includes(company)) return;
    const insp = nameById[rb] || '—';
    const tMap = data.get(turno) ?? new Map<string, Map<string, Mach>>();
    data.set(turno, tMap);
    const iMap = tMap.get(insp) ?? new Map<string, Mach>();
    tMap.set(insp, iMap);
    const cur = iMap.get(r.machinery_id) ?? {
      id: r.machinery_id as string,
      code: mm.code ?? '—',
      company,
      sector: (mm.sector && String(mm.sector).trim()) || 'Sin sector',
      dayH: 0,
      nightH: 0,
    };
    cur.dayH += dayH; cur.nightH += nightH;
    iMap.set(r.machinery_id, cur);
    inspectorsAll.add(insp);
  });

  // ── HTML ──────────────────────────────────────────────────────────────────
  const turnoMeta: Record<Turno, { icon: string; label: string }> = {
    day: { icon: '☀️', label: 'Jornada de día' },
    night: { icon: '🌙', label: 'Jornada de noche' },
  };

  const renderInspector = (insp: string, machMap: Map<string, Mach>): string => {
    const list = [...machMap.values()].sort((a, b) => cmpText(a.code, b.code));
    let tD = 0, tN = 0;
    const rows = list.map((m, i) => {
      const tot = r2(m.dayH + m.nightH);
      tD += m.dayH; tN += m.nightH;
      const moved = machineLocs(m.id).length > 1;
      return `<tr><td>${i + 1}</td><td><b>${esc(m.code)}</b>${moved ? ' <span class="moved">↔ cambió de ubicación</span>' : ''}</td><td>${esc(m.company)}</td><td>${esc(m.sector)}</td><td class="r">${r2(m.dayH)}</td><td class="r">${r2(m.nightH)}</td><td class="r b">${tot}</td></tr>`;
    }).join('');
    const machTable = `<table class="ir"><thead><tr><th style="width:26px">Nº</th><th>Máquina</th><th>Empresa</th><th>Sector</th><th class="r">H. Día</th><th class="r">H. Noche</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4">Total · ${list.length} equipo(s)</td><td class="r">${r2(tD)}</td><td class="r">${r2(tN)}</td><td class="r b">${r2(tD + tN)}</td></tr></tfoot></table>`;

    // Desglose por SECTOR con subtotales.
    const bySec = new Map<string, { c: number; d: number; n: number }>();
    list.forEach((m) => { const s = bySec.get(m.sector) ?? { c: 0, d: 0, n: 0 }; s.c += 1; s.d += m.dayH; s.n += m.nightH; bySec.set(m.sector, s); });
    const secRows = [...bySec.entries()].sort((a, b) => cmpText(a[0], b[0]))
      .map(([s, v]) => `<tr><td>${esc(s)}</td><td class="r">${v.c}</td><td class="r">${r2(v.d)}</td><td class="r">${r2(v.n)}</td><td class="r b">${r2(v.d + v.n)}</td></tr>`).join('');
    const secTable = `<div class="sub">📍 Desglose por sector</div><table class="ir"><thead><tr><th>Sector</th><th class="r">Equipos</th><th class="r">H. Día</th><th class="r">H. Noche</th><th class="r">Total</th></tr></thead><tbody>${secRows}</tbody></table>`;

    // Ubicaciones múltiples: solo máquinas que cambiaron de sitio en la jornada.
    const moved = list.filter((m) => machineLocs(m.id).length > 1);
    const locHtml = moved.length
      ? `<div class="sub">🗺️ Máquinas que cambiaron de ubicación (todas sus ubicaciones)</div><ul class="locs">${moved.map((m) => {
          const locs = machineLocs(m.id);
          return `<li><b>${esc(m.code)}</b>: ${locs.map((l, i) => `<span class="loc">${i + 1}. ${esc(l.label)}</span>`).join(' <span class="arr">→</span> ')}</li>`;
        }).join('')}</ul>`
      : '';

    return `<div class="insp">👷 Inspector: <b>${esc(insp)}</b> <span class="cnt">${list.length} equipo(s)</span></div>${machTable}${secTable}${locHtml}`;
  };

  const renderTurno = (turno: Turno): string => {
    const tMap = data.get(turno);
    const meta = turnoMeta[turno];
    if (!tMap || !tMap.size) {
      // Solo se muestra el encabezado vacío cuando el usuario pidió ese turno explícito o "ambos".
      return `<h2 class="turno">${meta.icon} ${meta.label}</h2><p class="none">Sin jornadas de inspección en este turno.</p>`;
    }
    const inspNames = [...tMap.keys()].sort(cmpText);
    return `<h2 class="turno">${meta.icon} ${meta.label} <span class="tcnt">${inspNames.length} inspector(es)</span></h2>${inspNames.map((n) => renderInspector(n, tMap.get(n)!)).join('')}`;
  };

  const turnos: Turno[] = shift === 'day' ? ['day'] : shift === 'night' ? ['night'] : ['day', 'night'];
  const hasAny = turnos.some((t) => (data.get(t)?.size ?? 0) > 0);

  // Firmas: una línea por inspector (A→Z), con su nombre.
  const firmas = [...inspectorsAll].sort(cmpText);
  const firmaHtml = firmas.length
    ? `<div class="firmas"><div class="sub">✍️ Firmas de los inspectores</div><div class="firmarow">${firmas.map((n) =>
        `<div class="firma"><div class="line"></div><div class="fname">${esc(n)}</div><div class="frole">Inspector</div></div>`).join('')}</div></div>`
    : '';

  const shiftTxt = shift === 'day' ? 'Turno día ☀️' : shift === 'night' ? 'Turno noche 🌙' : 'Ambos turnos ☀️ 🌙';
  const body = hasAny
    ? `${turnos.map(renderTurno).join('')}${firmaHtml}`
    : `<p class="none">Sin jornadas de inspección para el día ${dmy(date)}${shift === 'both' ? '' : ` (${shift === 'day' ? 'turno día' : 'turno noche'})`}.</p>`;

  const extraCss = `
    h2.turno{font-size:15px;color:#1E3A5F;margin:20px 0 6px;padding-bottom:6px;border-bottom:2px solid #1E3A5F}
    h2.turno .tcnt{font-size:11px;color:#6B7280;font-weight:600}
    .insp{margin:14px 0 4px;font-size:12.5px;color:#111;border-left:4px solid #1E3A5F;padding-left:8px}
    .insp .cnt{background:#EEF2F7;color:#1E3A5F;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px}
    .sub{margin:12px 0 2px;font-size:12px;font-weight:700;color:#374151}
    table.ir{width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:11.5px}
    table.ir th,table.ir td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
    table.ir th{background:#1E3A5F;color:#fff}
    table.ir td.r,table.ir th.r{text-align:right}
    table.ir td.b{font-weight:800}
    table.ir tfoot td{background:#EEF2F7;font-weight:800}
    .moved{color:#B45309;font-size:10px;font-weight:700}
    ul.locs{margin:4px 0 10px;padding-left:18px;font-size:11.5px;color:#374151}
    ul.locs li{margin:3px 0}
    ul.locs .loc{white-space:nowrap}
    ul.locs .arr{color:#B45309;font-weight:700}
    .none{color:#6B7280;font-size:12px}
    .firmas{margin-top:26px;page-break-inside:avoid}
    .firmarow{display:flex;flex-wrap:wrap;gap:26px;margin-top:12px}
    .firma{width:220px;margin-top:26px}
    .firma .line{border-top:1px solid #333;margin-bottom:4px}
    .firma .fname{font-size:12px;font-weight:700;color:#111}
    .firma .frole{font-size:10px;color:#6B7280}
  `;

  const html = pdfDocument({
    title: 'REPORTE DE INSPECTORES',
    subtitle: `Jornadas de inspección · ${dmy(date)} · ${shiftTxt}`,
    body,
    extraCss,
  });
  return await exportPdf(html, `Reporte - Inspectores ${dmy(date)}`);
}
