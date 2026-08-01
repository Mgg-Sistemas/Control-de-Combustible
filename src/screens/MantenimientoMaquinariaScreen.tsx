import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert, Image } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { supabase } from '../lib/supabase';
import { norm, onlyDecimal, cmpText } from '../lib/text';
import { sectorOf, sectorLabel } from '../lib/mapZones';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const MAT_ICON: Record<string, string> = { caucho: '🛞', aceite: '🛢️', filtro: '🧴', repuesto: '🔩', otro: '✏️' };
const matLabel = (m: string) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : '—');
// Materiales de avería para reportar al escanear (incluye "Otro" = falla libre).
const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
  { key: 'otro', label: 'Otro', icon: '✏️' },
];
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };
const todayISO = () => { const d = new Date(); const p = (n: number) => `${n}`.padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDMY = (iso?: string | null) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('T')[0].split('-'); return y && m && d ? `${d}/${m}/${y}` : String(iso); };
function fmtDT(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Coordenadas legibles (o null si la máquina no tiene GPS).
const coordText = (lat?: number | null, lng?: number | null): string | null =>
  (lat != null && lng != null && isFinite(lat) && isFinite(lng)) ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : null;
// Edificio / sector: por la ubicación GPS; si no cae en zona, usa la referencia.
const edificioText = (lat?: number | null, lng?: number | null, referencia?: string | null): string => {
  const s = sectorLabel(sectorOf(lat, lng));
  return s && s !== 'Sin zona' ? s : ((referencia || '').trim() || 'Sin zona');
};

type Req = { id: string; machinery_id: string; material: string; quantity: number | null; notes: string | null; status: string; created_at: string; code: string; tipo: string | null; company: string; photo_url: string | null; plate: string | null; serial: string | null; last_horometro: number | null; operational: boolean; referencia: string | null; sector: string | null; parroquia: string | null; latitude: number | null; longitude: number | null; requested_by: string | null; requestedByName: string | null };
type Rep = { id: string; machinery_id: string; tipo: string; out_at: string; estimated_days: number | null; estimated_note: string | null; work_done: string | null; back_at: string | null; status: string; created_at: string; code: string; company: string };
type Mach = { id: string; code: string; tipo: string | null; clasificacion: string | null; plate: string | null; serial: string | null; company: string; operational: boolean };

type Tab = 'averias' | 'reparacion' | 'historial' | 'reporte';
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * MANTENIMIENTO DE MAQUINARIA (coordinadores de mantenimiento).
 *  - Averías por empresa → máquina (lo que reporta el operador por QR).
 *  - Enviar una máquina a reparación (salida, tiempo estimado, tipo) → queda No operativa.
 *  - Registrar el retorno operativo (qué se le cambió + fecha) → vuelve a Operativa.
 *  - Historial de reparaciones por máquina.
 */
export default function MantenimientoMaquinariaScreen() {
  const { colors } = useTheme();
  const { canSee, session } = useAuth();
  const confirm = useConfirm();
  const uid = session?.user?.id ?? null;

  const [reqs, setReqs] = useState<Req[]>([]);
  const [repairs, setRepairs] = useState<Rep[]>([]);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('averias');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Enviar a reparación
  const [repFor, setRepFor] = useState<Mach | null>(null);
  const [rTipo, setRTipo] = useState<'preventivo' | 'correctivo'>('correctivo');
  const [rOut, setROut] = useState(todayISO());
  const [rDays, setRDays] = useState('');
  const [rNote, setRNote] = useState('');
  const [rWork, setRWork] = useState('');

  // Registrar retorno operativo
  const [retFor, setRetFor] = useState<Rep | null>(null);
  const [retBack, setRetBack] = useState(todayISO());
  const [retWork, setRetWork] = useState('');

  // Selector de máquina (para enviar cualquiera a reparación)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');

  // Detalle de una avería (datos de la máquina + la falla + foto de referencia)
  const [detailReq, setDetailReq] = useState<Req | null>(null);

  // Escanear una máquina para REPORTAR una avería (desde la vista de admin).
  const [scanOpen, setScanOpen] = useState(false);
  const [avMachine, setAvMachine] = useState<{ id: string; code: string; plate: string | null } | null>(null);
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);
  const [avBusy, setAvBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Grupos de empresa colapsados en la pestaña Averías (empresa → abierto/cerrado).
  const [avOpen, setAvOpen] = useState<Record<string, boolean>>({});

  // ── Reporte / Dashboard de averías ──────────────────────────────────────────
  const [gastoByMachine, setGastoByMachine] = useState<Record<string, number>>({});
  // Inspecciones por máquina (para cruzar inspección ↔ avería en el detalle).
  const [inspByMachine, setInspByMachine] = useState<Record<string, any[]>>({});
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [repGroupBy, setRepGroupBy] = useState<'equipo' | 'empresa' | 'tipo'>('equipo');
  const [repClasFilter, setRepClasFilter] = useState<string>('__all__'); // filtro por clasificación (tipo de maquinaria)
  const [repCaseFilter, setRepCaseFilter] = useState<'all' | 'con' | 'sin_insp' | 'sin_averia'>('all'); // avería+insp / avería sin insp / insp sin avería
  const [repDetailId, setRepDetailId] = useState<string | null>(null);   // máquina cuyo detalle se ve

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const load = async () => {
    setLoading(true);
    const [{ data: mr }, { data: rp }, { data: mac }, { data: profs }] = await Promise.all([
      supabase.from('maintenance_requests').select('id, machinery_id, material, quantity, notes, status, created_at, photo_url, requested_by, machinery:machinery_id(code, tipo, plate, serial, referencia, sector, parroquia, latitude, longitude, last_horometro, operational, company:company_id(name))').order('created_at', { ascending: false }),
      supabase.from('machinery_repairs').select('id, machinery_id, tipo, out_at, estimated_days, estimated_note, work_done, back_at, status, created_at, machinery:machinery_id(code, company:company_id(name))').order('created_at', { ascending: false }),
      supabase.from('machinery').select('id, code, tipo, clasificacion, plate, serial, operational, active, company:company_id(name)').eq('active', true).order('code'),
      supabase.from('profiles').select('id, full_name'),
    ]);
    // Mapa uuid → nombre para resolver quién reportó cada avería (requested_by).
    const nameById = new Map<string, string>();
    (profs ?? []).forEach((p: any) => { if (p.full_name) nameById.set(p.id, p.full_name); });
    setReqs((mr ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, material: r.material, quantity: r.quantity != null ? Number(r.quantity) : null, notes: r.notes ?? null, status: r.status, created_at: r.created_at, code: r.machinery?.code ?? '—', tipo: r.machinery?.tipo ?? null, company: r.machinery?.company?.name ?? 'Sin empresa', photo_url: r.photo_url ?? null, plate: r.machinery?.plate ?? null, serial: r.machinery?.serial ?? null, last_horometro: r.machinery?.last_horometro != null ? Number(r.machinery.last_horometro) : null, operational: r.machinery?.operational !== false, referencia: r.machinery?.referencia ?? null, sector: r.machinery?.sector ?? null, parroquia: r.machinery?.parroquia ?? null, latitude: r.machinery?.latitude != null ? Number(r.machinery.latitude) : null, longitude: r.machinery?.longitude != null ? Number(r.machinery.longitude) : null, requested_by: r.requested_by ?? null, requestedByName: r.requested_by ? (nameById.get(r.requested_by) ?? null) : null })));
    setRepairs((rp ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, tipo: r.tipo, out_at: r.out_at, estimated_days: r.estimated_days != null ? Number(r.estimated_days) : null, estimated_note: r.estimated_note ?? null, work_done: r.work_done ?? null, back_at: r.back_at ?? null, status: r.status, created_at: r.created_at, code: r.machinery?.code ?? '—', company: r.machinery?.company?.name ?? 'Sin empresa' })));
    setMachines((mac ?? []).map((m: any) => ({ id: m.id, code: m.code, tipo: m.tipo ?? null, clasificacion: m.clasificacion ?? null, plate: m.plate ?? null, serial: m.serial ?? null, company: m.company?.name ?? 'Sin empresa', operational: m.operational !== false })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Gasto por equipo = materiales que SALIERON del almacén para esa máquina × su costo.
  // El equipo se toma de machinery_id del movimiento; para salidas viejas (sin ese dato)
  // se atribuye leyendo el CÓDIGO del equipo en el texto de la salida (reason).
  const loadReportData = async () => {
    setReportLoading(true);
    const [{ data: mv }, { data: items }, { data: insp }] = await Promise.all([
      supabase.from('inventory_movements').select('item_id, qty, unit_cost, machinery_id, reason, kind').in('kind', ['salida', 'consumo']),
      supabase.from('inventory_items').select('id, machinery_id, avg_cost'),
      supabase.from('machine_inspections').select('id, machinery_id, inspected_at, inspector_name, condicion_general, items').order('inspected_at', { ascending: false }),
    ]);
    // Inspecciones agrupadas por equipo (para cruzarlas con las averías en el detalle).
    const inspMap: Record<string, any[]> = {};
    (insp ?? []).forEach((r: any) => { if (r.machinery_id) (inspMap[r.machinery_id] ??= []).push(r); });
    setInspByMachine(inspMap);
    const itemMap = new Map<string, { machinery_id: string | null; avg_cost: number }>();
    (items ?? []).forEach((it: any) => itemMap.set(it.id, { machinery_id: it.machinery_id ?? null, avg_cost: Number(it.avg_cost) || 0 }));
    // Códigos de más largo a más corto para que el match del texto sea el más específico.
    const codeList = machines.map((m) => ({ id: m.id, code: m.code })).filter((c) => c.code).sort((a, b) => b.code.length - a.code.length);
    const gasto: Record<string, number> = {};
    (mv ?? []).forEach((m: any) => {
      const it = itemMap.get(m.item_id);
      const unit = m.unit_cost != null ? Number(m.unit_cost) : (it?.avg_cost ?? 0);
      const cost = (Number(m.qty) || 0) * (Number(unit) || 0);
      let mid: string | null = m.machinery_id ?? it?.machinery_id ?? null;
      if (!mid && m.reason) { const hit = codeList.find((c) => String(m.reason).includes(` · ${c.code}`)); mid = hit?.id ?? null; }
      if (mid) gasto[mid] = (gasto[mid] ?? 0) + cost;
    });
    setGastoByMachine(gasto);
    setReportLoaded(true);
    setReportLoading(false);
  };
  useEffect(() => { if (tab === 'reporte' && !reportLoaded && !loading) loadReportData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, loading]);

  // Estadística por MÁQUINA: total de averías (todas), desglose por material y fechas.
  const machineStats = useMemo(() => {
    const by = new Map<string, { id: string; code: string; company: string; plate: string | null; serial: string | null; clasificacion: string | null; total: number; byMat: Record<string, number>; }>();
    reqs.forEach((r) => {
      const mac = machines.find((m) => m.id === r.machinery_id);
      const g = by.get(r.machinery_id) ?? { id: r.machinery_id, code: r.code, company: r.company, plate: r.plate, serial: r.serial, clasificacion: mac?.clasificacion ?? null, total: 0, byMat: {} };
      g.total += 1;
      g.byMat[r.material] = (g.byMat[r.material] ?? 0) + 1;
      by.set(r.machinery_id, g);
    });
    return Array.from(by.values());
  }, [reqs, machines]);

  // Reparación ACTIVA por máquina (si existe).
  const activeRepairByMachine = useMemo(() => {
    const m = new Map<string, Rep>();
    repairs.forEach((r) => { if (r.status === 'en_reparacion' && !m.has(r.machinery_id)) m.set(r.machinery_id, r); });
    return m;
  }, [repairs]);

  const marcarRealizado = async (r: Req) => {
    const ok = await confirm({ title: 'Mantenimiento realizado', message: `¿Marcar como REALIZADO el ${matLabel(r.material)} de "${r.code}"?`, confirmText: 'Sí, realizado', cancelText: 'Cancelar' });
    if (!ok) return;
    setBusy(r.id);
    const { error } = await supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: new Date().toISOString() }).eq('id', r.id);
    setBusy(null);
    if (error) return Alert.alert('Aviso', error.message);
    setReqs((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'realizado' } : x)));
  };

  // ── Escanear una máquina para reportar una avería ───────────────────────────
  const onScanDetected = async (text: string) => {
    setScanOpen(false);
    const id = parseMachineId(text);
    if (!id) { setNotice('❌ QR no reconocido. Escanea el QR de una máquina.'); return; }
    const { data } = await supabase.from('machinery').select('id, code, plate').eq('id', id).single();
    if (!data) { setNotice('❌ No se encontró esa máquina.'); return; }
    setAvMachine(data as any); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); setNotice(null);
  };
  const subirFotoAveria = async () => {
    if (!avMachine) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(avMachine.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };
  const registrarAveria = async () => {
    if (!avMachine || !avMaterial) return;
    if (avMaterial === 'otro' && !avNote.trim()) { setNotice('❌ Describe la falla para registrar "Otro".'); return; }
    setAvBusy(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: avMachine.id,
      material: avMaterial,
      quantity: avMaterial === 'otro' ? null : numOrNull(avQty),
      notes: avNote.trim() || null,
      status: 'pendiente',
      requested_by: uid,
      photo_url: avPhoto,
    });
    setAvBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    const code = avMachine.code;
    setAvMachine(null); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null);
    setNotice(`✅ Avería registrada · ${code}.`);
    setTab('averias');
    await load();
  };

  // ── Exportar el reporte de averías a PDF (por empresa → equipo) ──────────────
  const exportReportePdf = async () => {
    if (!reportLoaded) await loadReportData();
    // UNIVERSO: equipos con avería + equipos con inspección (aunque no tengan avería).
    const statById = new Map(machineStats.map((s) => [s.id, s]));
    const universe = machineStats.map((s) => ({ ...s }));
    Object.keys(inspByMachine).forEach((id) => {
      if (statById.has(id)) return;
      const mac = machines.find((m) => m.id === id);
      if (!mac) return;
      universe.push({ id, code: mac.code, company: mac.company, plate: mac.plate, serial: mac.serial, clasificacion: mac.clasificacion, total: 0, byMat: {} as Record<string, number> });
    });
    const flaggedOf = (id: string) => { const ins = inspByMachine[id] ?? []; return ins.length ? (ins[0].items ?? []).filter((it: any) => it.nivel === 'warn' || it.nivel === 'bad').length : 0; };
    const casoTxt = (id: string, total: number) => (total > 0 ? ((inspByMachine[id] ?? []).length ? `🔧🔍 Avería + insp. (${flaggedOf(id)} obs.)` : '🔧 Avería sin insp.') : `🔍 Insp. sin avería (${flaggedOf(id)} obs.)`);
    // Agrupa por empresa → equipos.
    const byCompany = new Map<string, typeof universe>();
    universe.forEach((s) => { const arr = byCompany.get(s.company) ?? []; arr.push(s); byCompany.set(s.company, arr); });
    const companies = Array.from(byCompany.entries()).sort((a, b) => cmpText(a[0], b[0]));
    const mats = ['caucho', 'aceite', 'filtro', 'repuesto', 'otro'];
    const matHead = mats.map((m) => `<th>${matLabel(m)}</th>`).join('');
    let grandAv = 0, grandGasto = 0;
    const cnt = { con: 0, sin_insp: 0, sin_averia: 0 };
    const sections = companies.map(([company, list]) => {
      list.sort((a, b) => b.total - a.total);
      let cAv = 0, cGasto = 0;
      const rows = list.map((s) => {
        const g = gastoByMachine[s.id] ?? 0; cAv += s.total; cGasto += g;
        if (s.total > 0) { if ((inspByMachine[s.id] ?? []).length) cnt.con++; else cnt.sin_insp++; } else cnt.sin_averia++;
        const matCells = mats.map((m) => `<td style="text-align:center">${s.byMat[m] ?? 0}</td>`).join('');
        const ident = [s.plate, s.serial].filter(Boolean).join(' · ') || '—';
        return `<tr><td>${s.code}</td><td style="color:#666">${ident}</td><td style="text-align:center;font-weight:700">${s.total}</td>${matCells}<td style="text-align:right;font-weight:700">${usd(g)}</td><td style="font-size:11px">${casoTxt(s.id, s.total)}</td></tr>`;
      }).join('');
      grandAv += cAv; grandGasto += cGasto;
      return `<h3 style="margin:14px 0 4px">🏢 ${company} · ${list.length} equipo(s) · ${cAv} avería(s) · ${usd(cGasto)}</h3>
        <table><thead><tr><th>Equipo</th><th>Placa / Serial</th><th>Averías</th>${matHead}<th>Gasto</th><th>Caso</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    const body = `<div style="margin-bottom:8px;font-weight:700">TOTAL: ${grandAv} avería(s) · Gasto ${usd(grandGasto)}</div>
      <div style="margin-bottom:8px;font-size:12px">🔧🔍 Avería + inspección: ${cnt.con} &nbsp;·&nbsp; 🔧 Avería sin inspección: ${cnt.sin_insp} &nbsp;·&nbsp; 🔍 Inspección sin avería: ${cnt.sin_averia}</div>${sections}
      <p style="color:#888;font-size:11px;margin-top:10px">El gasto corresponde a los materiales que salieron del almacén para cada equipo (cantidad × costo). La columna Caso cruza las averías con la última inspección del equipo.</p>`;
    const html = pdfDocument({ title: 'Reporte de averías + inspección', subtitle: `${universe.length} equipo(s)`, body });
    await exportPdf(html, 'Reporte de averias e inspeccion');
  };

  // ── Enviar a reparación ─────────────────────────────────────────────────────
  const openRepair = (m: Mach) => {
    setRepFor(m); setRTipo('correctivo'); setROut(todayISO()); setRDays(''); setRNote(''); setRWork('');
    setPickerOpen(false);
  };
  const enviarReparacion = async () => {
    if (!repFor) return;
    setBusy('rep');
    const payload = {
      machinery_id: repFor.id, tipo: rTipo, out_at: rOut,
      estimated_days: rDays.trim() ? Number(rDays.replace(',', '.')) : null,
      estimated_note: rNote.trim() || null, work_done: rWork.trim() || null,
      status: 'en_reparacion', created_by: uid,
    };
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('machinery_repairs').insert(payload),
      supabase.from('machinery').update({ operational: false }).eq('id', repFor.id),
    ]);
    setBusy(null);
    if (e1 || e2) return Alert.alert('Aviso', (e1?.message || e2?.message) as string);
    setRepFor(null);
    await load();
    setTab('reparacion');
  };

  // ── Registrar retorno operativo ─────────────────────────────────────────────
  const openReturn = (r: Rep) => { setRetFor(r); setRetBack(todayISO()); setRetWork(r.work_done ?? ''); };
  const registrarRetorno = async () => {
    if (!retFor) return;
    if (!retWork.trim()) return Alert.alert('Aviso', 'Indica qué se le cambió / reparó a la máquina.');
    setBusy('ret');
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('machinery_repairs').update({ status: 'operativa', back_at: retBack, work_done: retWork.trim(), closed_by: uid }).eq('id', retFor.id),
      supabase.from('machinery').update({ operational: true, en_espera: false }).eq('id', retFor.machinery_id),
    ]);
    setBusy(null);
    if (e1 || e2) return Alert.alert('Aviso', (e1?.message || e2?.message) as string);
    setRetFor(null);
    await load();
  };

  // ── Agrupaciones por pestaña ────────────────────────────────────────────────
  const nq = norm(query.trim());
  const matchesQ = (code: string, company: string) => !nq || norm(company).includes(nq) || norm(code).includes(nq);

  // AVERÍAS pendientes por empresa → máquina.
  const averiaGroups = useMemo(() => {
    const shown = reqs.filter((r) => r.status === 'pendiente' && matchesQ(r.code, r.company));
    const byCompany = new Map<string, Map<string, Req[]>>();
    shown.forEach((r) => {
      const comp = byCompany.get(r.company) ?? new Map<string, Req[]>();
      const arr = comp.get(r.code) ?? []; arr.push(r); comp.set(r.code, arr); byCompany.set(r.company, comp);
    });
    return Array.from(byCompany.entries()).map(([company, mm]) => ({ company, machines: Array.from(mm.entries()).map(([code, items]) => ({ code, items, machinery_id: items[0].machinery_id, tipo: items[0]?.tipo ?? null })).sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) => a.company.localeCompare(b.company));
  }, [reqs, nq]);

  const enReparacion = useMemo(() => repairs.filter((r) => r.status === 'en_reparacion' && matchesQ(r.code, r.company)), [repairs, nq]);
  const historial = useMemo(() => repairs.filter((r) => r.status === 'operativa' && matchesQ(r.code, r.company)), [repairs, nq]);

  const pendientes = reqs.filter((r) => r.status === 'pendiente').length;
  const enRepCount = repairs.filter((r) => r.status === 'en_reparacion').length;

  if (!canSee('mantenimiento')) {
    return (<Screen><SectionTitle>Mantenimiento de Maquinaria</SectionTitle><EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo." /></Screen>);
  }

  const TIPO_BADGE = (t: string) => (t === 'preventivo' ? { label: '🩺 Preventivo', tone: 'muted' as const } : { label: '🔧 Correctivo', tone: 'warning' as const });

  const pickerList = machines.filter((m) => { const q = norm(pickerQ.trim()); return !q || norm(m.code).includes(q) || norm(m.company).includes(q); });

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Mantenimiento de Maquinaria</SectionTitle>

      {/* Pestañas */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {([['averias', `⏳ Averías (${pendientes})`], ['reparacion', `🔧 Reparación (${enRepCount})`], ['historial', '✓ Historial'], ['reporte', '📊 Reporte']] as const).map(([k, label]) => {
          const on = tab === k;
          return (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)} style={{ marginBottom: spacing.sm }}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: notice.startsWith('✅') ? colors.success : colors.danger, borderRadius: radius.md, padding: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <TouchableOpacity onPress={() => setScanOpen(true)} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>📷 Escanear · reportar avería</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setPickerQ(''); setPickerOpen(true); }} style={{ flex: 1, backgroundColor: '#B45309', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🔧 Enviar a reparación</Text>
        </TouchableOpacity>
      </View>

      <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar empresa o máquina…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

      {loading ? (
        <Loading />
      ) : tab === 'averias' ? (
        averiaGroups.length === 0 ? (
          <EmptyState title="Sin averías pendientes" subtitle="Cuando un operador reporte una avería, aparecerá aquí por máquina." />
        ) : (
          averiaGroups.map((g) => {
            // Colapsable: cerrada por defecto; al buscar (nq) se abren todas para no ocultar resultados.
            const open = !!avOpen[g.company] || !!nq;
            const totalAverias = g.machines.reduce((s, mm) => s + mm.items.length, 0);
            return (
            <View key={g.company}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setAvOpen((p) => ({ ...p, [g.company]: !open }))}>
                <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: colors.warning, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏢 {g.company}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {g.machines.length} máquina(s) · 🛠️ {totalAverias} avería(s)</Text>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
              {open ? g.machines.map((mm) => {
                const rep = activeRepairByMachine.get(mm.machinery_id);
                const mac = machines.find((m) => m.id === mm.machinery_id) ?? { id: mm.machinery_id, code: mm.code, tipo: mm.tipo, clasificacion: null, plate: null, serial: null, company: g.company, operational: true };
                return (
                  <Card key={mm.code}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{mm.code}{mm.tipo ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '400' }}>  ·  {mm.tipo}</Text> : null}</Text>
                    {(() => {
                      // Datos de la máquina (comunes a todas sus averías): placa/serial, ubicación, referencia, edificio.
                      const mi = mm.items[0];
                      const ident = [mi.plate, mi.serial].filter(Boolean).join(' · ');
                      const coords = coordText(mi.latitude, mi.longitude);
                      const edif = edificioText(mi.latitude, mi.longitude, mi.referencia);
                      return (
                        <View style={{ marginTop: 2, gap: 1 }}>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 Placa / Serial: <Text style={{ color: colors.text, fontWeight: '600' }}>{ident || '—'}</Text></Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>📍 Ubicación: <Text style={{ color: colors.text, fontWeight: '600' }}>{coords || '—'}</Text></Text>
                          {mi.referencia ? <Text style={{ color: colors.muted, fontSize: 12 }}>🧭 Referencia: <Text style={{ color: colors.text, fontWeight: '600' }}>{mi.referencia}</Text></Text> : null}
                          <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 Edificio / sector: <Text style={{ color: colors.text, fontWeight: '600' }}>{edif}</Text></Text>
                        </View>
                      );
                    })()}
                    {mm.items.map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ fontSize: 24 }}>{MAT_ICON[r.material] ?? '🔧'}</Text>
                        <TouchableOpacity activeOpacity={0.7} onPress={() => setDetailReq(r)} style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>{matLabel(r.material)}{r.quantity != null ? ` · ${r.quantity.toLocaleString()}` : ''}{r.photo_url ? '  📷' : ''}</Text>
                          {r.notes ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{r.notes}</Text> : null}
                          <Text style={{ color: colors.muted, fontSize: 12 }}>👮 Reportó: <Text style={{ color: colors.text, fontWeight: '600' }}>{r.requestedByName || '—'}</Text></Text>
                          <Text style={{ color: colors.primary, fontSize: 11 }}>{fmtDT(r.created_at)} · ver detalle ›</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => marcarRealizado(r)} disabled={busy === r.id} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{busy === r.id ? '…' : '✓ Realizado'}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {rep ? (
                      <View style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.warning }}>
                        <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>🔧 En reparación desde {fmtDMY(rep.out_at)}{rep.estimated_days != null ? ` · estimado ${rep.estimated_days} día(s)` : ''}</Text>
                        <TouchableOpacity onPress={() => openReturn(rep)} style={{ marginTop: spacing.xs, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.xs, alignItems: 'center' }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✓ Registrar retorno operativo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => openRepair(mac)} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: '#B45309', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: '#B45309', fontWeight: '800', fontSize: 12 }}>🔧 Enviar a reparación</Text>
                      </TouchableOpacity>
                    )}
                  </Card>
                );
              }) : null}
            </View>
            );
          })
        )
      ) : tab === 'reparacion' ? (
        enReparacion.length === 0 ? (
          <EmptyState title="Ninguna máquina en reparación" subtitle="Usa “Enviar una máquina a reparación” para registrar una salida." />
        ) : (
          enReparacion.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                <Badge {...TIPO_BADGE(r.tipo)} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
              <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '700', marginTop: spacing.xs }}>🔧 Salió a reparación: {fmtDMY(r.out_at)}{r.estimated_days != null ? ` · estimado ${r.estimated_days} día(s)` : ''}</Text>
              {r.estimated_note ? <Text style={{ color: colors.muted, fontSize: 12 }}>⏱️ {r.estimated_note}</Text> : null}
              {r.work_done ? <Text style={{ color: colors.muted, fontSize: 12 }}>🔩 {r.work_done}</Text> : null}
              <TouchableOpacity onPress={() => openReturn(r)} style={{ marginTop: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>✓ Registrar retorno operativo</Text>
              </TouchableOpacity>
            </Card>
          ))
        )
      ) : tab === 'historial' ? (
        historial.length === 0 ? (
          <EmptyState title="Sin reparaciones cerradas" subtitle="Las reparaciones terminadas (máquina de vuelta operativa) aparecerán aquí." />
        ) : (
          historial.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                <Badge {...TIPO_BADGE(r.tipo)} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
              <Text style={{ color: colors.text, fontSize: 13, marginTop: spacing.xs }}>📅 {fmtDMY(r.out_at)} → {fmtDMY(r.back_at)} <Text style={{ color: colors.success, fontWeight: '700' }}>· Operativa</Text></Text>
              {r.work_done ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🔩 Se cambió: {r.work_done}</Text> : null}
            </Card>
          ))
        )
      ) : (
        // ── 📊 REPORTE / DASHBOARD ────────────────────────────────────────────
        (() => {
          // UNIVERSO = equipos con avería (machineStats) + equipos con inspección (aunque no
          // tengan avería). Así se cubren los 3 casos: avería+inspección, avería sin inspección,
          // e inspección sin avería.
          const statById = new Map(machineStats.map((s) => [s.id, s]));
          const universe = machineStats.map((s) => ({ ...s }));
          Object.keys(inspByMachine).forEach((id) => {
            if (statById.has(id)) return;
            const mac = machines.find((m) => m.id === id);
            if (!mac) return; // inspección de un equipo ya inactivo/borrado
            universe.push({ id, code: mac.code, company: mac.company, plate: mac.plate, serial: mac.serial, clasificacion: mac.clasificacion, total: 0, byMat: {} });
          });
          if (universe.length === 0) return <EmptyState title="Sin averías ni inspecciones" subtitle="Cuando se reporten averías o inspecciones podrás ver aquí el reporte y el dashboard." />;
          const gastoOf = (id: string) => gastoByMachine[id] ?? 0;
          const flaggedOf = (id: string) => { const ins = inspByMachine[id] ?? []; return ins.length ? (ins[0].items ?? []).filter((it: any) => it.nivel === 'warn' || it.nivel === 'bad').length : 0; };
          const hasInsp = (id: string) => (inspByMachine[id] ?? []).length > 0;
          // Caso de cada equipo.
          const casoOf = (id: string, total: number): 'con' | 'sin_insp' | 'sin_averia' => (total > 0 ? (hasInsp(id) ? 'con' : 'sin_insp') : 'sin_averia');
          const CASO_BADGE: Record<string, { label: string; color: string }> = {
            con: { label: '🔧🔍 Avería + inspección', color: '#B45309' },
            sin_insp: { label: '🔧 Avería sin inspección', color: colors.danger },
            sin_averia: { label: '🔍 Inspección sin avería', color: '#2563EB' },
          };
          // Conteo por caso (sobre el universo filtrado por clasificación).
          const clasValues = Array.from(new Set(universe.map((s) => s.clasificacion || 'Sin clasificación'))).sort(cmpText);
          const byClas = universe.filter((s) => repClasFilter === '__all__' || (s.clasificacion || 'Sin clasificación') === repClasFilter);
          const casoCount = { con: 0, sin_insp: 0, sin_averia: 0 };
          byClas.forEach((s) => { casoCount[casoOf(s.id, s.total)]++; });
          // Aplica también el filtro por caso.
          const statsF = byClas.filter((s) => repCaseFilter === 'all' || casoOf(s.id, s.total) === repCaseFilter);
          // Filas según el agrupador.
          type Row = { key: string; title: string; sub: string; total: number; gasto: number; caso?: 'con' | 'sin_insp' | 'sin_averia'; onPress?: () => void };
          let rows: Row[] = [];
          if (repGroupBy === 'equipo') {
            rows = statsF.map((s) => {
              const flagged = flaggedOf(s.id);
              const inspHint = hasInsp(s.id) ? ` · 🔍 ${flagged} obs.` : '';
              const ident = [s.plate, s.serial].filter(Boolean).join(' · ');
              return { key: s.id, title: s.code, sub: `🏢 ${s.company}${ident ? ` · ${ident}` : ''}${inspHint}`, total: s.total, gasto: gastoOf(s.id), caso: casoOf(s.id, s.total), onPress: () => setRepDetailId(s.id) };
            });
          } else {
            const agg = new Map<string, { total: number; gasto: number; machs: Set<string> }>();
            statsF.forEach((s) => {
              const k = repGroupBy === 'empresa' ? s.company : (s.clasificacion || 'Sin clasificación');
              const g = agg.get(k) ?? { total: 0, gasto: 0, machs: new Set<string>() };
              g.total += s.total; g.gasto += gastoOf(s.id); g.machs.add(s.id); agg.set(k, g);
            });
            rows = Array.from(agg.entries()).map(([k, g]) => ({ key: k, title: k, sub: `🚜 ${g.machs.size} equipo(s)`, total: g.total, gasto: g.gasto }));
          }
          rows.sort((a, b) => b.total - a.total || b.gasto - a.gasto);
          const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;
          const grandAverias = rows.reduce((s, r) => s + r.total, 0);
          const grandGasto = rows.reduce((s, r) => s + r.gasto, 0);
          return (
            <View>
              {/* Totales */}
              <Card style={{ backgroundColor: '#1E3A5F' }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>📊 Reporte de averías + inspección</Text>
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                  <View><Text style={{ color: '#CFE0F5', fontSize: 11 }}>Total averías</Text><Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>{grandAverias}</Text></View>
                  <View><Text style={{ color: '#CFE0F5', fontSize: 11 }}>Gasto total</Text><Text style={{ color: '#7CF5B0', fontWeight: '900', fontSize: 18 }}>{usd(grandGasto)}</Text></View>
                </View>
                <Text style={{ color: '#9FB6D4', fontSize: 10, marginTop: 4 }}>El gasto = materiales que salieron del almacén para cada equipo × su costo.</Text>
              </Card>

              {/* Filtro por CASO (los 3 estados) con su conteo */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {([['all', `Todos (${byClas.length})`, colors.primary], ['con', `🔧🔍 Avería + insp. (${casoCount.con})`, '#B45309'], ['sin_insp', `🔧 Avería sin insp. (${casoCount.sin_insp})`, colors.danger], ['sin_averia', `🔍 Insp. sin avería (${casoCount.sin_averia})`, '#2563EB']] as const).map(([k, label, col]) => {
                    const on = repCaseFilter === k;
                    return (
                      <TouchableOpacity key={k} onPress={() => setRepCaseFilter(k)} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? col : colors.border, backgroundColor: on ? col : colors.surfaceAlt }}>
                        <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Agrupador */}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                {([['equipo', '🚜 Equipo'], ['empresa', '🏢 Empresa'], ['tipo', '🏷️ Tipo']] as const).map(([k, label]) => {
                  const on = repGroupBy === k;
                  return (
                    <TouchableOpacity key={k} onPress={() => setRepGroupBy(k)} style={{ flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Filtro por tipo de maquinaria (clasificación) */}
              {clasValues.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {['__all__', ...clasValues].map((c) => {
                      const on = repClasFilter === c;
                      return (
                        <TouchableOpacity key={c} onPress={() => setRepClasFilter(c)} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                          <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c === '__all__' ? 'Todos' : c}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : null}

              {/* Exportar PDF */}
              <TouchableOpacity onPress={() => exportReportePdf()} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📄 Exportar reporte (PDF)</Text>
              </TouchableOpacity>

              {reportLoading ? <View style={{ paddingVertical: spacing.md }}><Loading /></View> : null}

              {/* Gráfico de barras: quién genera más averías */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs }}>Ranking por nº de averías{repGroupBy === 'equipo' ? ' · toca un equipo para ver el detalle' : ''}:</Text>
              {rows.length === 0 ? (
                <EmptyState title="Sin equipos en este filtro" subtitle="Prueba con otro caso o quita el filtro por tipo." />
              ) : null}
              {rows.map((r, i) => {
                const pct = Math.max(0.06, r.total / maxTotal);
                const badge = r.caso ? CASO_BADGE[r.caso] : null;
                const barColor = r.caso === 'sin_averia' ? '#2563EB' : colors.warning;
                return (
                  <TouchableOpacity key={r.key} activeOpacity={r.onPress ? 0.7 : 1} onPress={r.onPress} style={{ marginBottom: spacing.sm }}>
                    <Card>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{i + 1}. {r.title}{r.onPress ? '  ›' : ''}</Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{r.sub}</Text>
                          {badge ? <Text style={{ color: badge.color, fontSize: 11, fontWeight: '800', marginTop: 2 }}>{badge.label}</Text> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 16 }}>{r.total}</Text>
                          <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>{usd(r.gasto)}</Text>
                        </View>
                      </View>
                      <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, marginTop: spacing.xs, overflow: 'hidden' }}>
                        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: barColor, borderRadius: 4 }} />
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: spacing.lg }} />
            </View>
          );
        })()
      )}

      {/* Modal: selector de máquina para enviar a reparación */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '85%' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.sm }}>Elige la máquina a reparar</Text>
            <TextInput value={pickerQ} onChangeText={setPickerQ} placeholder="🔎 Buscar máquina o empresa…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
            <ScrollView>
              {pickerList.map((m) => {
                const inRep = activeRepairByMachine.has(m.id);
                return (
                  <TouchableOpacity key={m.id} onPress={() => !inRep && openRepair(m)} disabled={inRep} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface, opacity: inRep ? 0.5 : 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{m.code}{inRep ? '  · ya en reparación' : ''}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{m.company}{m.operational ? '' : ' · No operativa'}</Text>
                  </TouchableOpacity>
                );
              })}
              {pickerList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre." /> : null}
            </ScrollView>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: enviar a reparación */}
      <Modal visible={!!repFor} transparent animationType="slide" onRequestClose={() => setRepFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {repFor ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>🔧 Enviar a reparación</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{repFor.code} · {repFor.company}</Text>

                <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                  {(['correctivo', 'preventivo'] as const).map((t) => (
                    <TouchableOpacity key={t} onPress={() => setRTipo(t)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: rTipo === t ? colors.primary : colors.border, backgroundColor: rTipo === t ? colors.primary : colors.surface }}>
                      <Text style={{ color: rTipo === t ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{t === 'correctivo' ? '🔧 Correctivo' : '🩺 Preventivo'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Fecha de salida a reparación</Text>
                <DateField value={rOut} onChange={setROut} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Por cuánto tiempo? (días estimados)</Text>
                <TextInput value={rDays} onChangeText={(t) => setRDays(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Ej. 5" placeholderTextColor={colors.muted} style={input} />
                <TextInput value={rNote} onChangeText={setRNote} placeholder="Detalle del tiempo (opcional, ej. 'espera de repuesto')" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.xs }} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué se le va a cambiar? (opcional, se puede llenar al volver)</Text>
                <TextInput value={rWork} onChangeText={setRWork} placeholder="Ej. cambio de bomba hidráulica…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 60 }} />

                <Text style={{ color: colors.warning, fontSize: 11, marginTop: spacing.sm }}>⚠️ Al enviar, la máquina queda marcada como “No operativa” en todo el sistema.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setRepFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={enviarReparacion} disabled={busy === 'rep'} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#B45309', opacity: busy === 'rep' ? 0.7 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === 'rep' ? 'Guardando…' : '🔧 Enviar a reparación'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: detalle de la avería (datos de la máquina + la falla + foto) */}
      <Modal visible={!!detailReq} transparent animationType="slide" onRequestClose={() => setDetailReq(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {detailReq ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{MAT_ICON[detailReq.material] ?? '🔧'} {detailReq.code}</Text>
                <Text style={{ color: detailReq.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 12, marginTop: 2 }}>{detailReq.operational ? '● Operativa' : '● No operativa'}</Text>

                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>🚜 Datos de la máquina</Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 3 }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.company}</Text></Text>
                  {detailReq.tipo ? <Text style={{ color: colors.muted, fontSize: 13 }}>🔧 Tipo: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.tipo}</Text></Text> : null}
                  {detailReq.plate ? <Text style={{ color: colors.muted, fontSize: 13 }}>🔖 Placa: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.plate}</Text></Text> : null}
                  {detailReq.serial ? <Text style={{ color: colors.muted, fontSize: 13 }}>#️⃣ Serial: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.serial}</Text></Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>📍 Ubicación: <Text style={{ color: colors.text, fontWeight: '700' }}>{coordText(detailReq.latitude, detailReq.longitude) || '—'}</Text></Text>
                  {detailReq.referencia ? <Text style={{ color: colors.muted, fontSize: 13 }}>🧭 Referencia: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.referencia}</Text></Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>🏢 Edificio / sector: <Text style={{ color: colors.text, fontWeight: '700' }}>{edificioText(detailReq.latitude, detailReq.longitude, detailReq.referencia)}</Text></Text>
                  {detailReq.last_horometro != null ? <Text style={{ color: colors.muted, fontSize: 13 }}>⏱️ Último horómetro: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.last_horometro}</Text></Text> : null}
                </View>

                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>🛠️ La falla</Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 3 }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Necesita: <Text style={{ color: colors.text, fontWeight: '700' }}>{matLabel(detailReq.material)}{detailReq.quantity != null ? ` · ${detailReq.quantity.toLocaleString()}` : ''}</Text></Text>
                  {detailReq.notes ? <Text style={{ color: colors.muted, fontSize: 13 }}>Nota: <Text style={{ color: colors.text }}>{detailReq.notes}</Text></Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>👮 Reportó: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.requestedByName || '—'}</Text></Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Reportada: {fmtDT(detailReq.created_at)}</Text>
                </View>

                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>📷 Foto de referencia</Text>
                {detailReq.photo_url ? (
                  <Image source={{ uri: detailReq.photo_url }} style={{ width: '100%', height: 240, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Sin foto de referencia.</Text>
                )}

                <TouchableOpacity onPress={() => setDetailReq(null)} style={{ marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                </TouchableOpacity>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: registrar retorno operativo */}
      <Modal visible={!!retFor} transparent animationType="slide" onRequestClose={() => setRetFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {retFor ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>✓ Retorno operativo</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{retFor.code} · salió el {fmtDMY(retFor.out_at)}</Text>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>¿Cuándo volvió operativa?</Text>
                <DateField value={retBack} onChange={setRetBack} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué se le cambió / reparó?</Text>
                <TextInput value={retWork} onChangeText={setRetWork} placeholder="Ej. se cambió la bomba hidráulica y filtros…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 70 }} />

                <Text style={{ color: colors.success, fontSize: 11, marginTop: spacing.sm }}>✓ Al registrar, la máquina vuelve a “Operativa” en todo el sistema.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setRetFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={registrarRetorno} disabled={busy === 'ret'} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success, opacity: busy === 'ret' ? 0.7 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === 'ret' ? 'Guardando…' : '✓ Marcar operativa'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Escáner de máquina para reportar una avería */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setScanOpen(false)} onDetected={onScanDetected} />
        </View>
      </Modal>

      {/* Formulario de AVERÍA (máquina escaneada) */}
      <Modal visible={!!avMachine} transparent animationType="fade" onRequestClose={() => setAvMachine(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%' }}>
            {avMachine ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>🛠️ Avería · {avMachine.code}</Text>
                {avMachine.plate ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>Placa: {avMachine.plate}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>¿Qué necesita?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {AV_MATERIALS.map((mt) => {
                    const on = avMaterial === mt.key;
                    return (
                      <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text>{mt.icon}</Text>
                        <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{mt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {avMaterial === 'otro' ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>¿Qué falla presenta? (describe la avería)</Text>
                    <TextInput value={avNote} onChangeText={setAvNote} placeholder="Ej. no arranca, fuga de aceite…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 64 }} />
                  </>
                ) : avMaterial ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Cantidad (opcional)</Text>
                    <TextInput value={avQty} onChangeText={(t) => setAvQty(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Ej: 2" placeholderTextColor={colors.muted} style={input} />
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Nota (opcional)</Text>
                    <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle de la falla" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 60 }} />
                  </>
                ) : null}

                {avMaterial ? (
                  <TouchableOpacity onPress={subirFotoAveria} disabled={avPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: avPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: avPhoto ? colors.success : colors.text, fontWeight: '700' }}>{avPhotoUp ? 'Subiendo…' : avPhoto ? '✓ Foto de referencia adjunta' : '📷 Foto de referencia (opcional)'}</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setAvMachine(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={registrarAveria} disabled={avBusy || !avMaterial} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#B45309', opacity: (avBusy || !avMaterial) ? 0.5 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '900' }}>{avBusy ? 'Guardando…' : 'Registrar avería'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.md }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: DETALLE de averías de un equipo (desde el dashboard) */}
      <Modal visible={!!repDetailId} transparent animationType="fade" onRequestClose={() => setRepDetailId(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%' }}>
            {repDetailId ? (() => {
              // El equipo puede venir de las averías o SOLO de inspección (sin avería).
              const sStat = machineStats.find((x) => x.id === repDetailId);
              const mac = machines.find((m) => m.id === repDetailId);
              const s = sStat ?? (mac ? { id: mac.id, code: mac.code, company: mac.company, plate: mac.plate, serial: mac.serial, clasificacion: mac.clasificacion, total: 0, byMat: {} as Record<string, number> } : null);
              if (!s) return null;
              const list = reqs.filter((r) => r.machinery_id === repDetailId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
              const gasto = gastoByMachine[repDetailId] ?? 0;
              const ident = [s.plate, s.serial].filter(Boolean).join(' · ');
              const matEntries = Object.entries(s.byMat).sort((a, b) => b[1] - a[1]);
              return (
                <ScrollView>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>🚜 {s.code}</Text>
                  <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginTop: spacing.sm, gap: 3 }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '700' }}>{s.company}</Text></Text>
                    {s.clasificacion ? <Text style={{ color: colors.muted, fontSize: 13 }}>🏷️ Tipo: <Text style={{ color: colors.text, fontWeight: '700' }}>{s.clasificacion}</Text></Text> : null}
                    {ident ? <Text style={{ color: colors.muted, fontSize: 13 }}>🔖 Placa / Serial: <Text style={{ color: colors.text, fontWeight: '700' }}>{ident}</Text></Text> : null}
                  </View>

                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Total averías</Text>
                      <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 20 }}>{s.total}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Gasto generado</Text>
                      <Text style={{ color: colors.success, fontWeight: '900', fontSize: 20 }}>{usd(gasto)}</Text>
                    </View>
                  </View>

                  {matEntries.length ? (
                    <>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>Desglose por tipo</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                        {matEntries.map(([mat, n]) => (
                          <View key={mat} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                            <Text>{MAT_ICON[mat] ?? '🔧'}</Text>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{matLabel(mat)}: {n}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>Averías (con fecha)</Text>
                  {list.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Sin averías reportadas. Este equipo solo tiene inspección. 🔍</Text>
                  ) : null}
                  {list.map((r) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Text style={{ fontSize: 20 }}>{MAT_ICON[r.material] ?? '🔧'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{matLabel(r.material)}{r.quantity != null ? ` · ${r.quantity.toLocaleString()}` : ''}{r.status === 'realizado' ? '  ✓' : ''}</Text>
                        {r.notes ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{r.notes}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtDT(r.created_at)}</Text>
                      </View>
                    </View>
                  ))}

                  {/* Cruce con INSPECCIÓN DE MAQUINARIA: qué observó la última inspección del equipo. */}
                  {(() => {
                    const insps = inspByMachine[repDetailId] ?? [];
                    return (
                      <>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>🔍 Inspección de maquinaria{insps.length ? ` (${insps.length})` : ''}</Text>
                        {insps.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 12 }}>Sin inspecciones registradas para este equipo.</Text>
                        ) : (() => {
                          const last = insps[0];
                          const flagged = (last.items ?? []).filter((it: any) => it.nivel === 'warn' || it.nivel === 'bad');
                          return (
                            <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 3 }}>
                              <Text style={{ color: colors.muted, fontSize: 13 }}>📅 Última: <Text style={{ color: colors.text, fontWeight: '700' }}>{fmtDMY(last.inspected_at)}</Text>{last.inspector_name ? <Text style={{ color: colors.text }}>  ·  🪖 {last.inspector_name}</Text> : null}</Text>
                              {last.condicion_general ? <Text style={{ color: colors.muted, fontSize: 13 }}>Condición general: <Text style={{ color: colors.text, fontWeight: '700' }}>{last.condicion_general}</Text></Text> : null}
                              {flagged.length ? (
                                <View style={{ marginTop: 2 }}>
                                  <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>⚠️ Puntos observados en la inspección ({flagged.length}):</Text>
                                  {flagged.map((it: any, i: number) => (
                                    <Text key={i} style={{ color: colors.text, fontSize: 12, marginTop: 1 }}>{it.nivel === 'bad' ? '🔴' : '🟠'} {it.descripcion}{it.estado ? <Text style={{ color: colors.muted }}> · {it.estado}</Text> : null}</Text>
                                  ))}
                                </View>
                              ) : (
                                <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 2 }}>✓ Sin puntos observados en la última inspección.</Text>
                              )}
                            </View>
                          );
                        })()}
                      </>
                    );
                  })()}

                  <TouchableOpacity onPress={() => setRepDetailId(null)} style={{ marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                  </TouchableOpacity>
                  <View style={{ height: spacing.md }} />
                </ScrollView>
              );
            })() : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
