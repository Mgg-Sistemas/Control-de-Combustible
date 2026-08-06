import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, ExpandableCard } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase, selectAllRows } from '../lib/supabase';
import { caracasParts } from '../lib/jornada';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { norm, cmpText } from '../lib/text';
import { Company, Employee, UniformDelivery, InventoryMovement, InventoryTransfer, InventoryItem } from '../types/database';
import { useAuth } from '../context/AuthContext';
import { useTable } from '../hooks/useTable';
import { levelMeets } from '../lib/permissions';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../components/ToastProvider';

const fullName = (e: Employee) => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Sin nombre';
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const todayDMY = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
// Etiqueta pequeña con borde de color (mismo patrón visual que en Inventario/Movimientos).
function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}
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

// ── Pestaña "Dotación básica": tallas por empleado + entregas de uniforme (contenido
//    ORIGINAL de esta pantalla, sin cambios funcionales salvo el gating por canWrite). ──
function DotacionBasicaTab({ canWrite }: { canWrite: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
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
    if (!sel || !canWrite) return;
    const c = Math.max(0, Math.floor(Number(dCam) || 0));
    const p = Math.max(0, Math.floor(Number(dPan) || 0));
    const z = Math.max(0, Math.floor(Number(dZap) || 0));
    if (c + p + z <= 0) { toast.error('Escribe al menos una cantidad (camisas, pantalones o zapatos).'); return; }
    setBusyDel(true);
    const now = new Date();
    const { error } = await supabase.from('uniform_deliveries').insert({
      employee_id: sel.id, camisas: c, pantalones: p, zapatos: z,
      delivered_at: now.toISOString(), work_date: caracasParts(now).iso, recorded_by: session?.user?.id ?? null,
    });
    setBusyDel(false);
    if (error) { toast.error(error.message); return; }
    setDCam(''); setDPan(''); setDZap('');
    await loadDeliveries();
  };
  const guardar = async () => {
    if (!sel || !canWrite) return;
    setSaving(true);
    const patch = { talla_camisa: camisa.trim() || null, talla_pantalon: pantalon.trim() || null, talla_zapatos: zapatos.trim() || null };
    const { error } = await supabase.from('employees').update(patch).eq('id', sel.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    setSel(null);
    refetch();
  };

  const nq = norm(q);
  const filtered = useMemo(() => {
    let list = employees.slice();
    if (onlyActive) list = list.filter((e) => e.status === 'activo');
    if (nq) list = list.filter((e) => norm(`${fullName(e)} ${e.cedula ?? ''} ${e.cargo ?? ''}`).includes(nq));
    return list.sort((a, b) => cmpText(companyName(a.company_id), companyName(b.company_id)) || cmpText(fullName(a), fullName(b)));
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
    return Array.from(m.values()).sort((a, b) => cmpText(a.name, b.name));
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
    if (filtered.length === 0) return toast.error('No hay empleados para imprimir.');
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
    if (groups.length === 0) { toast.error('No hay entregas registradas para los empleados mostrados.'); return; }
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
          <TouchableOpacity onPress={reporteEntregas} style={{ backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>📦 Reporte de entregas</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={imprimir} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>⬇️ Listado (tallas)</Text>
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
            <TouchableOpacity key={o.label} onPress={() => setOnlyActive(o.k)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
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
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15, marginBottom: spacing.xs }}>🏢 {g.name} <Text style={{ color: colors.muted, fontSize: 12 }}>({g.items.length})</Text></Text>
            {g.items.map((e) => (
              <TouchableOpacity key={e.id} activeOpacity={0.7} onPress={() => openEmp(e)}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fullName(e)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{[e.cargo, e.cedula ? `C.I ${e.cedula}` : ''].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Text style={{ color: colors.brandText, fontWeight: '800' }}>✎</Text>
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
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{g.label}</Text>
                {g.t.rows.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {g.t.rows.map((r) => (
                      <View key={r.size} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{r.size}: <Text style={{ color: colors.brandText, fontVariant: ['tabular-nums'] as any }}>{r.count}</Text></Text>
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
                <TextInput value={camisa} onChangeText={(t) => setCamisa(t.toUpperCase())} editable={canWrite} autoCapitalize="characters" placeholder="Ej. M, L, XL, 38…" placeholderTextColor={colors.muted} style={{ ...input, opacity: canWrite ? 1 : 0.6 }} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>👖 Talla de pantalón</Text>
                <TextInput value={pantalon} onChangeText={(t) => setPantalon(t.toUpperCase())} editable={canWrite} autoCapitalize="characters" placeholder="Ej. 32, 34, M…" placeholderTextColor={colors.muted} style={{ ...input, opacity: canWrite ? 1 : 0.6 }} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>👟 Talla de zapatos</Text>
                <TextInput value={zapatos} onChangeText={(t) => setZapatos(t.toUpperCase())} editable={canWrite} autoCapitalize="characters" placeholder="Ej. 40, 42…" placeholderTextColor={colors.muted} style={{ ...input, opacity: canWrite ? 1 : 0.6 }} />

                {/* ── Entregas: cuántas prendas se le han entregado (con fecha y hora) ── */}
                <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📦 {canWrite ? 'Registrar entrega' : 'Entregas'}</Text>
                  {canWrite ? (
                    <>
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
                    </>
                  ) : null}

                  {(() => {
                    const dels = empDeliveries(sel.id); const tot = sumDeliveries(dels);
                    return (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>Total entregado: 👕 {tot.camisas} · 👖 {tot.pantalones} · 👟 {tot.zapatos}</Text>
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
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{canWrite ? 'Cancelar' : 'Cerrar'}</Text>
                  </TouchableOpacity>
                  {canWrite ? (
                    <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: saving ? 0.7 : 1 }} onPress={guardar} disabled={saving}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{saving ? 'Guardando…' : 'Guardar'}</Text>
                    </TouchableOpacity>
                  ) : null}
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

// ── Pestaña "Otras entregas / herramientas": SOLO LECTURA, se alimenta sola a partir de
//    las Salidas de Almacén (inventory_movements, kind='salida' con empleados asignados)
//    y los Traslados de Inventario dirigidos a un empleado (inventory_transfers con
//    to_employee_id). No tiene formularios de registro: para eso está Inventario. ──
type OtrasRow = {
  key: string;
  date: string;
  employeeId: string;
  employeeName: string;
  employeeCedula: string | null;
  employeeCargo: string | null;
  detalle: string;
  origen: 'salida' | 'traslado';
};

function OtrasEntregasTab() {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: movs, loading: loadingMovs, refetch: refetchMovs } = useTable<InventoryMovement>('inventory_movements', { orderBy: 'created_at', ascending: false, realtimeFrom: 'inventory_movements' });
  const { data: transfers, loading: loadingTr, refetch: refetchTr } = useTable<InventoryTransfer>('inventory_transfers', { orderBy: 'created_at', ascending: false, realtimeFrom: 'inventory_transfers' });
  const { data: items } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'first_name' });
  const loading = loadingMovs || loadingTr;

  const employeeById = useMemo(() => { const m = new Map<string, Employee>(); employees.forEach((e) => m.set(e.id, e)); return m; }, [employees]);
  const itemById = useMemo(() => { const m = new Map<string, InventoryItem>(); items.forEach((it) => m.set(it.id, it)); return m; }, [items]);

  // Combina ambas fuentes en un solo historial normalizado. Una salida grupal (varios
  // employee_ids en un mismo movimiento) genera UNA fila POR CADA empleado; un traslado
  // con varios renglones (items jsonb) genera UNA fila POR CADA renglón.
  const rows: OtrasRow[] = useMemo(() => {
    const out: OtrasRow[] = [];
    movs.forEach((m) => {
      if (m.kind !== 'salida') return;
      const ids = m.employee_ids ?? [];
      if (!ids.length) return;
      const it = itemById.get(m.item_id);
      const detalle = `${it?.name ?? 'Producto'} · ${qtyFmt(m.qty)} ${it?.unit ?? ''}`.trim();
      ids.forEach((empId) => {
        // Preferimos el snapshot guardado en el movimiento (nombre/cédula/cargo AL
        // MOMENTO de la salida); si viene vacío, caemos a los datos actuales del empleado.
        const snap = (m.employees_detail ?? []).find((e) => e.id === empId);
        const emp = employeeById.get(empId);
        out.push({
          key: `mov-${m.id}-${empId}`,
          date: m.created_at,
          employeeId: empId,
          employeeName: snap?.name || (emp ? fullName(emp) : 'Empleado'),
          employeeCedula: (snap?.cedula ?? emp?.cedula) ?? null,
          employeeCargo: (snap?.cargo ?? emp?.cargo) ?? null,
          detalle,
          origen: 'salida',
        });
      });
    });
    transfers.forEach((t) => {
      if (!t.to_employee_id) return;
      const lines = t.items ?? [];
      if (!lines.length) return;
      const emp = employeeById.get(t.to_employee_id);
      lines.forEach((line, i) => {
        out.push({
          key: `tr-${t.id}-${i}`,
          date: t.created_at,
          employeeId: t.to_employee_id as string,
          employeeName: t.to_employee_name || (emp ? fullName(emp) : 'Empleado'),
          employeeCedula: emp?.cedula ?? null,
          employeeCargo: emp?.cargo ?? null,
          detalle: `${line.name} · ${qtyFmt(line.qty)} ${line.unit ?? ''}`.trim(),
          origen: 'traslado',
        });
      });
    });
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [movs, transfers, itemById, employeeById]);

  // ── Filtros: por empleado y por rango de fecha ────────────────────────────────
  const [empFilterId, setEmpFilterId] = useState('');
  const [empOpen, setEmpOpen] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  const empFilterName = empFilterId ? (employeeById.get(empFilterId) ? fullName(employeeById.get(empFilterId)!) : '') : '';

  const shown = useMemo(() => rows.filter((r) => {
    if (empFilterId && r.employeeId !== empFilterId) return false;
    const d = String(r.date).slice(0, 10); // AAAA-MM-DD
    if (fFrom && d < fFrom) return false;
    if (fTo && d > fTo) return false;
    return true;
  }), [rows, empFilterId, fFrom, fTo]);
  const hayFiltro = !!(empFilterId || fFrom || fTo);

  // ── Reporte PDF de lo mostrado (respeta los filtros activos) ─────────────────
  const reporteOtras = async () => {
    if (shown.length === 0) { toast.error('No hay entregas para el reporte.'); return; }
    const sorted = [...shown].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const rowsHtml = sorted.map((r, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(fmtFechaHora(r.date))}</td>
        <td>${esc(r.employeeName)}</td>
        <td>${esc(r.employeeCedula || '—')}</td>
        <td>${esc(r.employeeCargo || '—')}</td>
        <td>${esc(r.detalle)}</td>
        <td>${esc(r.origen === 'traslado' ? 'Traslado' : 'Salida de almacén')}</td>
      </tr>`).join('');
    const html = pdfDocument({
      title: 'Otras entregas / herramientas',
      subtitle: `${shown.length} entrega(s) · ${todayDMY()}`,
      extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:10.5pt}
        th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
        td.c{text-align:center} tr:nth-child(even) td{background:#f4f7fb}`,
      body: `
        <table>
          <thead><tr><th style="width:30px" class="c">#</th><th style="width:150px">Fecha</th><th>Empleado</th><th>Cédula</th><th>Cargo</th><th>Detalle</th><th>Origen</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`,
    });
    await exportPdf(html, `Otras entregas - ${todayDMY()}`);
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen onRefresh={() => { refetchMovs(); refetchTr(); }} refreshing={loading}>
      <ConfigBanner />
      <SectionTitle>Otras entregas / herramientas</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Se alimenta sola, a partir de las Salidas de Almacén y los Traslados de Inventario dirigidos a un empleado (Inventario → Salida / Nota de traslado). Es de solo lectura: no tiene formulario de registro aquí.
      </Text>

      {/* Empleado: selector único (para filtrar), filtrable por nombre. */}
      <TouchableOpacity onPress={() => setEmpOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>👷 Empleado: <Text style={{ color: empFilterId ? colors.brandText : colors.muted }}>{empFilterId ? (empFilterName || 'Empleado') : 'Todos'}</Text></Text>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>{empOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {empOpen ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <TextInput value={empQuery} onChangeText={setEmpQuery} placeholder="Filtrar por nombre…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: 6 }} />
          <TouchableOpacity onPress={() => { setEmpFilterId(''); setEmpOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 15 }}>{!empFilterId ? '🔘' : '⚪'}</Text>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>Todos</Text>
          </TouchableOpacity>
          <View style={{ maxHeight: 220 }}>
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {employees.filter((e) => { const s = norm(empQuery); return !s || norm(fullName(e)).includes(s); }).map((e) => {
                const on = empFilterId === e.id;
                return (
                  <TouchableOpacity key={e.id} onPress={() => { setEmpFilterId(e.id); setEmpOpen(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 15 }}>{on ? '🔘' : '⚪'}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{fullName(e)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* Fecha: rango Desde/Hasta */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
          <DateField value={fFrom} onChange={(v) => setFFrom(v || '')} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
          <DateField value={fTo} onChange={(v) => setFTo(v || '')} />
        </View>
        {hayFiltro ? (
          <TouchableOpacity onPress={() => { setEmpFilterId(''); setEmpQuery(''); setFFrom(''); setFTo(''); }} style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {shown.length ? (
        <TouchableOpacity onPress={reporteOtras} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>🧾 Reporte ({shown.length})</Text>
        </TouchableOpacity>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState title="Sin entregas" subtitle="Las salidas de almacén y los traslados de inventario dirigidos a un empleado aparecerán aquí automáticamente." />
      ) : shown.map((r) => (
        <ExpandableCard
          key={r.key}
          summary={
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 14, color: colors.text }} numberOfLines={1}>{r.employeeName}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtFechaHora(r.date)}</Text>
                <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={2}>{r.detalle}</Text>
              </View>
              <Pill label={r.origen === 'traslado' ? '🔁 Traslado' : '📤 Salida'} color={r.origen === 'traslado' ? '#EA580C' : '#2563EB'} />
            </View>
          }
          detail={
            <>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Cédula: {r.employeeCedula || '—'}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Cargo: {r.employeeCargo || '—'}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Origen: {r.origen === 'traslado' ? 'Traslado de inventario' : 'Salida de almacén'}</Text>
            </>
          }
        />
      ))}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

// ── Contenedor con las 2 pestañas + gating de acceso al módulo 'uniformes' ────────
export default function UniformesScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const [active, setActive] = useState<'dotacion' | 'otras'>('dotacion');

  const level = moduleLevel('uniformes');
  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Distribución de uniformes</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  const TABS: { key: 'dotacion' | 'otras'; label: string; icon: string }[] = [
    { key: 'dotacion', label: 'Dotación básica', icon: '🧥' },
    { key: 'otras', label: 'Otras entregas / herramientas', icon: '🧰' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity key={t.key} onPress={() => setActive(t.key)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {active === 'dotacion' ? <DotacionBasicaTab canWrite={canWrite} /> : <OtrasEntregasTab />}
      </View>
    </View>
  );
}
