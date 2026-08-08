import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, FlatList, Modal, Pressable } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { pdfDocument, exportPdf } from '../lib/pdf';
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
// Suma/resta N días a una fecha ISO (YYYY-MM-DD) sin problemas de zona horaria.
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => `${x}`.padStart(2, '0');
  return `${nd.getUTCFullYear()}-${p(nd.getUTCMonth() + 1)}-${p(nd.getUTCDate())}`;
}
const dmy = (iso: string) => iso.split('-').reverse().join('/');
// Valor legible para la sección "Cambios" (null/objeto/booleano → texto).
function fmtVal(x: any): string {
  if (x === null || x === undefined || x === '') return '∅';
  if (typeof x === 'boolean') return x ? 'sí' : 'no';
  if (typeof x === 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
  return String(x);
}
// Tope de filas que traemos de la BD. Con búsqueda subimos el tope porque el
// filtro ya lo hace el servidor (no trae "todo el día", solo lo que coincide).
const LIMIT_BASE = 2000;
const LIMIT_SEARCH = 5000;

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
  // Eventos de la app (no escriben en tabla): login, escaneo, jornada, parada.
  LOGIN: { icon: '🔑', label: 'inició sesión', color: '#0F766E' },
  LOGOUT: { icon: '🚪', label: 'cerró sesión', color: '#6B7280' },
  SCAN: { icon: '📷', label: 'escaneó', color: '#7C3AED' },
  CHECK: { icon: '✅', label: 'se asignó', color: '#0369A1' },
  JORNADA_INICIO: { icon: '🟢', label: 'inició jornada', color: '#15803D' },
  JORNADA_FIN: { icon: '🏁', label: 'finalizó jornada', color: '#2563EB' },
  PARADA: { icon: '🟡', label: 'marcó PARADA', color: '#D9A200' },
};
// Eventos de la app: el "objeto" de la acción es el detalle (código de máquina),
// no el nombre de la tabla; y no llevan preposición ("creó Máquina" vs "escaneó CARGADOR 01").
const EVENT_ACTIONS = new Set(['LOGIN', 'LOGOUT', 'SCAN', 'CHECK', 'JORNADA_INICIO', 'JORNADA_FIN', 'PARADA']);

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
 * Fila de la bitácora, MEMOIZADA. Al virtualizar con FlatList (la bitácora puede
 * traer hasta 2000–5000 filas) solo se montan las visibles; además React.memo evita
 * re-render de las filas que no cambian. `colors` y `onPress` son estables entre
 * renders (tema / setState), así el memo es efectivo. */
const AuditRowCard = React.memo(function AuditRowCard({ r, colors, onPress }: { r: AuditLog; colors: any; onPress: (r: AuditLog) => void }) {
  const a = ACTION_META[r.action] ?? { icon: '•', label: r.action.toLowerCase(), color: colors.muted };
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => onPress(r)}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ fontSize: 22 }}>{a.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14 }}>
              <Text style={{ fontWeight: '800' }}>{r.user_name || 'Alguien'}</Text>
              <Text style={{ color: a.color, fontWeight: '700' }}> {a.label}</Text>
              {EVENT_ACTIONS.has(r.action)
                ? (r.detail ? <Text style={{ fontWeight: '700' }}> {r.detail}</Text> : null)
                : <Text style={{ fontWeight: '700' }}> {tableLabel(r.table_name)}</Text>}
              {/* Para creó/modificó/eliminó, mostrar CUÁL registro (código de máquina, etc.). */}
              {!EVENT_ACTIONS.has(r.action) && (r.row_label || r.detail) ? <Text style={{ color: colors.muted, fontWeight: '700' }}> · {r.row_label || r.detail}</Text> : null}
              {r.action === 'UPDATE' && r.changes ? <Text style={{ color: colors.muted, fontSize: 12 }}> ({Object.keys(r.changes).length} cambio{Object.keys(r.changes).length === 1 ? '' : 's'})</Text> : null}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{caracasDT(r.at)}{r.device ? ` · ${r.device}` : ''}</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
});

/**
 * AUDITORÍA / BITÁCORA (solo para quien tenga can_audit): muestra quién creó, modificó
 * o eliminó qué y cuándo. Se filtra por RANGO de fechas (Desde–Hasta, con atajos),
 * por usuario, por tipo y por BÚSQUEDA LIBRE. La búsqueda corre EN EL SERVIDOR sobre
 * todo el rango (usuario, detalle/código de máquina, tipo y acción), así se encuentra
 * una máquina de otra fecha sin tener que pararse en ese día. Los datos los escribe un
 * trigger en la BD; aquí solo se leen (RLS deja leer solo a can_audit).
 */
export default function AuditScreen() {
  const { colors } = useTheme();
  const { canAudit } = useAuth();
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(caracasToday()); // inicio del rango
  const [to, setTo] = useState(caracasToday());     // fin del rango
  const [userFilter, setUserFilter] = useState('__all__');
  const [tableFilter, setTableFilter] = useState('__all__');
  const [q, setQ] = useState('');
  const [truncated, setTruncated] = useState(false); // se alcanzó el tope de filas
  const [detail, setDetail] = useState<AuditLog | null>(null);   // fila abierta en detalle
  const [targetName, setTargetName] = useState<string | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [rtNonce, setRtNonce] = useState(0); // se incrementa al llegar un cambio en tiempo real, para forzar la recarga de abajo

  // Al cambiar Desde por encima de Hasta (o viceversa), se emparejan para no invertir.
  const setFromSafe = (v: string) => { setFrom(v); if (v > to) setTo(v); };
  const setToSafe = (v: string) => { setTo(v); if (v < from) setFrom(v); };
  // Atajos de rango.
  const today = caracasToday();
  const setPreset = (kind: 'hoy' | '7' | '30' | 'mes') => {
    if (kind === 'hoy') { setFrom(today); setTo(today); }
    else if (kind === '7') { setFrom(addDaysISO(today, -6)); setTo(today); }
    else if (kind === '30') { setFrom(addDaysISO(today, -29)); setTo(today); }
    else { setFrom(`${today.slice(0, 7)}-01`); setTo(today); }
  };
  // Mueve la ventana completa (Desde y Hasta) un día (◀ / ▶), conservando su tamaño.
  const shiftWindow = (d: number) => {
    const nf = addDaysISO(from, d);
    const nt = addDaysISO(to, d);
    if (nt > today) return; // no adelantar más allá de hoy
    setFrom(nf); setTo(nt);
  };

  useEffect(() => {
    if (!detail) { setTargetName(null); return; }
    setTargetLoading(true);
    resolveTarget(detail.table_name, detail.row_id).then((n) => { setTargetName(n); setTargetLoading(false); });
  }, [detail]);

  // Carga con debounce cuando hay búsqueda (para no pegarle a la BD en cada tecla).
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      const fromTs = `${from}T00:00:00-04:00`;
      const toTs = `${to}T23:59:59.999-04:00`;
      const nq = norm(q.trim());
      // Texto seguro para el .or() de PostgREST (coma y paréntesis son separadores).
      const safe = q.trim().replace(/[,()%]/g, ' ').trim();

      const limit = nq ? LIMIT_SEARCH : LIMIT_BASE;
      // Tipos cuyo NOMBRE legible coincide con el texto (ej. "máquina" → machinery).
      const matchTables = Object.entries(TABLE_LABEL).filter(([, label]) => norm(label).includes(nq)).map(([t]) => t);
      // Acciones cuyo verbo coincide (ej. "modificó" → UPDATE).
      const matchActions = Object.entries(ACTION_META).filter(([, m]) => norm(m.label).includes(nq)).map(([a]) => a);
      // Arma la consulta. `withRowLabel` incluye row_label en la búsqueda; si esa
      // columna aún no existe (audit_detalle.sql sin correr) reintentamos sin ella.
      const build = (withRowLabel: boolean) => {
        let query = supabase.from('audit_log').select('*').gte('at', fromTs).lte('at', toTs);
        if (nq && safe) {
          const ors = [`user_name.ilike.%${safe}%`, `detail.ilike.%${safe}%`, `table_name.ilike.%${safe}%`];
          if (withRowLabel) ors.push(`row_label.ilike.%${safe}%`);
          if (matchTables.length) ors.push(`table_name.in.(${matchTables.join(',')})`);
          if (matchActions.length) ors.push(`action.in.(${matchActions.join(',')})`);
          query = query.or(ors.join(','));
        }
        return query.order('at', { ascending: false }).limit(limit);
      };
      let { data, error } = await build(true);
      if (error && /row_label/.test(error.message || '')) {
        ({ data, error } = await build(false)); // columna aún no creada → sin row_label
      }
      if (!alive) return;
      const list = (data as AuditLog[]) ?? [];
      setRows(list);
      setTruncated(list.length >= limit);
      setLoading(false);
    };
    const t = setTimeout(run, q ? 350 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [from, to, q, rtNonce]);

  // Bitácora en vivo: si otro usuario/dispositivo genera una acción, se refresca sola.
  useRealtimeRefresh(['audit_log'], () => setRtNonce((n) => n + 1));

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

  // La búsqueda libre ya la aplicó el servidor; aquí solo refinamos por los CHIPS
  // (usuario / tipo) sobre lo cargado, para no ocultar filas que coincidieron por detalle.
  const shown = rows.filter((r) =>
    (userFilter === '__all__' || r.user_name === userFilter) &&
    (tableFilter === '__all__' || r.table_name === tableFilter)
  );
  const rangoTxt = from === to ? dmy(from) : `${dmy(from)} → ${dmy(to)}`;

  // PDF de la bitácora (con las filas ya filtradas). En web abre la VISTA PREVIA
  // (modal con Imprimir / Guardar como PDF); en móvil comparte el archivo.
  const generarPdf = async () => {
    if (shown.length === 0) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const filtro = [
      q.trim() ? `Búsqueda: "${q.trim()}"` : '',
      userFilter !== '__all__' ? `Usuario: ${userFilter}` : '',
      tableFilter !== '__all__' ? `Tipo: ${tableLabel(tableFilter)}` : '',
    ].filter(Boolean).join(' · ');
    const filas = shown.map((r) => {
      const a = ACTION_META[r.action] ?? { label: r.action.toLowerCase() };
      const ev = EVENT_ACTIONS.has(r.action);
      const accion = ev ? a.label : `${a.label} ${tableLabel(r.table_name)}`;
      const detalle = ev ? (r.detail ?? '') : (r.detail ?? '');
      return `<tr>
        <td>${esc(caracasDT(r.at))}</td>
        <td>${esc(r.user_name || 'Alguien')}</td>
        <td>${esc(accion)}</td>
        <td>${esc(detalle)}</td>
        <td>${esc(r.device ?? '')}</td>
      </tr>`;
    }).join('');
    const html = pdfDocument({
      title: 'Auditoría · Bitácora',
      subtitle: `${rangoTxt} · ${shown.length} acción(es)${filtro ? ' · ' + filtro : ''}`,
      extraCss: `table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left;vertical-align:top}
        th{background:#16324F;color:#fff} tr:nth-child(even) td{background:#f4f7fb}`,
      body: `<table><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Máquina / detalle</th><th>Dispositivo</th></tr></thead><tbody>${filas}</tbody></table>`,
    });
    await exportPdf(html, `Auditoria ${from}_${to}`);
  };

  if (!canAudit) {
    return (<Screen><SectionTitle>Auditoría</SectionTitle><EmptyState title="Sin acceso" subtitle="Este módulo es privado." /></Screen>);
  }

  const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const Preset = ({ label, kind }: { label: string; kind: 'hoy' | '7' | '30' | 'mes' }) => (
    <TouchableOpacity onPress={() => setPreset(kind)} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11 }}>{label}</Text>
    </TouchableOpacity>
  );

  // Cabecera (banner, rango, búsqueda, chips) como ListHeaderComponent del FlatList.
  // Se pasa como ELEMENTO (no función) para que el TextInput no pierda el foco al escribir.
  const listHeader = (
    <View style={{ gap: spacing.md }}>
      <ConfigBanner />
      <SectionTitle>🕵️ Auditoría — quién hace qué</SectionTitle>

      {/* Rango de fechas (Desde–Hasta) + atajos */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => shiftWindow(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 2 }}>DESDE</Text>
            <DateField value={from} onChange={setFromSafe} maxISO={today} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 2 }}>HASTA</Text>
            <DateField value={to} onChange={setToSafe} maxISO={today} />
          </View>
          <TouchableOpacity onPress={() => shiftWindow(1)} disabled={to >= today} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: to >= today ? 0.4 : 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, marginTop: spacing.sm }}>
          <Preset label="Hoy" kind="hoy" />
          <Preset label="7 días" kind="7" />
          <Preset label="30 días" kind="30" />
          <Preset label="Este mes" kind="mes" />
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
            {shown.length} acción(es) · {rangoTxt}
            {userFilter !== '__all__' || tableFilter !== '__all__' ? ' (filtradas)' : ''}
            {truncated ? ` · ⚠️ tope ${rows.length}, acota el rango o afina la búsqueda` : ''}
          </Text>
          <TouchableOpacity onPress={generarPdf} disabled={shown.length === 0} style={{ backgroundColor: shown.length === 0 ? colors.surfaceAlt : colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: shown.length === 0 ? 0.5 : 1 }}>
            <Text style={{ color: shown.length === 0 ? colors.muted : colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>📄 PDF (vista previa)</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar máquina, usuario, tipo o acción… (en todo el rango)" placeholderTextColor={colors.muted}
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
    </View>
  );

  return (
    <Screen scroll={false}>
      {/* Bitácora VIRTUALIZADA: puede traer hasta 2000–5000 filas; FlatList monta solo
          las visibles (antes un ScrollView pintaba TODAS de golpe → lento y pesado). */}
      <FlatList
        data={loading ? [] : shown}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => <AuditRowCard r={item} colors={colors} onPress={setDetail} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={loading
          ? <Loading />
          : <EmptyState title="Sin actividad" subtitle={q.trim() ? `No hay acciones que coincidan con "${q.trim()}" en ${rangoTxt}.` : `No hay acciones registradas en ${rangoTxt} y filtro.`} />}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={11}
      />

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
                  <Row k="Qué hizo" v={EVENT_ACTIONS.has(detail.action) ? a.label.toUpperCase() : `${a.label.toUpperCase()} · ${tableLabel(detail.table_name)}`} />
                  <Row k={EVENT_ACTIONS.has(detail.action) ? 'Máquina / detalle' : 'A qué registro'} v={detail.detail ?? detail.row_label ?? (targetLoading ? 'Buscando…' : (targetName ?? (detail.row_id ? `ID ${detail.row_id}` : '—')))} />
                  <Row k="Cuándo" v={caracasDT(detail.at)} />
                  {detail.device ? <Row k="Dispositivo" v={detail.device} /> : null}
                  {detail.row_id ? <Row k="ID interno" v={detail.row_id} /> : null}

                  {/* CAMBIOS: UPDATE muestra campo + (de → a); INSERT/DELETE muestra la fila. */}
                  {detail.changes && Object.keys(detail.changes).length > 0 ? (
                    <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs }}>
                        {detail.action === 'UPDATE' ? `Cambios (${Object.keys(detail.changes).length})` : detail.action === 'INSERT' ? 'Datos creados' : 'Datos eliminados'}
                      </Text>
                      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                        {Object.entries(detail.changes).map(([k, v]) => (
                          <View key={k} style={{ marginBottom: 5 }}>
                            <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{k}</Text>
                            {detail.action === 'UPDATE' ? (
                              <Text style={{ color: colors.text, fontSize: 12 }}>
                                <Text style={{ color: colors.danger }}>{fmtVal((v as any)?.de)}</Text>
                                {'  →  '}
                                <Text style={{ color: colors.success }}>{fmtVal((v as any)?.a)}</Text>
                              </Text>
                            ) : (
                              <Text style={{ color: colors.text, fontSize: 12 }}>{fmtVal(v)}</Text>
                            )}
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
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
