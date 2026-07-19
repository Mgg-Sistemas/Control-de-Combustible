import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase, selectAllRows } from '../lib/supabase';
import { caracasParts } from '../lib/jornada';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { norm } from '../lib/text';
import { Company, Employee, UniformDelivery } from '../types/database';
import { useAuth } from '../context/AuthContext';
import { useTable } from '../hooks/useTable';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const fullName = (e: Employee) => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Sin nombre';
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
// Fecha y hora (Caracas) de un instante ISO, para las entregas de uniforme.
const fmtFechaHora = (ts: string) => new Date(ts).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
type DelTotals = { camisas: number; pantalones: number; zapatos: number };
const sumDeliveries = (list: Pick<UniformDelivery, 'camisas' | 'pantalones' | 'zapatos'>[]): DelTotals =>
  list.reduce((a, d) => ({ camisas: a.camisas + (Number(d.camisas) || 0), pantalones: a.pantalones + (Number(d.pantalones) || 0), zapatos: a.zapatos + (Number(d.zapatos) || 0) }), { camisas: 0, pantalones: 0, zapatos: 0 });
const hasDel = (t: DelTotals) => t.camisas > 0 || t.pantalones > 0 || t.zapatos > 0;

// ── Conteo por talla (para el resumen "tantas camisas M, tantas S…") ──────────
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL'];
const normSize = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase();
/** Clave de orden: primero tallas de letra (XS→4XL), luego numéricas ascendentes, luego el resto. */
const sizeKey = (s: string): number => {
  const i = SIZE_ORDER.indexOf(s);
  if (i >= 0) return i;
  const n = Number(s.replace(',', '.'));
  if (isFinite(n)) return 100 + n;
  return 1000;
};
type SizeCount = { size: string; count: number };
/** Cuenta cuántas personas tienen cada talla de una prenda (ignora vacías). */
const tallyBy = (list: Employee[], get: (e: Employee) => string | null | undefined): { rows: SizeCount[]; total: number } => {
  const m = new Map<string, number>();
  list.forEach((e) => { const s = normSize(get(e)); if (s) m.set(s, (m.get(s) ?? 0) + 1); });
  const rows = Array.from(m.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => sizeKey(a.size) - sizeKey(b.size) || a.size.localeCompare(b.size, 'es'));
  return { rows, total: rows.reduce((s, r) => s + r.count, 0) };
};

export default function UniformesScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { data: employees, loading, refetch } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Sin empresa' : 'Sin empresa');

  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  // Editor de tallas de una persona.
  const [sel, setSel] = useState<Employee | null>(null);
  const [camisa, setCamisa] = useState('');
  const [pantalon, setPantalon] = useState('');
  const [zapatos, setZapatos] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Entregas de uniforme (cantidades entregadas, con fecha/hora) ─────────────
  const [deliveries, setDeliveries] = useState<UniformDelivery[]>([]);
  const [dCam, setDCam] = useState('');   // entrega en curso: camisas
  const [dPan, setDPan] = useState('');   // pantalones
  const [dZap, setDZap] = useState('');   // zapatos
  const [busyDel, setBusyDel] = useState(false);

  const loadDeliveries = async () => {
    const rows = await selectAllRows('uniform_deliveries', 'id, employee_id, camisas, pantalones, zapatos, delivered_at, work_date, note, recorded_by, created_at');
    setDeliveries((rows ?? []) as UniformDelivery[]);
  };
  useEffect(() => { loadDeliveries(); }, []);

  // Totales entregados por empleado (para el badge de cada tarjeta).
  const totalsByEmp = useMemo(() => {
    const m = new Map<string, DelTotals>();
    deliveries.forEach((d) => {
      const a = m.get(d.employee_id) ?? { camisas: 0, pantalones: 0, zapatos: 0 };
      a.camisas += Number(d.camisas) || 0; a.pantalones += Number(d.pantalones) || 0; a.zapatos += Number(d.zapatos) || 0;
      m.set(d.employee_id, a);
    });
    return m;
  }, [deliveries]);
  const empDeliveries = (id: string) => deliveries.filter((d) => d.employee_id === id).sort((a, b) => b.delivered_at.localeCompare(a.delivered_at));

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const openEmp = (e: Employee) => {
    setSel(e);
    setCamisa(e.talla_camisa ?? '');
    setPantalon(e.talla_pantalon ?? '');
    setZapatos(e.talla_zapatos ?? '');
    setDCam(''); setDPan(''); setDZap('');
  };

  // Registra una ENTREGA (cantidades) al empleado abierto, con fecha y hora automáticas.
  const registrarEntrega = async () => {
    if (!sel) return;
    const c = Math.max(0, Math.floor(Number(dCam) || 0));
    const p = Math.max(0, Math.floor(Number(dPan) || 0));
    const z = Math.max(0, Math.floor(Number(dZap) || 0));
    if (c + p + z <= 0) { Alert.alert('Aviso', 'Escribe al menos una cantidad (camisas, pantalones o zapatos).'); return; }
    setBusyDel(true);
    const now = new Date();
    const { error } = await supabase.from('uniform_deliveries').insert({
      employee_id: sel.id, camisas: c, pantalones: p, zapatos: z,
      delivered_at: now.toISOString(), work_date: caracasParts(now).iso, recorded_by: session?.user?.id ?? null,
    });
    setBusyDel(false);
    if (error) { Alert.alert('Aviso', error.message); return; }
    setDCam(''); setDPan(''); setDZap('');
    await loadDeliveries();
  };
  const guardar = async () => {
    if (!sel) return;
    setSaving(true);
    const patch = { talla_camisa: camisa.trim() || null, talla_pantalon: pantalon.trim() || null, talla_zapatos: zapatos.trim() || null };
    const { error } = await supabase.from('employees').update(patch).eq('id', sel.id);
    setSaving(false);
    if (error) return Alert.alert('Aviso', error.message);
    setSel(null);
    refetch();
  };

  const nq = norm(q);
  const filtered = useMemo(() => {
    let list = employees.slice();
    if (onlyActive) list = list.filter((e) => e.status === 'activo');
    if (nq) list = list.filter((e) => norm(`${fullName(e)} ${e.cedula ?? ''} ${e.cargo ?? ''}`).includes(nq));
    return list.sort((a, b) => companyName(a.company_id).localeCompare(companyName(b.company_id), 'es') || fullName(a).localeCompare(fullName(b), 'es'));
  }, [employees, onlyActive, nq, companies]);

  // Agrupa por empresa (para la vista en pantalla).
  const byCompany = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: Employee[] }>();
    filtered.forEach((e) => {
      const k = e.company_id ?? '__none__';
      const g = m.get(k) ?? { key: k, name: companyName(e.company_id), items: [] };
      g.items.push(e);
      m.set(k, g);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [filtered, companies]);

  // Resumen de totales por talla del listado filtrado (camisas / pantalones / botas).
  const resumen = useMemo(() => ({
    camisa: tallyBy(filtered, (e) => e.talla_camisa),
    pantalon: tallyBy(filtered, (e) => e.talla_pantalon),
    zapatos: tallyBy(filtered, (e) => e.talla_zapatos),
  }), [filtered]);

  const sizeChip = (label: string, value: string | null) => (
    <View style={{ backgroundColor: value ? colors.surfaceAlt : 'transparent', borderWidth: 1, borderColor: value ? colors.border : 'transparent', borderRadius: radius.pill, paddingHorizontal: value ? spacing.sm : 0, paddingVertical: value ? 2 : 0 }}>
      <Text style={{ color: value ? colors.text : colors.muted, fontSize: 11, fontWeight: '700' }}>{label}: {value || '—'}</Text>
    </View>
  );

  // ── Imprimir el listado con tallas y firma (Recibido / Entregado) ────────────
  const imprimir = async () => {
    if (filtered.length === 0) return Alert.alert('Aviso', 'No hay empleados para imprimir.');
    const rows = filtered.map((e, i) =>
      `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fullName(e))}</td>
        <td>${esc(companyName(e.company_id))}</td>
        <td>${esc(e.cargo ?? '—')}</td>
        <td>${esc(e.cedula ?? '—')}</td>
        <td class="c b">${esc(e.talla_camisa ?? '—')}</td>
        <td class="c b">${esc(e.talla_pantalon ?? '—')}</td>
        <td class="c b">${esc(e.talla_zapatos ?? '—')}</td>
        <td class="firma"></td>
      </tr>`).join('');
    // Resumen por tallas: "tantas camisas M, tantas S…", igual para pantalón y botas.
    const resumenCard = (titulo: string, t: { rows: SizeCount[]; total: number }) => {
      const items = t.rows.length
        ? t.rows.map((r) => `<span class="pill"><b>${esc(r.size)}</b> ${r.count}</span>`).join('')
        : '<span class="none">Sin tallas cargadas</span>';
      const sinTalla = filtered.length - t.total;
      return `<div class="rbox">
        <div class="rh">${titulo}</div>
        <div class="pills">${items}</div>
        <div class="rt">Con talla: <b>${t.total}</b>${sinTalla > 0 ? ` · Sin talla: ${sinTalla}` : ''}</div>
      </div>`;
    };
    const resumenHtml = `
      <h3 class="rtitle">Resumen por tallas (${filtered.length} persona(s))</h3>
      <div class="rgrid">
        ${resumenCard('👕 Camisas', resumen.camisa)}
        ${resumenCard('👖 Pantalones', resumen.pantalon)}
        ${resumenCard('👟 Botas de seguridad', resumen.zapatos)}
      </div>`;
    const html = pdfDocument({
      title: 'Distribución de uniformes',
      subtitle: `Listado de empleados con tallas · ${filtered.length} persona(s) · ${todayDMY()}`,
      extraCss: `
        table{width:100%;border-collapse:collapse;margin-top:10px;font-size:10.5pt}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left}
        th{background:#16324F;color:#fff}
        td.c{text-align:center} td.b{font-weight:800}
        td.firma{min-width:150px;height:34px}
        tr:nth-child(even) td{background:#f4f7fb}
        .foot{margin-top:16px;color:#555;font-size:9pt}
        .rtitle{margin:22px 0 8px;color:#16324F;font-size:13pt;border-top:2px solid #16324F;padding-top:12px}
        .rgrid{display:flex;gap:12px;flex-wrap:wrap}
        .rbox{flex:1;min-width:200px;border:1px solid #c9d2dc;border-radius:8px;padding:10px 12px}
        .rh{font-weight:800;color:#16324F;margin-bottom:8px;font-size:11pt}
        .pills{display:flex;gap:6px;flex-wrap:wrap}
        .pill{background:#eef3fa;border:1px solid #c9d2dc;border-radius:12px;padding:3px 9px;font-size:10pt}
        .pill b{color:#16324F}
        .none{color:#888;font-size:9.5pt}
        .rt{margin-top:8px;color:#555;font-size:9pt}`,
      body: `
        <table>
          <thead><tr>
            <th style="width:30px" class="c">#</th><th>Empleado</th><th>Empresa</th><th>Cargo</th><th>Cédula</th>
            <th class="c">Camisa</th><th class="c">Pantalón</th><th class="c">Zapatos</th>
            <th style="min-width:150px">Firma (Recibido / Entregado)</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="foot">Cada firma confirma la ENTREGA y el RECIBO del uniforme por parte del empleado.</div>
        ${resumenHtml}`,
    });
    await exportPdf(html, `Distribucion de uniformes - ${todayDMY()}`);
  };

  // ── Reporte de ENTREGAS: por persona, cada entrega con su fecha y hora + totales ──
  const reporteEntregas = async () => {
    const shownIds = new Set(filtered.map((e) => e.id));
    const groups = filtered
      .map((e) => ({ e, dels: empDeliveries(e.id) }))
      .filter((g) => shownIds.has(g.e.id) && g.dels.length > 0);
    if (groups.length === 0) { Alert.alert('Aviso', 'No hay entregas registradas para los empleados mostrados.'); return; }
    const grand = sumDeliveries(groups.flatMap((g) => g.dels));
    const bodies = groups.map(({ e, dels }) => {
      const t = sumDeliveries(dels);
      const trs = dels.slice().sort((a, b) => a.delivered_at.localeCompare(b.delivered_at)).map((d) =>
        `<tr><td>${esc(fmtFechaHora(d.delivered_at))}</td><td class="c b">${d.camisas}</td><td class="c b">${d.pantalones}</td><td class="c b">${d.zapatos}</td></tr>`).join('');
      return `<h3 class="emp">${esc(fullName(e))} <span class="sub">· ${esc(companyName(e.company_id))}${e.cargo ? ` · ${esc(e.cargo)}` : ''}${e.cedula ? ` · C.I ${esc(e.cedula)}` : ''}</span></h3>
        <table><thead><tr><th>Fecha y hora de entrega</th><th class="c">👕 Camisas</th><th class="c">👖 Pantalones</th><th class="c">👟 Zapatos</th></tr></thead>
        <tbody>${trs}</tbody>
        <tfoot><tr><td style="text-align:right">Total entregado</td><td class="c">${t.camisas}</td><td class="c">${t.pantalones}</td><td class="c">${t.zapatos}</td></tr></tfoot></table>`;
    }).join('');
    const html = pdfDocument({
      title: 'Entregas de uniforme',
      subtitle: `${groups.length} persona(s) · Totales: 👕 ${grand.camisas} · 👖 ${grand.pantalones} · 👟 ${grand.zapatos} · ${todayDMY()}`,
      extraCss: `h3.emp{margin:16px 0 4px;font-size:12.5pt;color:#16324F} h3.emp .sub{font-weight:400;color:#555;font-size:10pt}
        table{width:100%;border-collapse:collapse;font-size:10.5pt;margin-bottom:6px}
        th,td{border:1px solid #c9d2dc;padding:5px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} td.b{font-weight:800}
        tfoot td{background:#eef3fa;font-weight:800}`,
      body: bodies,
    });
    await exportPdf(html, `Entregas de uniforme - ${todayDMY()}`);
  };

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Distribución de uniformes</SectionTitle>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <TouchableOpacity onPress={reporteEntregas} style={{ backgroundColor: '#0F766E', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📦 Reporte de entregas</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={imprimir} style={{ backgroundColor: '#111827', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>⬇️ Listado (tallas)</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Toca un empleado para cargar sus tallas y para 📦 registrar cuántas camisas, pantalones y zapatos se le entregan (con fecha y hora). "📦 Reporte de entregas" saca el PDF de lo entregado; "Listado (tallas)" imprime el listado con firma.
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {[{ k: true, label: 'Activos' }, { k: false, label: 'Todos' }].map((o) => {
          const on = onlyActive === o.k;
          return (
            <TouchableOpacity key={o.label} onPress={() => setOnlyActive(o.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por nombre, cédula o cargo…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

      {loading && employees.length === 0 ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState title="Sin empleados" subtitle={q ? 'Prueba con otra búsqueda.' : 'No hay empleados para mostrar.'} />
      ) : (
        byCompany.map((g) => (
          <View key={g.key} style={{ marginBottom: spacing.sm }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>🏢 {g.name} <Text style={{ color: colors.muted, fontSize: 12 }}>({g.items.length})</Text></Text>
            {g.items.map((e) => (
              <TouchableOpacity key={e.id} activeOpacity={0.7} onPress={() => openEmp(e)}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fullName(e)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{[e.cargo, e.cedula ? `C.I ${e.cedula}` : ''].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>✎</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs }}>
                    {sizeChip('👕 Camisa', e.talla_camisa)}
                    {sizeChip('👖 Pantalón', e.talla_pantalon)}
                    {sizeChip('👟 Zapatos', e.talla_zapatos)}
                  </View>
                  {(() => { const t = totalsByEmp.get(e.id); return t && hasDel(t) ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: colors.success, fontSize: 11, fontWeight: '800' }}>📦 Entregado:</Text>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>👕 {t.camisas} · 👖 {t.pantalones} · 👟 {t.zapatos}</Text>
                    </View>
                  ) : null; })()}
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        ))
      )}

      {/* Resumen por tallas (al final): cuántas camisas M, cuántas S, etc. */}
      {filtered.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.xs }}>📊 Resumen por tallas <Text style={{ color: colors.muted, fontSize: 12 }}>({filtered.length} persona(s))</Text></Text>
          {([
            { label: '👕 Camisas', t: resumen.camisa },
            { label: '👖 Pantalones', t: resumen.pantalon },
            { label: '👟 Botas de seguridad', t: resumen.zapatos },
          ] as const).map((g) => {
            const sinTalla = filtered.length - g.t.total;
            return (
              <View key={g.label} style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>{g.label}</Text>
                {g.t.rows.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {g.t.rows.map((r) => (
                      <View key={r.size} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{r.size}: <Text style={{ color: colors.primary }}>{r.count}</Text></Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Sin tallas cargadas.</Text>
                )}
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Con talla: {g.t.total}{sinTalla > 0 ? ` · Sin talla: ${sinTalla}` : ''}</Text>
              </View>
            );
          })}
        </Card>
      ) : null}

      <View style={{ height: spacing.lg }} />

      {/* Modal: editar tallas */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            {sel ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{fullName(sel)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>{[companyName(sel.company_id), sel.cargo, sel.cedula ? `C.I ${sel.cedula}` : ''].filter(Boolean).join(' · ')}</Text>

                <Text style={{ color: colors.muted, fontSize: 12 }}>👕 Talla de camisa</Text>
                <TextInput value={camisa} onChangeText={(t) => setCamisa(t.toUpperCase())} autoCapitalize="characters" placeholder="Ej. M, L, XL, 38…" placeholderTextColor={colors.muted} style={input} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>👖 Talla de pantalón</Text>
                <TextInput value={pantalon} onChangeText={(t) => setPantalon(t.toUpperCase())} autoCapitalize="characters" placeholder="Ej. 32, 34, M…" placeholderTextColor={colors.muted} style={input} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>👟 Talla de zapatos</Text>
                <TextInput value={zapatos} onChangeText={(t) => setZapatos(t.toUpperCase())} autoCapitalize="characters" placeholder="Ej. 40, 42…" placeholderTextColor={colors.muted} style={input} />

                {/* ── Entregas: cuántas prendas se le han entregado (con fecha y hora) ── */}
                <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📦 Registrar entrega</Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Escribe cuántas prendas le entregas ahora. La fecha y la hora se guardan solas.</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {([['👕', dCam, setDCam], ['👖', dPan, setDPan], ['👟', dZap, setDZap]] as const).map(([icon, val, set], i) => (
                      <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ fontSize: 16 }}>{icon}</Text>
                        <TextInput value={val} onChangeText={(t) => set(t.replace(/[^0-9]/g, ''))} keyboardType="numeric" inputMode="numeric" placeholder="0" placeholderTextColor={colors.muted} style={{ ...input, width: '100%', textAlign: 'center', marginTop: 2 }} />
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity onPress={registrarEntrega} disabled={busyDel} style={{ marginTop: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busyDel ? 0.7 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{busyDel ? 'Guardando…' : '📦 Registrar entrega'}</Text>
                  </TouchableOpacity>

                  {(() => {
                    const dels = empDeliveries(sel.id); const tot = sumDeliveries(dels);
                    return (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>Total entregado: 👕 {tot.camisas} · 👖 {tot.pantalones} · 👟 {tot.zapatos}</Text>
                        {dels.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Aún no hay entregas registradas.</Text>
                        ) : dels.map((d) => (
                          <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>🕒 {fmtFechaHora(d.delivered_at)}</Text>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>👕 {d.camisas} · 👖 {d.pantalones} · 👟 {d.zapatos}</Text>
                          </View>
                        ))}
                      </View>
                    );
                  })()}
                </View>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setSel(null)}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }} onPress={guardar} disabled={saving}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.md }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
