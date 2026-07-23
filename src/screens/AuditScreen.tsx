import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Pressable } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { AuditLog } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasDT(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}

// Nombre legible de cada tabla y su ícono.
const TABLE_LABEL: Record<string, string> = {
  machinery: 'Máquina', dispatches: 'Surtido de combustible', fuel_intakes: 'Ingreso de combustible',
  transfers: 'Traslado de combustible', maintenance_requests: 'Avería / mantenimiento', machinery_repairs: 'Reparación',
  machine_rounds: 'Jornada', inventory_items: 'Producto de inventario', inventory_movements: 'Movimiento de inventario',
  inventory_transfers: 'Nota de traslado', companies: 'Empresa', profiles: 'Usuario', employees: 'Empleado',
  aliados: 'Aliado', company_payments: 'Pago de empresa', truck_yard_logs: 'Entrada/salida de camión', app_roles: 'Rol',
  control_closures: 'Cierre de control', tanks: 'Tanque', authorizations: 'Autorización', price_tariffs: 'Tarifa (tabulador)',
  company_price_tariffs: 'Tarifa por empresa', supervisor_visits: 'Inspección', food_distributions: 'Distribución de comida',
  food_company_meals: 'Comida por empresa', attendance: 'Asistencia', uniform_deliveries: 'Uniforme',
  operator_assignments: 'Jornada de operador', module_permissions: 'Permiso', purchase_orders: 'Compra',
  purchase_requests: 'Requisición', staff_pay_payments: 'Pago a personal', vehicles: 'Vehículo', fletes: 'Flete',
};
const tableLabel = (t: string) => TABLE_LABEL[t] ?? t;
const ACTION_META: Record<string, { icon: string; label: string; color: string }> = {
  INSERT: { icon: '➕', label: 'creó', color: '#15803D' },
  UPDATE: { icon: '✏️', label: 'modificó', color: '#2563EB' },
  DELETE: { icon: '🗑️', label: 'eliminó', color: '#DC2626' },
};

// Nombre legible del registro afectado (según su tabla) a partir del row_id, para
// mostrar en el detalle "a qué apunta" la acción (ej. cuál usuario, cuál máquina).
const NAME_COLS = ['full_name', 'name', 'code', 'title', 'descripcion', 'sku'];
async function resolveTarget(table: string, rowId: string | null): Promise<string | null> {
  if (!rowId) return null;
  try {
    const { data } = await supabase.from(table).select('*').eq('id', rowId).maybeSingle();
    if (!data) return null;
    const d: any = data;
    if (d.first_name || d.last_name) return [d.first_name, d.last_name].filter(Boolean).join(' ');
    for (const c of NAME_COLS) { if (d[c]) return String(d[c]); }
    return null;
  } catch { return null; }
}

/**
 * AUDITORÍA / BITÁCORA (solo para quien tenga can_audit): muestra quién creó, modificó
 * o eliminó qué y cuándo. Filtra por fecha, por usuario y por tipo. Los datos los
 * escribe un trigger en la BD; aquí solo se leen (RLS deja leer solo a can_audit).
 */
export default function AuditScreen() {
  const { colors } = useTheme();
  const { canAudit } = useAuth();
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(caracasToday()); // día a revisar
  const [userFilter, setUserFilter] = useState('__all__');
  const [tableFilter, setTableFilter] = useState('__all__');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<AuditLog | null>(null);   // fila abierta en detalle
  const [targetName, setTargetName] = useState<string | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);

  useEffect(() => {
    if (!detail) { setTargetName(null); return; }
    setTargetLoading(true);
    resolveTarget(detail.table_name, detail.row_id).then((n) => { setTargetName(n); setTargetLoading(false); });
  }, [detail]);

  const load = async () => {
    setLoading(true);
    const from = `${date}T00:00:00-04:00`;
    const to = `${date}T23:59:59.999-04:00`;
    const { data } = await supabase.from('audit_log').select('*')
      .gte('at', from).lte('at', to)
      .order('at', { ascending: false }).limit(2000);
    setRows((data as AuditLog[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [date]);

  const users = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.user_name) s.add(r.user_name); });
    return Array.from(s).sort(cmpText);
  }, [rows]);
  const tables = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.table_name));
    return Array.from(s).sort((a, b) => cmpText(tableLabel(a), tableLabel(b)));
  }, [rows]);

  const nq = norm(q.trim());
  const shown = rows.filter((r) =>
    (userFilter === '__all__' || r.user_name === userFilter) &&
    (tableFilter === '__all__' || r.table_name === tableFilter) &&
    (!nq || norm(r.user_name).includes(nq) || norm(tableLabel(r.table_name)).includes(nq))
  );

  if (!canAudit) {
    return (<Screen><SectionTitle>Auditoría</SectionTitle><EmptyState title="Sin acceso" subtitle="Este módulo es privado." /></Screen>);
  }

  const shiftDay = (d: number) => {
    const [y, m, dd] = date.split('-').map(Number);
    const nd = new Date(Date.UTC(y, m - 1, dd + d));
    const p = (n: number) => `${n}`.padStart(2, '0');
    setDate(`${nd.getUTCFullYear()}-${p(nd.getUTCMonth() + 1)}-${p(nd.getUTCDate())}`);
  };

  const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>🕵️ Auditoría — quién hace qué</SectionTitle>

      {/* Selector de día */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => shiftDay(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}><DateField value={date} onChange={setDate} maxISO={caracasToday()} /></View>
          <TouchableOpacity onPress={() => shiftDay(1)} disabled={date >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: date >= caracasToday() ? 0.4 : 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>{shown.length} acción(es) este día{userFilter !== '__all__' || tableFilter !== '__all__' ? ' (filtradas)' : ''}</Text>
      </Card>

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar usuario o tipo…" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm }} />

      {/* Filtro por usuario */}
      {users.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
          <Chip label="Todos" on={userFilter === '__all__'} onPress={() => setUserFilter('__all__')} />
          {users.map((u) => <Chip key={u} label={u} on={userFilter === u} onPress={() => setUserFilter(u)} />)}
        </ScrollView>
      ) : null}

      {/* Filtro por tipo */}
      {tables.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.sm }}>
          <Chip label="Todo" on={tableFilter === '__all__'} onPress={() => setTableFilter('__all__')} />
          {tables.map((t) => <Chip key={t} label={tableLabel(t)} on={tableFilter === t} onPress={() => setTableFilter(t)} />)}
        </ScrollView>
      ) : null}

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin actividad" subtitle="No hay acciones registradas para este día y filtro." />
      ) : (
        shown.map((r) => {
          const a = ACTION_META[r.action] ?? { icon: '•', label: r.action.toLowerCase(), color: colors.muted };
          return (
            <TouchableOpacity key={r.id} activeOpacity={0.7} onPress={() => setDetail(r)}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ fontSize: 22 }}>{a.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 14 }}>
                      <Text style={{ fontWeight: '800' }}>{r.user_name || 'Alguien'}</Text>
                      <Text style={{ color: a.color, fontWeight: '700' }}> {a.label} </Text>
                      <Text style={{ fontWeight: '700' }}>{tableLabel(r.table_name)}</Text>
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{caracasDT(r.at)}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      {/* Detalle de una acción */}
      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }} onPress={() => setDetail(null)}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm }}>
            {detail ? (() => {
              const a = ACTION_META[detail.action] ?? { icon: '•', label: detail.action.toLowerCase(), color: colors.muted };
              const Row = ({ k, v }: { k: string; v: string }) => (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 13, width: 96 }}>{k}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }}>{v}</Text>
                </View>
              );
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ fontSize: 26 }}>{a.icon}</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, flex: 1 }}>Detalle de la acción</Text>
                  </View>
                  <Row k="Quién" v={detail.user_name || 'No registrado (acción del servidor · gestión de usuarios)'} />
                  <Row k="Qué hizo" v={`${a.label.toUpperCase()} · ${tableLabel(detail.table_name)}`} />
                  <Row k="A qué registro" v={targetLoading ? 'Buscando…' : (targetName ?? (detail.row_id ? `ID ${detail.row_id}` : '—'))} />
                  <Row k="Cuándo" v={caracasDT(detail.at)} />
                  {detail.user_name ? null : (
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                      ℹ️ Las ediciones de usuario hechas antes de esta actualización no guardaron quién las hizo. De ahora en adelante sí queda registrado el admin.
                    </Text>
                  )}
                  <TouchableOpacity onPress={() => setDetail(null)} style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Cerrar</Text>
                  </TouchableOpacity>
                </>
              );
            })() : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
