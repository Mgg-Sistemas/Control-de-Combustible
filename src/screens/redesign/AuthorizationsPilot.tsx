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

const ASSET_OPTIONS = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Maquinaria', value: 'maquinaria' },
];

const FIELDS: Field[] = [
  { key: 'asset_kind', label: 'Tipo de activo', type: 'select', options: ASSET_OPTIONS, required: true },
  { key: 'vehicle_id', label: 'Vehículo (placa)', type: 'lookup', table: 'vehicles', labelCol: 'plate', createColumn: 'plate', required: true, showIf: (v) => v.asset_kind === 'vehiculo' },
  { key: 'machinery_id', label: 'Maquinaria (código)', type: 'lookup', table: 'machinery', labelCol: 'code', createColumn: 'code', required: true, showIf: (v) => v.asset_kind === 'maquinaria' },
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
  const { role } = useAuth();
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

  const [status, setStatus] = useState('todos');
  const [companyFilter, setCompanyFilter] = useState('');
  const [period, setPeriod] = useState('todo');
  const [q, setQ] = useState('');

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (a: Authorization) => { setEditing(a); setFormOpen(true); };

  const canResolve = role === 'admin' || role === 'supervisor';
  const nameOf = useMemo(() => { const m = new Map(profiles.map((p) => [p.id, p.full_name ?? '—'])); return (id: string | null) => (id ? m.get(id) ?? '—' : '—'); }, [profiles]);
  const tankOf = useMemo(() => { const m = new Map(tanks.map((t) => [t.id, t.name])); return (id: string | null) => (id ? m.get(id) ?? '—' : '—'); }, [tanks]);
  const machOf = useMemo(() => new Map(machinery.map((m) => [m.id, m])), [machinery]);
  const vehOf = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const companyName = useMemo(() => { const m = new Map(companies.map((c) => [c.id, c.name])); return (id: string | null) => (id ? m.get(id) ?? '—' : '—'); }, [companies]);

  const assetLabel = (a: Authorization) => a.asset_kind === 'maquinaria' ? (machOf.get(a.machinery_id ?? '')?.code ?? '—') : (vehOf.get(a.vehicle_id ?? '')?.plate ?? '—');
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

  const downloadPdf = async () => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = filtered.map((a) => `<tr>
      <td>${esc(fmtDateTime(a.created_at))}</td>
      <td>${esc(assetLabel(a))}</td>
      <td>${esc(a.asset_kind)}</td>
      <td>${esc(companyLabel(a))}</td>
      <td>${esc(tankOf(a.tank_id))}</td>
      <td style="text-align:right;font-weight:700">${(Number(a.liters) || 0).toLocaleString()}</td>
      <td>${esc(STATUS_LBL[a.status] || a.status)}</td>
      <td>${esc(nameOf(a.requested_by))}</td>
    </tr>`).join('');
    const parts = [
      status !== 'todos' ? `Estado: ${STATUS_LBL[status]}` : null,
      companyFilter ? `Empresa: ${companyName(companyFilter)}` : null,
      period !== 'todo' ? `Período: ${period}` : null,
      q ? `Activo: ${q}` : null,
    ].filter(Boolean);
    const html = pdfDocument({
      title: 'Solicitudes de combustible',
      subtitle: `${filtered.length} solicitud(es)${parts.length ? ' · ' + parts.join(' · ') : ''}`,
      extraCss: `table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}`,
      body: rows
        ? `<table><thead><tr><th>Fecha y hora</th><th>Activo</th><th>Tipo</th><th>Empresa</th><th>Tanque</th><th style="text-align:right">Litros</th><th>Estado</th><th>Solicita</th></tr></thead>
           <tbody>${rows}</tbody>
           <tfoot><tr><td colspan="5" style="text-align:right;font-weight:800">TOTAL LITROS</td><td style="text-align:right;font-weight:800">${totalLitros.toLocaleString()}</td><td colspan="2"></td></tr></tfoot></table>`
        : '<p style="color:#666">Sin solicitudes para los filtros elegidos.</p>',
    });
    await exportPdf(html, 'Solicitudes de combustible');
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
              <TouchableOpacity onPress={downloadPdf} style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>📄 PDF (vista previa)</Text>
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
    </View>
  );
}
