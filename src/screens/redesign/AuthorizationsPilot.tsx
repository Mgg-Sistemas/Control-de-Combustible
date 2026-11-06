import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { RHeader, RAddButton, RPill } from '../../components/redesign/RList';
import { RecordForm, Field } from '../../components/RecordForm';
import { useToast } from '../../components/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import { useTable } from '../../hooks/useTable';
import { supabase } from '../../lib/supabase';
import { norm } from '../../lib/text';
import { exportPdf, pdfDocument } from '../../lib/pdf';
import { Authorization, Profile, Tank, Machinery, Vehicle, Company } from '../../types/database';
import { generalCompanies } from '../../lib/companies';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';
import OpcionesReporteCombustibleModal from '../../components/combustible/OpcionesReporteCombustibleModal';
import {
  LogosReporteCombustible,
  OPCIONES_REPORTE_SOLICITUDES,
  OpcionesActivas,
  mezclarOpciones,
} from '../../lib/combustibleReportes';

const ASSET_OPTIONS = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Maquinaria', value: 'maquinaria' },
];

const FIELDS: Field[] = [
  { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
  // Sin las que están "Esperando instrucciones" — no se decide aún si se van a usar.
  { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', subLabelCols: ['name', 'serial', 'identifier'], createColumn: 'plate', filter: { en_espera: false }, required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
  { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', subLabelCols: ['plate', 'serial', 'identifier'], createColumn: 'code', filter: { en_espera: false }, required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
  { key: 'tank_id', label: 'Tanque de origen', type: 'lookup', table: 'tanks', labelCol: 'name', required: true },
  { key: 'liters', label: 'Litros solicitados', type: 'number', required: true },
  { key: 'reason', label: 'Motivo', type: 'text' },
];

const STATUS_LBL: Record<string, string> = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const pillTone = (s: Authorization['status']): 'ok' | 'warn' | 'crit' =>
  s === 'aprobado' ? 'ok' : s === 'rechazado' ? 'crit' : 'warn';

function fmtDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  let h = d.getHours(); const ap = h < 12 ? 'a.m.' : 'p.m.'; h = h % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ap}`;
}
function inPeriod(iso: string, period: string): boolean {
  if (period === 'todo') return true;
  const d = new Date(iso); const now = new Date();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'hoy') return d >= startDay;
  if (period === 'semana') { const s = new Date(startDay); s.setDate(s.getDate() - ((startDay.getDay() + 6) % 7)); return d >= s; }
  if (period === 'mes') return d >= new Date(now.getFullYear(), now.getMonth(), 1);
  return true;
}

/**
 * PILOTO DE REDISEÑO — Solicitudes (autorizaciones de combustible). Misma lógica que
 * AuthorizationsScreen: filtros, aprobar/rechazar por RPC (approve/reject_authorization),
 * PDF y RecordForm. Solo cambia el look al lenguaje visual nuevo. No toca la BD.
 */
export default function AuthorizationsPilot() {
  const { role, session } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const { data, loading, refetch } = useTable<Authorization>('authorizations', { orderBy: 'created_at', ascending: false });
  const { data: profiles } = useTable<Profile>('profiles');
  const { data: tanks } = useTable<Tank>('tanks');
  const { data: machinery } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: vehicles } = useTable<Vehicle>('vehicles', { orderBy: 'plate' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Authorization | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verReporte, setVerReporte] = useState(false);

  const [status, setStatus] = useState('todos');
  const [companyFilter, setCompanyFilter] = useState('');
  const [period, setPeriod] = useState('todo');
  const [q, setQ] = useState('');

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (a: Authorization) => { setEditing(a); setFormOpen(true); };

  // El coordinador de inspectores resuelve igual que el inspector (la base también lo deja, 31-oct-2026).
  const canResolve = role === 'admin' || role === 'supervisor' || role === 'coordinador_inspectores';
  const nameOf = useMemo(() => { const m = new Map(profiles.map((p) => [p.id, p.full_name ?? '—'])); return (id: string | null) => (id ? m.get(id) ?? '—' : '—'); }, [profiles]);
  const tankOf = useMemo(() => { const m = new Map(tanks.map((t) => [t.id, t.name])); return (id: string | null) => (id ? m.get(id) ?? '—' : '—'); }, [tanks]);
  const machOf = useMemo(() => new Map(machinery.map((m) => [m.id, m])), [machinery]);
  const vehOf = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const companyName = useMemo(() => { const m = new Map(companies.map((c) => [c.id, c.name])); return (id: string | null) => (id ? m.get(id) ?? '—' : '—'); }, [companies]);

  const assetLabel = (a: Authorization) => {
    if (a.asset_kind === 'maquinaria') {
      const m: any = machOf.get(a.machinery_id ?? '');
      if (!m) return '—';
      const p = String(m.plate || '').trim() || 'S/P';
      const sn = String(m.serial || m.identifier || '').trim();
      return `${m.code || '—'} · 🚗 PLACA: ${p}${sn ? ` · 🔢 S/N: ${sn}` : ''}`;
    }
    const v: any = vehOf.get(a.vehicle_id ?? '');
    if (!v) return '—';
    const p = String(v.plate || '').trim() || 'S/P';
    const sn = String(v.serial || v.identifier || '').trim();
    const nm = String(v.name || v.model || '').trim();
    return `${nm ? `${nm} · ` : ''}🚗 PLACA: ${p}${sn ? ` · 🔢 S/N: ${sn}` : ''}`;
  };
  const companyIdOf = (a: Authorization) => a.asset_kind === 'maquinaria' ? (machOf.get(a.machinery_id ?? '')?.company_id ?? null) : null;
  const companyLabel = (a: Authorization) => companyName(companyIdOf(a));

  const filtered = useMemo(() => {
    const nq = norm(q);
    return data.filter((a) => {
      if (status !== 'todos' && a.status !== status) return false;
      if (companyFilter && companyIdOf(a) !== companyFilter) return false;
      if (!inPeriod(a.created_at, period)) return false;
      if (nq && !norm(assetLabel(a)).includes(nq)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, status, companyFilter, period, q, machOf, vehOf]);

  const resolve = async (id: string, approve: boolean) => {
    setBusy(id);
    const fn = approve ? 'approve_authorization' : 'reject_authorization';
    const { error } = await supabase.rpc(fn, { p_auth_id: id });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    refetch();
  };

  const totalLitros = useMemo(() => filtered.reduce((s, a) => s + (Number(a.liters) || 0), 0), [filtered]);

  const downloadPdf = async (opcionesRaw?: OpcionesActivas, logos?: LogosReporteCombustible) => {
    const op = mezclarOpciones(OPCIONES_REPORTE_SOLICITUDES, opcionesRaw || null);
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const assetNameOnly = (a: Authorization) => {
      if (a.asset_kind === 'maquinaria') {
        const m: any = machOf.get(a.machinery_id ?? '');
        return m ? String(m.code || '—') : '—';
      }
      const v: any = vehOf.get(a.vehicle_id ?? '');
      return v ? String(v.name || v.model || v.plate || '—') : '—';
    };
    const assetPlateOf = (a: Authorization) => {
      if (a.asset_kind === 'maquinaria') {
        const m: any = machOf.get(a.machinery_id ?? '');
        return m ? String(m.plate || '').trim() || 'S/P' : 'S/P';
      }
      const v: any = vehOf.get(a.vehicle_id ?? '');
      return v ? String(v.plate || '').trim() || 'S/P' : 'S/P';
    };
    const assetSerialOf = (a: Authorization) => {
      if (a.asset_kind === 'maquinaria') {
        const m: any = machOf.get(a.machinery_id ?? '');
        return m ? String(m.serial || m.identifier || '').trim() || '—' : '—';
      }
      const v: any = vehOf.get(a.vehicle_id ?? '');
      return v ? String(v.serial || v.identifier || '').trim() || '—' : '—';
    };

    const cols: { head: string; right?: boolean; cell: (a: Authorization) => string }[] = [];
    if (op.fecha !== false) cols.push({ head: 'Fecha y hora', cell: (a) => `<td>${esc(fmtDateTime(a.created_at))}</td>` });
    if (op.activo !== false) cols.push({ head: 'Activo', cell: (a) => `<td><b>${esc(assetNameOnly(a))}</b></td>` });
    if (op.placa !== false) cols.push({ head: 'Placa', cell: (a) => `<td>${esc(assetPlateOf(a))}</td>` });
    if (op.serial !== false) cols.push({ head: 'Serial', cell: (a) => `<td>${esc(assetSerialOf(a))}</td>` });
    if (op.tipo !== false) cols.push({ head: 'Tipo', cell: (a) => `<td>${esc(a.asset_kind)}</td>` });
    if (op.empresa !== false) cols.push({ head: 'Empresa', cell: (a) => `<td>${esc(companyLabel(a))}</td>` });
    if (op.tanque !== false) cols.push({ head: 'Tanque', cell: (a) => `<td>${esc(tankOf(a.tank_id))}</td>` });
    if (op.litros !== false) cols.push({ head: 'Litros', right: true, cell: (a) => `<td style="text-align:right;font-weight:700">${(Number(a.liters) || 0).toLocaleString()}</td>` });
    if (op.estado !== false) cols.push({ head: 'Estado', cell: (a) => `<td>${esc(STATUS_LBL[a.status] || a.status)}</td>` });
    if (op.solicita !== false) cols.push({ head: 'Solicita', cell: (a) => `<td>${esc(nameOf(a.requested_by))}</td>` });
    if (op.motivo) cols.push({ head: 'Motivo', cell: (a) => `<td>${esc(a.reason || '—')}</td>` });

    const rows = filtered.map((a) => `<tr>${cols.map((c) => c.cell(a)).join('')}</tr>`).join('');
    const iLitros = cols.findIndex((c) => c.head === 'Litros');
    const tfootHtml =
      op.totales !== false && cols.length > 0
        ? `<tfoot><tr>${cols
            .map((_, idx) =>
              idx === 0
                ? `<td style="font-weight:800">TOTAL LITROS</td>`
                : idx === iLitros
                ? `<td style="text-align:right;font-weight:800">${totalLitros.toLocaleString()} L</td>`
                : `<td></td>`,
            )
            .join('')}</tr></tfoot>`
        : '';
    const firmasHtml = op.firmas
      ? `<div style="display:flex;justify-content:space-around;margin-top:32px;page-break-inside:avoid"><div style="width:220px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;font-weight:700">Solicitado / Despachador</div><div style="width:220px;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:10px;font-weight:700">Autorizado / Coordinación</div></div>`
      : '';

    const parts = [
      status !== 'todos' ? `Estado: ${STATUS_LBL[status]}` : null,
      companyFilter ? `Empresa: ${companyName(companyFilter)}` : null,
      period !== 'todo' ? `Período: ${period}` : null,
      q ? `Activo: ${q}` : null,
    ].filter(Boolean);
    const html = pdfDocument({
      title: 'Solicitudes de combustible',
      subtitle: `${filtered.length} solicitud(es)${parts.length ? ' · ' + parts.join(' · ') : ''}`,
      logos: logos || undefined,
      marcaTexto: op.marcaTexto !== false,
      extraCss: `table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}`,
      body: rows
        ? `<table><thead><tr>${cols.map((c) => `<th${c.right ? ' style="text-align:right"' : ''}>${c.head}</th>`).join('')}</tr></thead>
           <tbody>${rows}</tbody>
           ${tfootHtml}</table>${firmasHtml}`
        : '<p style="color:#666">Sin solicitudes para los filtros elegidos.</p>',
    });
    await exportPdf(html, 'Solicitudes de combustible');
    setVerReporte(false);
  };

  const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RHeader
        title="SOLICITUDES"
        subtitle={`${filtered.length} solicitud(es) · ${totalLitros.toLocaleString()} L`}
        action={<RAddButton label="+ Solicitar" onPress={openNew} />}
      />

      {loading ? (
        <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.sm, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
          {/* Filtros */}
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Estado</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              {[['todos', 'Todos'], ['pendiente', 'Pendientes'], ['aprobado', 'Aprobados'], ['rechazado', 'Rechazados']].map(([k, l]) => (
                <Chip key={k} on={status === k} label={l} onPress={() => setStatus(k)} />
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Período</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              {[['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes'], ['todo', 'Todo']].map(([k, l]) => (
                <Chip key={k} on={period === k} label={l} onPress={() => setPeriod(k)} />
              ))}
            </View>
            {generalCompanies(companies).length > 1 ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Empresa (máquinas)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                  <Chip on={companyFilter === ''} label="Todas" onPress={() => setCompanyFilter('')} />
                  {generalCompanies(companies).map((c) => <Chip key={c.id} on={companyFilter === c.id} label={c.name} onPress={() => setCompanyFilter(c.id)} />)}
                </View>
              </>
            ) : null}
            <TextInput value={q} onChangeText={setQ} placeholder="Buscar por máquina / placa…" placeholderTextColor={colors.muted} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => setVerReporte(true)} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>🖨️ Reporte PDF (personalizable)</Text>
              </TouchableOpacity>
            </View>
          </View>

          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', padding: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.md }}>
              <Text style={{ fontSize: 26, color: colors.muted }}>✅</Text>
              <Text style={{ color: colors.text, fontWeight: '800', marginTop: spacing.xs }}>Sin solicitudes</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, textAlign: 'center' }}>Ajusta los filtros o crea una solicitud de consumo.</Text>
            </View>
          ) : (
            filtered.map((a) => (
              <View key={a.id} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => openEdit(a)}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '900', color: colors.brandText, fontSize: 17, fontVariant: ['tabular-nums'] as any }}>{Number(a.liters).toLocaleString()} L</Text>
                    <RPill label={STATUS_LBL[a.status] || a.status} tone={pillTone(a.status)} />
                  </View>
                  <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>{a.asset_kind === 'maquinaria' ? '🚜' : '🚗'} {assetLabel(a)} <Text style={{ color: colors.muted }}>· {companyLabel(a)}</Text></Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5 }}>Tanque: {tankOf(a.tank_id)} · Solicita: {nameOf(a.requested_by)}</Text>
                  {a.reason ? <Text style={{ color: colors.muted, fontSize: 12.5 }}>Motivo: {a.reason}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🕒 {fmtDateTime(a.created_at)}</Text>
                  {a.status !== 'pendiente' ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{a.status === 'aprobado' ? 'Autorizado' : 'Rechazado'} por {nameOf(a.approved_by)}</Text>
                  ) : null}
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Toca para editar o borrar</Text>
                </TouchableOpacity>

                {canResolve && a.status === 'pendiente' ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }} disabled={busy === a.id} onPress={() => resolve(a.id, true)}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>{busy === a.id ? '…' : 'Aprobar'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger }} disabled={busy === a.id} onPress={() => resolve(a.id, false)}>
                      <Text style={{ color: colors.danger, fontWeight: '800' }}>Rechazar</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? 'Editar solicitud' : 'Nueva solicitud'}
        table="authorizations"
        fields={FIELDS}
        autoUserField="requested_by"
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />
      <OpcionesReporteCombustibleModal
        visible={verReporte}
        titulo="Reporte de solicitudes de combustible"
        opciones={OPCIONES_REPORTE_SOLICITUDES}
        storageKey="combustible:reporte-solicitudes"
        ocultarFechas
        usuarioId={session?.user?.id}
        onClose={() => setVerReporte(false)}
        onGenerar={({ opciones, logos }) => downloadPdf(opciones, logos)}
      />
    </View>
  );
}
