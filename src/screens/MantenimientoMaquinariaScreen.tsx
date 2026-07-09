import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const MAT_ICON: Record<string, string> = { caucho: '🛞', aceite: '🛢️', filtro: '🧴', repuesto: '🔩' };
const matLabel = (m: string) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : '—');

type Req = {
  id: string;
  machinery_id: string;
  material: string;
  quantity: number | null;
  notes: string | null;
  status: string;
  created_at: string;
  code: string;
  tipo: string | null;
  company: string;
};

/** Fecha corta DD/MM/AAAA HH:mm de un ISO. */
function fmtDT(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * MANTENIMIENTO MAQUINARIA: muestra las máquinas que requieren mantenimiento
 * (solicitado por el operador al escanear el QR → botón azul). Por empresa,
 * desplegable y buscable. El supervisor marca "MANTENIMIENTO REALIZADO".
 */
export default function MantenimientoMaquinariaScreen() {
  const { colors } = useTheme();
  const { canSee, session } = useAuth();
  const confirm = useConfirm();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('maintenance_requests')
      .select('id, machinery_id, material, quantity, notes, status, created_at, machinery:machinery_id(code, tipo, company:company_id(name))')
      .order('created_at', { ascending: false });
    const list: Req[] = (data ?? []).map((r: any) => ({
      id: r.id,
      machinery_id: r.machinery_id,
      material: r.material,
      quantity: r.quantity != null ? Number(r.quantity) : null,
      notes: r.notes ?? null,
      status: r.status,
      created_at: r.created_at,
      code: r.machinery?.code ?? '—',
      tipo: r.machinery?.tipo ?? null,
      company: r.machinery?.company?.name ?? 'Sin empresa',
    }));
    setReqs(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const marcarRealizado = async (r: Req) => {
    const ok = await confirm({
      title: 'Mantenimiento realizado',
      message: `¿Marcar como REALIZADO el ${matLabel(r.material)} de "${r.code}"?`,
      confirmText: 'Sí, realizado',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    setBusy(r.id);
    const { error } = await supabase
      .from('maintenance_requests')
      .update({ status: 'realizado', resolved_by: session?.user?.id ?? null, resolved_at: new Date().toISOString() })
      .eq('id', r.id);
    setBusy(null);
    if (error) return;
    setReqs((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'realizado' } : x)));
  };

  // Filtra por estado + búsqueda y agrupa por empresa → máquina.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = reqs.filter((r) => (showDone ? r.status === 'realizado' : r.status === 'pendiente'));
    const byCompany = new Map<string, Map<string, Req[]>>();
    shown.forEach((r) => {
      if (q && !r.company.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) return;
      const comp = byCompany.get(r.company) ?? new Map<string, Req[]>();
      const arr = comp.get(r.code) ?? [];
      arr.push(r);
      comp.set(r.code, arr);
      byCompany.set(r.company, comp);
    });
    return Array.from(byCompany.entries())
      .map(([company, machMap]) => ({
        company,
        machines: Array.from(machMap.entries())
          .map(([code, items]) => ({ code, items, tipo: items[0]?.tipo ?? null }))
          .sort((a, b) => a.code.localeCompare(b.code)),
        count: Array.from(machMap.values()).reduce((s, a) => s + a.length, 0),
      }))
      .sort((a, b) => (a.company === 'Sin empresa' ? 1 : b.company === 'Sin empresa' ? -1 : a.company.localeCompare(b.company)));
  }, [reqs, query, showDone]);

  const pendientes = reqs.filter((r) => r.status === 'pendiente').length;

  if (!canSee('mantenimiento')) {
    return (
      <Screen>
        <SectionTitle>Mantenimiento maquinaria</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Mantenimiento maquinaria</SectionTitle>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Solicitudes pendientes</Text>
        <Text style={{ color: pendientes > 0 ? colors.warning : colors.success, fontWeight: '900', fontSize: 24 }}>{pendientes}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
          <TouchableOpacity onPress={() => setShowDone(false)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: !showDone ? colors.primary : colors.border, backgroundColor: !showDone ? colors.primary : colors.surface }}>
            <Text style={{ color: !showDone ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>⏳ Pendientes</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDone(true)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: showDone ? colors.primary : colors.border, backgroundColor: showDone ? colors.primary : colors.surface }}>
            <Text style={{ color: showDone ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>✓ Realizados</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar empresa o máquina…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.sm }}
      />

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState title={showDone ? 'Sin mantenimientos realizados' : 'Sin solicitudes pendientes'} subtitle={showDone ? undefined : 'Cuando un operador reporte una avería, aparecerá aquí.'} />
      ) : (
        groups.map((g) => {
          const open = expanded[g.company] !== false; // abierto por defecto
          return (
            <View key={g.company}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((p) => ({ ...p, [g.company]: !(p[g.company] !== false) }))}>
                <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.company}</Text>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{open ? '▲ ocultar' : '▼ ver'}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🚜 {g.machines.length} máquina(s) · {g.count} solicitud(es)</Text>
                </Card>
              </TouchableOpacity>

              {open ? g.machines.map((mm) => (
                <Card key={mm.code}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{mm.code}{mm.tipo ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '400' }}>  ·  {mm.tipo}</Text> : null}</Text>
                  {mm.items.map((r) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Text style={{ fontSize: 26 }}>{MAT_ICON[r.material] ?? '🔧'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>
                          {matLabel(r.material)}{r.quantity != null ? ` · ${r.quantity.toLocaleString()}` : ''}
                        </Text>
                        {r.notes ? <Text style={{ color: colors.muted, fontSize: 12 }}>{r.notes}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtDT(r.created_at)}</Text>
                      </View>
                      {r.status === 'pendiente' ? (
                        <TouchableOpacity onPress={() => marcarRealizado(r)} disabled={busy === r.id} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{busy === r.id ? '…' : '✓ Realizado'}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Badge label="Realizado" tone="success" />
                      )}
                    </View>
                  ))}
                </Card>
              )) : null}
            </View>
          );
        })
      )}
    </Screen>
  );
}
