import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, FlatList, SectionList, Modal, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { norm, cmpText } from '../lib/text';
import { fieldLabel, changesSummary } from '../lib/auditLabels';
import {
  cambiosEstadoMaquina, esCambioDeEstadoMaquina, conteoPorEstado, acompanantes,
  TABLAS_CON_ESTADO, CambioEstadoMaquina,
} from '../lib/auditMachineState';
import { machineLabel } from '../lib/machineLabel';
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
// ⚠️ `Intl.DateTimeFormat.format()` LANZA "Invalid time value" con una fecha que no
// se puede leer. La bitácora tiene años de filas escritas por versiones viejas del
// sistema: bastaba UNA con la hora mal para que la pantalla completa se cayera al
// pintar la lista (y con ella el PDF y el agrupado). Se devuelve el texto crudo
// antes que reventar — es feo, pero se sigue viendo todo lo demás.
function caracasDT(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
  } catch { return String(iso ?? '—'); }
}
// Fecha (YYYY-MM-DD) en huso Caracas de un timestamp, para agrupar "por día" sin que
// una acción de madrugada UTC caiga en el día equivocado. Mismo blindaje que arriba:
// si revienta acá, se cae el agrupado "por día" de toda la bitácora.
function caracasDateISO(iso: string): string {
  try {
    const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso)).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return String(iso ?? '').slice(0, 10) || '—'; }
}
// Lunes de la semana (Caracas) de una fecha ISO — para el filtro rápido "Esta semana".
function weekStartISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo..6=sábado
  return addDaysISO(iso, dow === 0 ? -6 : -(dow - 1));
}
// Suma/resta N días a una fecha ISO (YYYY-MM-DD) sin problemas de zona horaria.
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => `${x}`.padStart(2, '0');
  return `${nd.getUTCFullYear()}-${p(nd.getUTCMonth() + 1)}-${p(nd.getUTCDate())}`;
}
const dmy = (iso: string) => iso.split('-').reverse().join('/');
// Valor legible para la sección "Cambios" (null/objeto/booleano/fecha → texto).
function fmtVal(x: any): string {
  if (x === null || x === undefined || x === '') return '∅';
  if (typeof x === 'boolean') return x ? 'sí' : 'no';
  if (typeof x === 'string') {
    // Fecha+hora completa (ej. created_at, resolved_at) → hora Caracas legible,
    // no el ISO crudo con "T" y offset que nadie entiende de un vistazo.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x)) { try { return caracasDT(x); } catch { return x; } }
    // Fecha simple sin hora (ej. round_date, dispatch_date) → DD/MM/AAAA, SIN pasar
    // por Date/zona horaria (evita que un "09" se corra a "08" por el huso horario).
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return dmy(x);
    return x;
  }
  if (typeof x === 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
  return String(x);
}
// Tope de filas que traemos de la BD. Con búsqueda subimos el tope porque el
// filtro ya lo hace el servidor (no trae "todo el día", solo lo que coincide).
const LIMIT_BASE = 2000;
const LIMIT_SEARCH = 5000;
const LIMIT_FULL_HISTORY = 8000;
// "🚜 Estados de máquina" sobre TODO el historial (sin texto de búsqueda). El tope
// es MÁS BAJO que el de una búsqueda porque acá no hay rango de fechas que acote:
// la consulta ya va limitada a `machinery`/`vehicles` (índice), así que a la base
// no le cuesta — lo que hay que cuidar es el teléfono que tiene que pintar la lista.
const LIMIT_ESTADOS_HISTORY = 3000;
// Con 1 letra suelta, casi cualquier tabla/máquina/persona "coincide" — degenera en
// una consulta prácticamente sin filtro (y con "todo el historial" activo, sin
// límite de fecha). Se pide un mínimo antes de resolver nada contra la BD.
const MIN_SEARCH_LEN = 3;
// Tope duro combinado de ids resueltos (máquina+persona+empleado) para el IN() de
// la consulta — cada tabla ya trae hasta 200, pero sumadas podrían pasar de 600
// ids en la URL (riesgo real de "URI demasiado larga"). Con esto de sobra alcanza:
// si una búsqueda de verdad resuelve a cientos de coincidencias, no es una
// búsqueda específica y el respaldo de nivel 2 (texto) igual la cubre.
const MAX_MATCH_IDS = 150;

// Nombre legible de cada tabla y su ícono.
const TABLE_LABEL: Record<string, string> = {
  machinery: 'Máquina', dispatches: 'Surtido de combustible', fuel_intakes: 'Ingreso de combustible',
  transfers: 'Traslado de combustible', maintenance_requests: 'Avería / mantenimiento', machinery_repairs: 'Reparación',
  machine_rounds: 'Jornada', inventory_items: 'Producto de inventario', inventory_movements: 'Movimiento de inventario',
  inventory_transfers: 'Nota de traslado', companies: 'Empresa', profiles: 'Usuario', employees: 'Empleado', payroll_companies: 'Empresa filtro nómina',
  aliados: 'Aliado', company_payments: 'Pago de empresa', truck_yard_logs: 'Entrada/salida de camión', app_roles: 'Rol',
  control_closures: 'Cierre de control', tanks: 'Tanque', authorizations: 'Autorización', price_tariffs: 'Tarifa (tabulador)',
  company_price_tariffs: 'Tarifa por empresa', supervisor_visits: 'Inspección', food_distributions: 'Distribución de comida',
  food_company_meals: 'Comida por empresa', attendance: 'Asistencia', uniform_deliveries: 'Uniforme',
  operator_assignments: 'Jornada de operador', module_permissions: 'Permiso', purchase_orders: 'Compra',
  purchase_requests: 'Requisición', staff_pay_payments: 'Pago a personal', vehicles: 'Vehículo', fletes: 'Flete',
  machine_operators: 'Operador asignado a máquina', machine_inspectors: 'Inspector asignado a máquina',
  service_intervention_types: 'Tipo de intervención (taller)',
  machinery_service_orders: 'Servicio de maquinaria', machinery_service_parts: 'Repuesto de un servicio',
};
const tableLabel = (t: string) => TABLE_LABEL[t] ?? t;

// Agrupación de las tablas de negocio en MÓDULOS (áreas para el dueño del negocio,
// no para un programador): alimenta el filtro "por módulo" y el "agrupar por módulo".
// Cubre exactamente las tablas que el trigger audit_row() vigila (supabase/audit.sql);
// si un día se agrega una tabla ahí, agregarla también aquí (si no, cae en "Otro").
type ModuleDef = { key: string; label: string; icon: string; tables: string[] };
// ⚠️ SI SE AUDITA UNA TABLA NUEVA, AGRÉGALA ACÁ. Lo que no esté en esta lista cae en
//    "📁 Otro" y el agrupado por módulo deja de servir. `scripts/test-auditoria-labels.mjs`
//    verifica que ninguna tabla con trigger de auditoría se quede fuera (20-ago-2026:
//    faltaban 11 y por eso medio sistema salía como "Otro").
const MODULES: ModuleDef[] = [
  { key: 'combustible', label: 'Combustible', icon: '⛽', tables: ['tanks', 'fuel_intakes', 'dispatches', 'transfers', 'authorizations', 'price_tariffs', 'company_price_tariffs', 'stock_movements'] },
  { key: 'maquinaria', label: 'Maquinaria y flota', icon: '🚜', tables: ['machinery', 'machine_rounds', 'maintenance_requests', 'machinery_repairs', 'vehicles', 'fletes', 'truck_yard_logs', 'machine_guards', 'service_intervention_types', 'machinery_service_orders', 'machinery_service_parts'] },
  { key: 'viajes', label: 'Viajes de camiones', icon: '🚛', tables: ['camion_viajes'] },
  { key: 'inspecciones', label: 'Inspecciones y jornadas', icon: '📋', tables: ['supervisor_visits', 'control_closures', 'operator_assignments', 'machine_operators', 'machine_inspectors', 'machine_inspections'] },
  { key: 'nomina', label: 'Nómina y personal', icon: '👷', tables: ['employees', 'payroll_companies', 'attendance', 'uniform_deliveries', 'staff_pay_payments', 'staff_pay_periods', 'payroll_periods', 'aliados'] },
  { key: 'empresas', label: 'Empresas y facturación', icon: '🏢', tables: ['companies', 'company_payments'] },
  { key: 'inventario', label: 'Inventario y compras', icon: '📦', tables: ['inventory_items', 'inventory_movements', 'inventory_transfers', 'purchase_orders', 'purchase_requests', 'suppliers'] },
  { key: 'alimentacion', label: 'Alimentación', icon: '🍽️', tables: ['food_distributions', 'food_company_meals'] },
  { key: 'obras', label: 'Obras Públicas', icon: '🏗️', tables: ['op_edificio_base', 'op_edificio_removidos'] },
  { key: 'usuarios', label: 'Usuarios y permisos', icon: '🔑', tables: ['profiles', 'app_roles', 'module_permissions'] },
  { key: 'avisos', label: 'Avisos del sistema', icon: '🔔', tables: ['notifications', 'notification_reads'] },
];
const TABLE_TO_MODULE = new Map<string, ModuleDef>();
MODULES.forEach((mod) => mod.tables.forEach((t) => TABLE_TO_MODULE.set(t, mod)));
const moduleOf = (t: string) => TABLE_TO_MODULE.get(t) ?? null;

// Tablas relacionadas con DINERO (pagos, tarifas, compras): cruzan varios módulos, por
// eso van aparte y alimentan solo el filtro rápido "💰 Solo cambios de dinero".
const MONEY_TABLES = new Set(['company_payments', 'staff_pay_payments', 'price_tariffs', 'company_price_tariffs', 'purchase_orders', 'purchase_requests']);

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
  // ⭐ La corrección EXCEPCIONAL de un viaje: la que toca un día que ya cerró.
  //    Sin esta entrada igual se vería (la línea de abajo cae a un genérico con
  //    la acción en minúsculas), pero el pedido del cliente fue poder
  //    IDENTIFICARLAS FÁCILMENTE — y con nombre y color propios se encuentran de
  //    un vistazo entre miles de filas, además de poderse buscar por su texto.
  //    Ojo: acá NO llegan las correcciones normales del día. Esas las registra
  //    el trigger `trg_audit` de `camion_viajes` como un UPDATE cualquiera, y se
  //    dejó así a propósito para no llenar la bitácora de ruido.
  EDIT_VIAJE_FUERA_JORNADA: { icon: '🚚', label: 'corrigió un viaje de OTRO DÍA', color: '#B45309' },
};
// Eventos de la app: el "objeto" de la acción es el detalle (código de máquina),
// no el nombre de la tabla; y no llevan preposición ("creó Máquina" vs "escaneó CARGADOR 01").
const EVENT_ACTIONS = new Set(['LOGIN', 'LOGOUT', 'SCAN', 'CHECK', 'JORNADA_INICIO', 'JORNADA_FIN', 'PARADA']);
// Las tres acciones que escribe un TRIGGER sobre una tabla (las únicas que traen
// `changes`, o sea las únicas donde puede haber un cambio de estado). Todo lo demás
// son eventos de la app. Ver el comentario de `acotar` más abajo.
const ACCIONES_DE_TABLA = ['INSERT', 'UPDATE', 'DELETE'];
// "Cajón" de tipo de acción para el filtro (agrupa los 7 eventos de app en uno solo:
// a un dueño de negocio no le sirve elegir entre LOGIN/SCAN/PARADA por separado aquí).
const actionBucket = (r: AuditLog): string => (EVENT_ACTIONS.has(r.action) ? 'EVENTOS' : r.action);
const ACTION_BUCKETS: { key: string; label: string }[] = [
  { key: 'INSERT', label: '➕ Creó' },
  { key: 'UPDATE', label: '✏️ Modificó' },
  { key: 'DELETE', label: '🗑️ Eliminó' },
  { key: 'EVENTOS', label: '📋 Eventos de app' },
];

// Favorito de auditoría: una combinación COMPLETA de filtros guardada con nombre, para
// re-aplicarla luego con un toque (patrón "Favoritos" tipo Odoo). Se persiste LOCAL
// (AsyncStorage, ya usado en el resto de la app — ThemeContext, offlineQueue —, y
// funciona igual en web y nativo): es personal del dispositivo, no hace falta Supabase.
type AuditFavorite = {
  id: string; name: string;
  from: string; to: string; fullHistory: boolean; q: string;
  userFilter: string; tableFilter: string;
  moduleFilter: string[]; actionFilter: string[]; moneyOnly: boolean;
  groupBy: string;
  /** Opcional: los favoritos guardados ANTES del 20-ago-2026 no lo traen. */
  estadoMaqOnly?: boolean;
};
const FAVORITES_KEY = 'audit_favorites_v1';

// Nombre legible del registro afectado (según su tabla) a partir del row_id, para
// mostrar en el detalle "a qué apunta" la acción (ej. cuál usuario, cuál máquina).
// Mismas columnas que resuelve el trigger audit_row() en la BD (audit_detalle.sql):
// si un día se agrega una columna ahí, agregarla también aquí para no desalinear
// el "en vivo" (filas viejas sin row_label) del que ya quedó guardado en la bitácora.
const NAME_COLS = ['full_name', 'name', 'code', 'title', 'descripcion', 'sku', 'plate', 'company_name'];
/** Lo que se pudo averiguar del registro afectado: su nombre y la FILA COMPLETA
 *  (para la ficha de "toda la información" cuando es una máquina). UNA sola fila,
 *  y solo al abrir el detalle — nunca por cada renglón de la lista. */
type TargetInfo = { nombre: string | null; row: any | null; empresa: string | null };
async function resolveTarget(table: string, rowId: string | null): Promise<TargetInfo> {
  const vacio: TargetInfo = { nombre: null, row: null, empresa: null };
  if (!rowId) return vacio;
  try {
    const { data } = await supabase.from(table).select('*').eq('id', rowId).maybeSingle();
    if (!data) return vacio;
    const d: any = data;
    let nombre: string | null = null;
    if (d.first_name || d.last_name) nombre = [d.first_name, d.last_name].filter(Boolean).join(' ');
    else for (const c of NAME_COLS) { if (d[c]) { nombre = String(d[c]); break; } }
    // Empresa de la máquina: una fila más, solo al abrir el detalle. Va en su propio
    // try/catch para que un fallo acá no borre la ficha que ya se consiguió.
    let empresa: string | null = null;
    if (d.company_id) {
      try {
        const { data: c } = await supabase.from('companies').select('name').eq('id', d.company_id).maybeSingle();
        empresa = (c as any)?.name ?? null;
      } catch { empresa = null; }
    }
    return { nombre, row: d, empresa };
  } catch { return vacio; }
}

/**
 * Fila de la bitácora, MEMOIZADA. Al virtualizar con FlatList (la bitácora puede
 * traer hasta 2000–5000 filas) solo se montan las visibles; además React.memo evita
 * re-render de las filas que no cambian. `colors` y `onPress` son estables entre
 * renders (tema / setState), así el memo es efectivo. */
const AuditRowCard = React.memo(function AuditRowCard({ r, colors, onPress }: { r: AuditLog; colors: any; onPress: (r: AuditLog) => void }) {
  const a = ACTION_META[r.action] ?? { icon: '•', label: String(r.action ?? '·').toLowerCase(), color: colors.muted };
  const resumen = changesSummary(r.action, r.changes, fmtVal);
  // Cambio de ESTADO de la máquina (retirada / en espera / eliminada / QR): sale con
  // su propio color y en criollo, en vez de quedar escondido dentro de "(6 cambios)".
  const estados = cambiosEstadoMaquina(r);
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => onPress(r)}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ fontSize: 22 }}>{a.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 14 }}>
              <Text style={{ fontWeight: '800' }}>{r.user_name || 'Sin usuario (registro antiguo)'}</Text>
              <Text style={{ color: a.color, fontWeight: '700' }}> {a.label}</Text>
              {EVENT_ACTIONS.has(r.action)
                ? (r.detail ? <Text style={{ fontWeight: '700' }}> {r.detail}</Text> : null)
                : <Text style={{ fontWeight: '700' }}> {tableLabel(r.table_name)}</Text>}
              {/* Para creó/modificó/eliminó, mostrar CUÁL registro (código de máquina, etc.). */}
              {!EVENT_ACTIONS.has(r.action) && (r.row_label || r.detail) ? <Text style={{ color: colors.muted, fontWeight: '700' }}> · {r.row_label || r.detail}</Text> : null}
              {r.action === 'UPDATE' && r.changes ? <Text style={{ color: colors.muted, fontSize: 12 }}> ({Object.keys(r.changes).length} cambio{Object.keys(r.changes).length === 1 ? '' : 's'})</Text> : null}
            </Text>
            {/* Estado de la máquina, en grande: es lo que se viene a buscar acá. */}
            {estados.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                {estados.map((c) => (
                  <View key={c.key} style={{ backgroundColor: c.hex, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10.5 }}>{c.icon} {c.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {/* Qué cambió, sin tener que abrir la fila (ej. "En espera: no → sí"). */}
            {resumen ? <Text style={{ color: colors.text, fontSize: 12 }} numberOfLines={1}>{resumen}</Text> : null}
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
 * todo el rango (máquina/persona/empleado resuelto a id, tabla, acción y — si hace
 * falta — nombre de quien hizo la acción o etiqueta de la fila), así se encuentra
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
  // Buscar en TODO el historial (ignora el rango Desde–Hasta): para encontrar TODO lo
  // que le pasó a una máquina/inspector/usuario en particular, sin tener que adivinar
  // en qué fecha ocurrió. Solo tiene efecto si hay texto de búsqueda (si no, buscaría
  // sin filtro alguno sobre toda la bitácora, que sí puede ser enorme).
  const [fullHistory, setFullHistory] = useState(false);
  const [truncated, setTruncated] = useState(false); // se alcanzó el tope de filas
  const [loadError, setLoadError] = useState<string | null>(null); // la consulta falló (≠ "no hay nada")
  const [detail, setDetail] = useState<AuditLog | null>(null);   // fila abierta en detalle
  const [target, setTarget] = useState<TargetInfo>({ nombre: null, row: null, empresa: null });
  const [targetLoading, setTargetLoading] = useState(false);
  const targetName = target.nombre;
  const [pdfBusy, setPdfBusy] = useState(false); // generando el PDF (puede tardar con miles de filas)
  const [rtNonce, setRtNonce] = useState(0); // se incrementa al llegar un cambio en tiempo real, para forzar la recarga de abajo

  // Mapa id → nombre del usuario. RESUELVE quién hizo cada acción cuando el trigger
  // guardó el `user_id` pero no el nombre (`user_name` vacío → antes salía "Alguien",
  // p. ej. "ALGUIEN MODIFICÓ MÁQUINA"). Se llena una vez desde `profiles`; arregla
  // también los registros VIEJOS sin tocar la base de datos.
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, username');
      if (!alive || !data) return;
      const m = new Map<string, string>();
      data.forEach((p: any) => { const n = String(p.full_name || p.username || '').trim(); if (n) m.set(p.id, n); });
      setNameById(m);
    })();
    return () => { alive = false; };
  }, []);

  // Filtro AMPLIADO (menú ▾ tipo Odoo: Filtrar / Agrupar por / Favoritos). Todo esto se
  // combina en AND con la búsqueda libre y el rango de fechas de arriba, que NO se tocan.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTab, setMenuTab] = useState<'filtrar' | 'agrupar' | 'favoritos'>('filtrar');
  const [moduleFilter, setModuleFilter] = useState<Set<string>>(new Set()); // vacío = todos los módulos
  const [actionFilter, setActionFilter] = useState<Set<string>>(new Set()); // vacío = todos los tipos
  const [moneyOnly, setMoneyOnly] = useState(false); // filtro rápido "solo cambios de dinero"
  // Filtro rápido "🚜 Estados de máquina": deja SOLO las acciones que retiraron,
  // reactivaron, pusieron en espera, eliminaron o bloquearon una máquina. Además de
  // filtrar en pantalla, ACOTA LA CONSULTA a `machinery`/`vehicles` (columna
  // indexada): así traer un mes entero de estados cuesta menos que un día completo
  // de bitácora, en vez de más.
  const [estadoMaqOnly, setEstadoMaqOnly] = useState(false);
  const [groupBy, setGroupBy] = useState<'none' | 'modulo' | 'usuario' | 'dia'>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<AuditFavorite[]>([]);
  const [favName, setFavName] = useState('');

  // Favoritos guardados en este dispositivo (se cargan una sola vez al entrar).
  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_KEY).then((raw) => {
      if (!raw) return;
      try { setFavorites(JSON.parse(raw)); } catch {}
    });
  }, []);
  const persistFavorites = (list: AuditFavorite[]) => {
    setFavorites(list);
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(list)).catch(() => {});
  };
  // Guarda la combinación ACTUAL de filtros (texto + módulos + acciones + usuario +
  // rango + agrupación) con el nombre escrito en "favName".
  const saveFavorite = () => {
    const name = favName.trim();
    if (!name) return;
    const fav: AuditFavorite = {
      id: `${Date.now()}`, name, from, to, fullHistory, q,
      userFilter, tableFilter, moduleFilter: Array.from(moduleFilter),
      actionFilter: Array.from(actionFilter), moneyOnly, groupBy, estadoMaqOnly,
    };
    persistFavorites([fav, ...favorites]);
    setFavName('');
  };
  const applyFavorite = (fav: AuditFavorite) => {
    setFrom(fav.from); setTo(fav.to); setFullHistory(fav.fullHistory); setQ(fav.q);
    setUserFilter(fav.userFilter); setTableFilter(fav.tableFilter);
    setModuleFilter(new Set(fav.moduleFilter)); setActionFilter(new Set(fav.actionFilter));
    setMoneyOnly(fav.moneyOnly); setGroupBy((fav.groupBy as any) ?? 'none');
    setEstadoMaqOnly(!!fav.estadoMaqOnly);
    setMenuOpen(false);
  };
  const deleteFavorite = (id: string) => persistFavorites(favorites.filter((f) => f.id !== id));
  const toggleModule = (key: string) => setModuleFilter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleActionBucket = (key: string) => setActionFilter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleCollapsed = (key: string) => setCollapsedGroups((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Al cambiar Desde por encima de Hasta (o viceversa), se emparejan para no invertir.
  const setFromSafe = (v: string) => { setFrom(v); if (v > to) setTo(v); };
  const setToSafe = (v: string) => { setTo(v); if (v < from) setFrom(v); };
  // Atajos de rango.
  const today = caracasToday();
  const setPreset = (kind: 'hoy' | '7' | '30' | 'mes' | 'semana') => {
    if (kind === 'hoy') { setFrom(today); setTo(today); }
    else if (kind === '7') { setFrom(addDaysISO(today, -6)); setTo(today); }
    else if (kind === '30') { setFrom(addDaysISO(today, -29)); setTo(today); }
    else if (kind === 'semana') { setFrom(weekStartISO(today)); setTo(today); }
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
    if (!detail) { setTarget({ nombre: null, row: null, empresa: null }); return; }
    let alive = true;
    setTargetLoading(true);
    resolveTarget(detail.table_name, detail.row_id).then((info) => {
      if (!alive) return; // se cambió de fila antes de que llegara esta respuesta
      setTarget(info); setTargetLoading(false);
    });
    return () => { alive = false; };
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
      // Con 1-2 letras, "coincide" casi cualquier tabla/máquina/persona — degenera en
      // una consulta prácticamente sin filtro (y con "todo el historial" activo, sin
      // límite de fecha). Por debajo del mínimo, se trata como si no hubiera búsqueda.
      const hasQuery = nq.length >= MIN_SEARCH_LEN && !!safe;
      // Con búsqueda + "todo el historial" activado, se ignora el rango de fechas: sirve
      // para encontrar TODO lo que le pasó a una máquina/inspector/usuario puntual sin
      // tener que adivinar en qué fecha ocurrió. Sin texto de búsqueda no aplica (evita
      // traer la bitácora completa sin ningún filtro).
      // Con "🚜 Estados de máquina" también se permite ignorar el rango SIN escribir
      // nada: nadie se acuerda del día en que retiraron una máquina — esa es
      // justamente la pregunta. Y acá sí se puede: la consulta va acotada a
      // `machinery`/`vehicles` (índice `audit_log_table_name_idx`), que en toda la
      // historia son unos pocos miles de filas, no la bitácora completa.
      const searchAllTime = fullHistory && (hasQuery || estadoMaqOnly);

      // Con "🚜 Estados de máquina" el tope es SIEMPRE el suyo: escribir una palabra
      // no puede SUBIR de 3000 a 8000 filas justo en el modo que menos las necesita
      // (la consulta ya viene acotada a máquinas + acciones de tabla).
      const limit = estadoMaqOnly
        ? (searchAllTime ? LIMIT_ESTADOS_HISTORY : LIMIT_BASE)
        : searchAllTime ? LIMIT_FULL_HISTORY : hasQuery ? LIMIT_SEARCH : LIMIT_BASE;
      // Tipos cuyo NOMBRE legible coincide con el texto (ej. "máquina" → machinery).
      const matchTables = hasQuery ? Object.entries(TABLE_LABEL).filter(([, label]) => norm(label).includes(nq)).map(([t]) => t) : [];
      // Acciones cuyo verbo coincide (ej. "modificó" → UPDATE).
      const matchActions = hasQuery ? Object.entries(ACTION_META).filter(([, m]) => norm(m.label).includes(nq)).map(([a]) => a) : [];
      // Resuelve el texto contra CARACTERÍSTICAS reales de máquinas y personas (placa,
      // serial, modelo, cédula, usuario…), no solo lo que quedó escrito literalmente en
      // el detalle del log. Así "buscar por placa" (o serial, cédula, encargado…)
      // encuentra la máquina/persona aunque ese dato nunca se haya guardado como texto
      // en la bitácora — se resuelve su id y se busca por id (row_id / user_id).
      let matchRowIds: string[] = [];
      let matchUserIds: string[] = [];
      if (hasQuery) {
        const [{ data: mach }, { data: profs }, { data: emps }] = await Promise.all([
          supabase.from('machinery').select('id')
            .or(`code.ilike.%${safe}%,plate.ilike.%${safe}%,serial.ilike.%${safe}%,identifier.ilike.%${safe}%,encargado.ilike.%${safe}%,tipo.ilike.%${safe}%,clasificacion.ilike.%${safe}%,referencia.ilike.%${safe}%`)
            .limit(200),
          supabase.from('profiles').select('id')
            .or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%,cedula.ilike.%${safe}%`)
            .limit(200),
          // Empleados (RRHH): el carnet (EmployeeCardScreen) solo deja rastro en
          // `detail` como texto libre — desde que el NIVEL 2 dejó de tocar esa
          // columna (ver más abajo), buscar por cédula/nombre de un empleado
          // necesita resolverse a id aquí igual que máquina/perfil.
          supabase.from('employees').select('id')
            .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,cedula.ilike.%${safe}%`)
            .limit(200),
        ]);
        const machIds = (mach ?? []).map((m: any) => m.id as string);
        const profIds = (profs ?? []).map((p: any) => p.id as string);
        const empIds = (emps ?? []).map((e: any) => e.id as string);
        // Tope combinado: una búsqueda que resuelve a cientos de máquinas/personas ya
        // no es específica — un IN() de 600 ids es una URL enorme (riesgo de "URI
        // demasiado larga"). El respaldo de nivel 2 (texto) igual cubre esos casos.
        matchRowIds = [...machIds, ...profIds, ...empIds].slice(0, MAX_MATCH_IDS); // row_id: la máquina, el perfil o el empleado fue el AFECTADO
        matchUserIds = profIds.slice(0, MAX_MATCH_IDS);                            // user_id: el perfil fue quien HIZO la acción
      }
      // ── Consulta en DOS NIVELES para no tumbar la base de datos ──────────────
      // `audit_log` ya pasó los 60 mil registros: un ILIKE de texto libre sobre
      // sus columnas (user_name/detail/row_label) obliga a Postgres a REVISAR
      // FILA POR FILA (no hay índice que sirva para "contiene" en una tabla así
      // de grande) — eso es lo que tardaba 8-20s y saturaba el servidor. Confirmado
      // 09-ago-2026 con EXPLAIN ANALYZE en la BD real.
      //
      // NIVEL 1 (rápido, con índice): busca por máquina/persona/empleado/tabla/
      // acción ya RESUELTA a id (matchRowIds/matchUserIds) o a valor exacto
      // (matchTables/matchActions) — cubre la enorme mayoría de búsquedas reales
      // ("por placa", "por cédula", "por módulo"...) sin tocar más filas que las
      // del resultado. NO busca dentro de `detail` (texto libre del evento).
      const structuredOrs: string[] = [];
      if (matchTables.length) structuredOrs.push(`table_name.in.(${matchTables.join(',')})`);
      if (matchActions.length) structuredOrs.push(`action.in.(${matchActions.join(',')})`);
      if (matchRowIds.length) structuredOrs.push(`row_id.in.(${matchRowIds.join(',')})`);
      if (matchUserIds.length) structuredOrs.push(`user_id.in.(${matchUserIds.join(',')})`);
      // "🚜 Estados de máquina" ACOTA la consulta a las tablas que tienen estado.
      // `table_name` está indexado (supabase/audit_perf_indexes.sql) y esto entra
      // en AND con todo lo demás: la consulta siempre queda MÁS chica, nunca más
      // grande. Por eso este filtro no puede tumbar la base aunque se pida un mes.
      //
      // ⚠️ EL `action.in` NO ES OPCIONAL — NO LO QUITES. `table_name = 'machinery'`
      //    NO significa "edición de una máquina": los EVENTOS de la app (SCAN,
      //    CHECK, JORNADA_INICIO/FIN, PARADA) también se guardan con esa tabla, vía
      //    `logAudit(..., 'machinery', ...)` desde ~25 sitios (SupervisorScreen,
      //    CheckMaquinaModal, InspectionsSummary, PatioScreen, offlineQueue…). Con
      //    ~173 máquinas × 2 turnos son del orden de MIL filas al día que NO son
      //    cambios de estado. Sin este filtro se comían el tope de la consulta y la
      //    pantalla llegaba a decir "ninguna máquina cambió de estado en todo el
      //    historial" con una retirada real fuera de la ventana — justo la pregunta
      //    que este filtro vino a contestar. Los eventos nunca traen `changes`, así
      //    que descartarlos no pierde ni un solo cambio de estado.
      const acotar = (query: any) => (estadoMaqOnly
        ? query.in('table_name', TABLAS_CON_ESTADO as unknown as string[]).in('action', ACCIONES_DE_TABLA)
        : query);
      const buildStructured = () => {
        let query = supabase.from('audit_log').select('*');
        if (!searchAllTime) query = query.gte('at', fromTs).lte('at', toTs);
        query = query.or(structuredOrs.join(','));
        return acotar(query).order('at', { ascending: false }).limit(limit);
      };
      // NIVEL 2 (lento, escanea filas): busca por quien hizo la acción (nombre) o
      // por la etiqueta de la fila (row_label) — ej. una palabra suelta que no
      // resolvió a ninguna máquina/persona/empleado. SIEMPRE limitado al rango de
      // fecha visible (aunque esté activo "todo el historial") para no arriesgarse
      // a escanear la tabla completa sin límite. Se SUMA (no reemplaza) al nivel 1
      // cuando este trajo pocos resultados — si ya trajo muchos, no vale la pena
      // pagar el escaneo con lo que se está mostrando de sobra.
      const TEXT_FALLBACK_MERGE_THRESHOLD = 50;
      const buildTextFallback = (withRowLabel: boolean) => {
        let query = supabase.from('audit_log').select('*').gte('at', fromTs).lte('at', toTs);
        const ors = [`user_name.ilike.%${safe}%`];
        if (withRowLabel) ors.push(`row_label.ilike.%${safe}%`);
        query = query.or(ors.join(','));
        return acotar(query).order('at', { ascending: false }).limit(limit);
      };
      let data: any[] | null = null;
      let error: any = null;
      if (hasQuery) {
        if (structuredOrs.length) {
          ({ data, error } = await buildStructured());
        }
        if (!error && (!data || data.length < TEXT_FALLBACK_MERGE_THRESHOLD)) {
          let fb = await buildTextFallback(true);
          if (fb.error && /row_label/.test(fb.error.message || '')) {
            fb = await buildTextFallback(false); // columna aún no creada
          }
          if (fb.error) {
            if (!data) error = fb.error; // nivel 1 tampoco trajo nada: sí importa el error
          } else {
            const seen = new Set((data ?? []).map((r: any) => r.id));
            const extra = (fb.data ?? []).filter((r: any) => !seen.has(r.id));
            data = [...(data ?? []), ...extra]
              .sort((a: any, b: any) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
              .slice(0, limit);
          }
        }
      } else {
        let base = supabase.from('audit_log').select('*');
        if (!searchAllTime) base = base.gte('at', fromTs).lte('at', toTs);
        ({ data, error } = await acotar(base).order('at', { ascending: false }).limit(limit));
      }
      if (!alive) return;
      const list = (data as AuditLog[]) ?? [];
      setRows(list);
      setTruncated(list.length >= limit);
      // Un error de la consulta NO puede seguir viéndose como "Sin actividad": para
      // quien está buscando, "no hay nada" y "no respondió" son la misma pantalla en
      // blanco, y la conclusión equivocada ("nadie tocó esa máquina") es justo lo que
      // esta pantalla existe para evitar.
      setLoadError(error ? (error.message || 'La consulta no respondió.') : null);
      setLoading(false);
    };
    const t = setTimeout(run, q ? 350 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [from, to, q, fullHistory, rtNonce, estadoMaqOnly]);

  // Bitácora en vivo: si otro usuario/dispositivo genera una acción, se refresca sola.
  // `audit_log` recibe una fila por CADA escritura en ~30 tablas de TODA la app (no
  // es una tabla de un módulo puntual) — con el debounce por defecto (600ms/2.5s)
  // una pantalla de Auditoría dejada abierta podía terminar reconsultando la BD
  // varias veces por minuto sin que nadie la estuviera mirando. Con la app en uso
  // normal (varios usuarios a la vez) esto es tráfico constante e innecesario, así
  // que aquí se estira bastante más: se nota igual de "en vivo" para quien la está
  // usando, pero no dispara una consulta por cada acción que pasa en cualquier
  // rincón del sistema.
  // 20-ago-2026: el `maxWaitMs` de 20 s no servía de tope, servía de RELOJ. Con
  // 15-20 mil inserts al día la ráfaga no para nunca, así que el debounce jamás
  // llegaba a cumplirse y la pantalla abierta y quieta reconsultaba CADA 20
  // SEGUNDOS — hasta 8000 filas, más las 3 consultas de resolución si había
  // búsqueda. Para una bitácora, dos minutos se siente igual de "en vivo".
  useRealtimeRefresh(['audit_log'], () => setRtNonce((n) => n + 1), { debounceMs: 8000, maxWaitMs: 120000 });

  // Filas con el usuario RESUELTO: si el trigger no guardó el nombre pero sí el
  // user_id, se completa desde `nameById` (perfiles). Todo lo de abajo (lista,
  // filtros, agrupado, detalle y PDF) usa estas filas, así el nombre sale en todas.
  const resolvedRows = useMemo(
    () => rows.map((r) => (r.user_name || !r.user_id || !nameById.get(r.user_id))
      ? r
      : { ...r, user_name: nameById.get(r.user_id)! }),
    [rows, nameById],
  );

  const users = useMemo(() => {
    const s = new Set<string>();
    resolvedRows.forEach((r) => { if (r.user_name) s.add(r.user_name); });
    return Array.from(s).sort(cmpText);
  }, [resolvedRows]);
  const tables = useMemo(() => {
    const s = new Set<string>();
    resolvedRows.forEach((r) => s.add(r.table_name));
    return Array.from(s).sort((a, b) => cmpText(tableLabel(a), tableLabel(b)));
  }, [resolvedRows]);

  // La búsqueda libre ya la aplicó el servidor; aquí solo refinamos por los CHIPS
  // (usuario / tipo) y el menú ▾ (módulos / tipo de acción / solo dinero) sobre lo
  // cargado, para no ocultar filas que coincidieron por detalle. Todo se combina en AND.
  const shown = useMemo(() => resolvedRows.filter((r) => {
    if (userFilter !== '__all__' && r.user_name !== userFilter) return false;
    if (tableFilter !== '__all__' && r.table_name !== tableFilter) return false;
    if (moduleFilter.size > 0) {
      const mod = moduleOf(r.table_name);
      if (!mod || !moduleFilter.has(mod.key)) return false;
    }
    if (actionFilter.size > 0 && !actionFilter.has(actionBucket(r))) return false;
    if (moneyOnly && !MONEY_TABLES.has(r.table_name)) return false;
    // La consulta ya vino acotada a `machinery`/`vehicles`; acá se descartan los
    // cambios que NO tocaron el estado (foto, precio, encargado…).
    if (estadoMaqOnly && !esCambioDeEstadoMaquina(r)) return false;
    return true;
  }), [resolvedRows, userFilter, tableFilter, moduleFilter, actionFilter, moneyOnly, estadoMaqOnly]);

  // Conteo por tipo de cambio de estado (⬛ Retiradas 4 · ✅ Reactivadas 1) sobre lo
  // que está visible. Solo se calcula con el filtro activo: recorrer miles de filas
  // en cada render para un resumen que nadie pidió es justo lo que hace lenta la
  // pantalla.
  const conteoEstados = useMemo(
    () => (estadoMaqOnly ? conteoPorEstado(shown) : []),
    [shown, estadoMaqOnly],
  );
  const rangoTxt = from === to ? dmy(from) : `${dmy(from)} → ${dmy(to)}`;
  const searchAllTimeActive = fullHistory && (norm(q.trim()).length >= MIN_SEARCH_LEN || estadoMaqOnly);
  const rangoLabel = searchAllTimeActive ? 'todo el historial' : rangoTxt;
  // Cuántos filtros del menú ▾ están activos (además de búsqueda/usuario/tipo/rango),
  // para el "badge" del botón "Filtros ▾".
  const extraFilterCount = moduleFilter.size + actionFilter.size + (moneyOnly ? 1 : 0) + (estadoMaqOnly ? 1 : 0);

  // Resultados agrupados (Agrupar por: módulo / usuario / día), sobre lo YA filtrado.
  // Un Map preserva el orden de inserción: como `shown` viene ordenado por fecha
  // descendente, agrupar "por día" conserva el orden cronológico entre grupos.
  const groupedSections = useMemo(() => {
    if (groupBy === 'none') return null;
    const titleOf = (r: AuditLog): string => {
      if (groupBy === 'modulo') { const m = moduleOf(r.table_name); return m ? `${m.icon} ${m.label}` : '📁 Otro'; }
      if (groupBy === 'usuario') return r.user_name || 'Sin usuario (registro antiguo)';
      return dmy(caracasDateISO(r.at));
    };
    const map = new Map<string, AuditLog[]>();
    shown.forEach((r) => { const k = titleOf(r); if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); });
    let entries = Array.from(map.entries());
    // Por módulo/usuario ordenamos por actividad (más acciones primero) — le importa más
    // al dueño del negocio que el orden alfabético. Por día se respeta el orden cronológico.
    if (groupBy !== 'dia') entries = entries.sort((a, b) => b[1].length - a[1].length || cmpText(a[0], b[0]));
    return entries.map(([title, data]) => ({ title, data }));
  }, [shown, groupBy]);

  // Resumen por categoría de lo que está VISIBLE ahora (respeta búsqueda + chips + rango),
  // para tener un vistazo rápido sin tener que generar el PDF. Mismo dato que usa el PDF.
  const resumen = useMemo(() => {
    let creo = 0, modifico = 0, elimino = 0, eventos = 0;
    const porUsuario = new Map<string, number>();
    shown.forEach((r) => {
      if (r.action === 'INSERT') creo++;
      else if (r.action === 'UPDATE') modifico++;
      else if (r.action === 'DELETE') elimino++;
      else eventos++;
      const u = r.user_name || 'Sin usuario (registro antiguo)';
      porUsuario.set(u, (porUsuario.get(u) ?? 0) + 1);
    });
    const topUsuarios = Array.from(porUsuario.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { creo, modifico, elimino, eventos, topUsuarios };
  }, [shown]);

  // PDF de la bitácora (con las filas ya filtradas). En web abre la VISTA PREVIA
  // (modal con Imprimir / Guardar como PDF); en móvil comparte el archivo. Trae TODA
  // la información posible de cada acción — no solo un resumen de una línea: el
  // registro afectado (nombre legible), el detalle, el dispositivo Y el desglose
  // campo por campo de qué cambió (lo mismo que ves al tocar una fila en pantalla,
  // que antes solo estaba ahí y no salía en el PDF).
  const generarPdf = async () => {
    if (shown.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    try {
      await generarPdfInterno();
    } catch (e: any) {
      // Sin esto, cualquier fallo dejaba el botón sin hacer nada y sin decir por qué.
      setLoadError(`No se pudo generar el PDF: ${e?.message || e}`);
    } finally { setPdfBusy(false); }
  };

  const generarPdfInterno = async () => {
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // ⚠️ TOPE DE FILAS DEL PDF. En un INSERT/DELETE la bitácora guarda LA FILA
    // ENTERA en `changes`, y el desglose las imprime todas: con miles de acciones
    // el HTML llega a decenas de MB y eso es lo que cuelga (o mata) la app — en web
    // se mete en un iframe y en el teléfono pasa por Print. Se corta y se AVISA en
    // el propio documento: un PDF recortado en silencio es peor que uno corto.
    const MAX_PDF_FILAS = 1500;
    const filasPdf = shown.slice(0, MAX_PDF_FILAS);
    const recortado = shown.length - filasPdf.length;
    const filtro = [
      q.trim() ? `Búsqueda: "${q.trim()}"` : '',
      userFilter !== '__all__' ? `Usuario: ${userFilter}` : '',
      tableFilter !== '__all__' ? `Tipo: ${tableLabel(tableFilter)}` : '',
      moduleFilter.size ? `Módulos: ${MODULES.filter((m) => moduleFilter.has(m.key)).map((m) => m.label).join(', ')}` : '',
      actionFilter.size ? `Acciones: ${ACTION_BUCKETS.filter((b) => actionFilter.has(b.key)).map((b) => b.label.replace(/^\S+\s/, '')).join(', ')}` : '',
      moneyOnly ? 'Solo cambios de dinero' : '',
      estadoMaqOnly ? 'Solo estados de máquina (retirada / reactivada / en espera…)' : '',
      groupBy !== 'none' ? `Agrupado por ${groupBy === 'modulo' ? 'módulo' : groupBy === 'usuario' ? 'usuario' : 'día'}` : '',
    ].filter(Boolean).join(' · ');

    // Registro afectado, en texto legible: nombre/código (row_label) si existe, si no
    // el detalle, si no un ID corto como último recurso (sin consultar la BD por fila:
    // con miles de filas sería demasiado lento para un PDF).
    const targetTxt = (r: AuditLog) => r.row_label || r.detail || (r.row_id ? `ID ${r.row_id.slice(0, 8)}…` : '—');

    // Cambio de ESTADO de la máquina, con su color: en el papel es lo primero que se
    // busca ("¿quién la retiró?"), así que va ANTES del desglose campo por campo.
    const estadoHtml = (r: AuditLog): string => {
      const cs = cambiosEstadoMaquina(r);
      if (!cs.length) return '';
      const si = (b: boolean | null) => (b === null ? '—' : b ? 'sí' : 'no');
      return `<div class="ests">${cs.map((c) =>
        `<span class="est" style="background:${c.hex}">${esc(c.icon)} ${esc(c.label)}${
          c.campo ? ` · ${esc(fieldLabel(c.campo))}: ${si(c.de)} → ${si(c.a)}` : ''}</span>`).join('')}</div>`;
    };

    // Desglose de CAMBIOS de una fila, en HTML compacto (campo: antes → después).
    const changesHtml = (r: AuditLog): string => {
      if (!r.changes || Object.keys(r.changes).length === 0) return '';
      const entries = Object.entries(r.changes);
      const items = entries.map(([k, v]) => {
        if (r.action === 'UPDATE') {
          const de = esc(fmtVal((v as any)?.de));
          const a = esc(fmtVal((v as any)?.a));
          return `<div class="chg"><b>${esc(fieldLabel(k))}</b>: <span class="del">${de}</span> → <span class="new">${a}</span></div>`;
        }
        return `<div class="chg"><b>${esc(fieldLabel(k))}</b>: ${esc(fmtVal(v))}</div>`;
      }).join('');
      const titulo = r.action === 'UPDATE' ? `${entries.length} cambio(s)` : r.action === 'INSERT' ? 'Datos creados' : 'Datos eliminados';
      return `<div class="chgbox"><div class="chgtit">${esc(titulo)}</div>${items}</div>`;
    };

    const filas = filasPdf.map((r) => {
      const a = ACTION_META[r.action] ?? { label: r.action.toLowerCase() };
      const ev = EVENT_ACTIONS.has(r.action);
      const accion = ev ? a.label : `${a.label} ${tableLabel(r.table_name)}`;
      const detalle = ev
        ? esc(r.detail ?? '—')
        : `<b>${esc(targetTxt(r))}</b>${r.detail && r.detail !== r.row_label ? `<div class="sub">${esc(r.detail)}</div>` : ''}${estadoHtml(r)}${changesHtml(r)}`;
      return `<tr>
        <td class="nowrap">${esc(caracasDT(r.at))}</td>
        <td>${esc(r.user_name || 'Sin usuario (registro antiguo)')}</td>
        <td><span class="tag" style="background:${a.color}">${esc(a.icon ?? '')} ${esc(ev ? a.label : `${a.label} ${tableLabel(r.table_name)}`)}</span></td>
        <td>${detalle}</td>
        <td class="nowrap">${esc(r.device ?? '—')}</td>
      </tr>`;
    }).join('');

    // Resumen (mismos totales que se ven en pantalla) + top 5 usuarios por actividad.
    const resumenHtml = `
      <div class="sumbox">
        <div class="sumitem"><span class="sumn">${resumen.creo}</span><span class="suml">➕ Creaciones</span></div>
        <div class="sumitem"><span class="sumn">${resumen.modifico}</span><span class="suml">✏️ Modificaciones</span></div>
        <div class="sumitem"><span class="sumn">${resumen.elimino}</span><span class="suml">🗑️ Eliminaciones</span></div>
        <div class="sumitem"><span class="sumn">${resumen.eventos}</span><span class="suml">📋 Eventos de app</span></div>
      </div>
      ${resumen.topUsuarios.length ? `<div class="topusers"><b>Más actividad:</b> ${resumen.topUsuarios.map(([u, n]) => `${esc(u)} (${n})`).join(' · ')}</div>` : ''}
      ${conteoEstados.length ? `<div class="ests" style="margin:2px 0 8px">${conteoEstados.map((c) =>
        `<span class="est" style="background:${c.hex};font-size:10.5px;padding:3px 8px">${esc(c.icon)} ${esc(c.label)} · ${c.n}</span>`).join('')}</div>` : ''}
    `;

    const html = pdfDocument({
      title: 'Auditoría · Bitácora',
      subtitle: `${rangoLabel} · ${shown.length} acción(es)${filtro ? ' · ' + filtro : ''}${truncated ? ` · ⚠️ tope de ${rows.length} filas alcanzado` : ''}${recortado > 0 ? ` · ⚠️ EL PDF TRAE SOLO LAS ${filasPdf.length} MÁS RECIENTES (quedaron ${recortado} fuera)` : ''}`,
      extraCss: `
        .sumbox{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0}
        .sumitem{flex:1;min-width:110px;background:#f4f7fb;border:1px solid #c9d2dc;border-radius:6px;padding:8px 10px;text-align:center}
        .sumn{display:block;font-size:18px;font-weight:800;color:#16324F}
        .suml{display:block;font-size:10px;color:#555;margin-top:2px}
        .topusers{font-size:11px;color:#333;margin:4px 0 8px}
        table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:4px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left;vertical-align:top}
        th{background:#16324F;color:#fff} tr:nth-child(even) td{background:#f9fbfd}
        tr{page-break-inside:avoid}
        .nowrap{white-space:nowrap}
        .tag{color:#fff;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;white-space:nowrap;display:inline-block}
        .sub{color:#555;font-size:10px;margin-top:1px}
        .ests{margin-top:3px;display:flex;flex-wrap:wrap;gap:3px}
        .est{color:#fff;border-radius:4px;padding:2px 6px;font-size:9.5px;font-weight:700;display:inline-block}
        .chgbox{margin-top:4px;padding-top:4px;border-top:1px dashed #c9d2dc}
        .chgtit{font-size:9.5px;color:#16324F;font-weight:800;margin-bottom:2px}
        .chg{font-size:10px;color:#333;line-height:1.5}
        .chg .del{color:#B91C1C;text-decoration:line-through}
        .chg .new{color:#15803D;font-weight:700}`,
      body: `${resumenHtml}<table><thead><tr><th style="width:110px">Fecha y hora</th><th style="width:100px">Usuario</th><th style="width:130px">Acción</th><th>Registro afectado / cambios</th><th style="width:70px">Dispositivo</th></tr></thead><tbody>${filas}</tbody></table>`,
    });
    // El nombre del archivo dice de qué es: sin esto, "historial completo ()" con el
    // paréntesis vacío cuando se pide todo el historial de estados sin escribir nada.
    const nombreArchivo = searchAllTimeActive
      ? (q.trim() ? `Auditoria - historial completo (${q.trim()})`
        : estadoMaqOnly ? 'Auditoria - estados de maquina (historial completo)'
        : 'Auditoria - historial completo')
      : `Auditoria${estadoMaqOnly ? ' - estados de maquina' : ''} ${from}_${to}`;
    await exportPdf(html, nombreArchivo);
  };

  if (!canAudit) {
    return (<Screen><SectionTitle>Auditoría</SectionTitle><EmptyState title="Sin acceso" subtitle="Este módulo es privado." /></Screen>);
  }

  const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ backgroundColor: on ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const Preset = ({ label, kind }: { label: string; kind: 'hoy' | '7' | '30' | 'mes' | 'semana' }) => (
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

      {/* La consulta falló: se avisa. Sin esto se veía igual que "no hay nada". */}
      {loadError ? (
        <View style={{ backgroundColor: '#7F1D1D', borderRadius: radius.md, padding: spacing.sm }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>⚠️ La bitácora no respondió</Text>
          <Text style={{ color: '#FECACA', fontSize: 11, marginTop: 2 }}>
            {loadError} · Lo que ves abajo puede estar incompleto. Prueba con un rango más corto o afina la búsqueda.
          </Text>
        </View>
      ) : null}

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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, gap: spacing.xs }}>
          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
            {shown.length} acción(es) · {rangoLabel}
            {userFilter !== '__all__' || tableFilter !== '__all__' || extraFilterCount > 0 ? ' (filtradas)' : ''}
            {truncated ? ` · ⚠️ tope ${rows.length}, acota el rango o afina la búsqueda` : ''}
          </Text>
          {/* Menú ▾ tipo Odoo: Filtrar / Agrupar por / Favoritos (se combina con lo de arriba). */}
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: extraFilterCount > 0 || groupBy !== 'none' ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: extraFilterCount > 0 || groupBy !== 'none' ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
            <Text style={{ color: extraFilterCount > 0 || groupBy !== 'none' ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
              🔽 Filtros{extraFilterCount > 0 ? ` (${extraFilterCount})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={generarPdf} disabled={shown.length === 0 || pdfBusy} style={{ backgroundColor: shown.length === 0 || pdfBusy ? colors.surfaceAlt : colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: shown.length === 0 || pdfBusy ? 0.5 : 1 }}>
            <Text style={{ color: shown.length === 0 || pdfBusy ? colors.muted : colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{pdfBusy ? 'Generando…' : '📄 PDF'}</Text>
          </TouchableOpacity>
        </View>
        {/* 🚜 ESTADOS DE MÁQUINA — a la vista (pedido del cliente 20-ago-2026:
            "necesito que me diga quién colocó la maquinaria retirada o todos esos
            estados"). Deja SOLO las acciones que cambiaron el estado de una máquina y
            ACOTA la consulta a `machinery`/`vehicles`: con el filtro puesto la
            pantalla le pide MENOS a la base, no más. */}
        <TouchableOpacity
          onPress={() => setEstadoMaqOnly((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: estadoMaqOnly ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: estadoMaqOnly ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}
        >
          <Text style={{ fontSize: 13 }}>{estadoMaqOnly ? '☑️' : '⬜'}</Text>
          <Text style={{ color: estadoMaqOnly ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
            🚜 Estados de máquina — quién la retiró, reactivó o puso en espera
          </Text>
        </TouchableOpacity>

        {estadoMaqOnly ? (
          conteoEstados.length ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                {conteoEstados.map((c) => (
                  <View key={c.key} style={{ backgroundColor: c.hex, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{c.icon} {c.label} · {c.n}</Text>
                  </View>
                ))}
              </View>
              <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: spacing.xs }}>
                Toca cualquier fila para ver la ficha completa de la máquina y quién la dejó así.
              </Text>
            </>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              Ninguna máquina cambió de estado en {rangoLabel}. Marca abajo "🕘 Buscar en TODO el
              historial" y salen todos los cambios de estado desde siempre, sin tener que adivinar la
              fecha. Si el retiro es viejo, la ficha de la máquina igual guarda quién la retiró y cuándo.
            </Text>
          )
        ) : null}

        {/* AGRUPAR POR — a la vista, no enterrado en el menú (pedido del cliente
            20-ago-2026: "poder agrupar por módulo en el que hicieron cambios").
            Es el mismo `groupBy` del menú ▾, así que los dos quedan sincronizados. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>AGRUPAR POR:</Text>
          {([['none', 'Sin agrupar'], ['modulo', '🗂️ Módulo'], ['usuario', '👤 Usuario'], ['dia', '📅 Día']] as const).map(([k, label]) => {
            const on = groupBy === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setGroupBy(k)}
                style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
              >
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Con "Agrupar por módulo" activo: totales por módulo de un vistazo, antes de
            entrar a cada grupo. Es lo primero que se quiere ver — dónde se movió más. */}
        {groupBy === 'modulo' && (groupedSections?.length ?? 0) > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {(groupedSections ?? []).map((s) => (
              <View key={s.title} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11.5 }}>{s.title} · <Text style={{ fontWeight: '900' }}>{s.data.length}</Text></Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Resumen rápido por categoría, sin tener que generar el PDF. */}
        {shown.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            {[
              { n: resumen.creo, l: '➕ Creó', c: '#15803D' },
              { n: resumen.modifico, l: '✏️ Modificó', c: '#2563EB' },
              { n: resumen.elimino, l: '🗑️ Eliminó', c: '#DC2626' },
              { n: resumen.eventos, l: '📋 Eventos', c: colors.muted },
            ].map((s) => (
              <View key={s.l} style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: 6, alignItems: 'center' }}>
                <Text style={{ color: s.c, fontWeight: '800', fontSize: 15 }}>{s.n}</Text>
                <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700' }}>{s.l}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar por placa, serial, cédula, nombre… cualquier característica" placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm }} />

      {/* Historial completo de UNA entidad (máquina/inspector/usuario/cualquier cosa):
          con texto de búsqueda, este switch ignora el rango Desde–Hasta y trae TODO lo
          que le haya pasado a esa cosa desde siempre, sin tener que adivinar la fecha. */}
      {q.trim() || estadoMaqOnly ? (
        <TouchableOpacity
          onPress={() => setFullHistory((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, alignSelf: 'flex-start', backgroundColor: fullHistory ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: fullHistory ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}
        >
          <Text style={{ fontSize: 13 }}>{fullHistory ? '☑️' : '⬜'}</Text>
          <Text style={{ color: fullHistory ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
            🕘 Buscar en TODO el historial (ignora el rango de fechas)
          </Text>
        </TouchableOpacity>
      ) : null}

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

  // Solo se muestra el esqueleto de carga en la PRIMERA carga (sin filas todavía).
  // Un refresco posterior (búsqueda, filtro, o el "en vivo" de audit_log) NO debe
  // vaciar la lista mientras llega la respuesta — antes lo hacía y la pantalla
  // "parpadeaba" en blanco y el scroll saltaba arriba cada vez, aunque la persona
  // estuviera leyendo algo en ese momento.
  const initialLoading = loading && rows.length === 0;
  const emptyEl = initialLoading
    ? <Loading />
    : <EmptyState title="Sin actividad" subtitle={q.trim() ? `No hay acciones que coincidan con "${q.trim()}" en ${rangoLabel}.` : `No hay acciones registradas en ${rangoTxt} y filtro.`} />;

  return (
    <Screen scroll={false}>
      {/* Bitácora VIRTUALIZADA: puede traer hasta 2000–5000 filas; FlatList/SectionList
          montan solo las visibles (antes un ScrollView pintaba TODAS de golpe → lento). */}
      {groupBy === 'none' ? (
        <FlatList
          data={initialLoading ? [] : shown}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <AuditRowCard r={item} colors={colors} onPress={setDetail} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyEl}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={11}
        />
      ) : (
        // "Agrupar por" activo: encabezados PLEGABLES con el conteo de cada grupo, sobre
        // los resultados ya filtrados (mismo `shown` que usa la lista plana y el PDF).
        <SectionList
          sections={initialLoading ? [] : (groupedSections ?? [])}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item, section }) => (collapsedGroups.has(section.title) ? null : <AuditRowCard r={item} colors={colors} onPress={setDetail} />)}
          renderSectionHeader={({ section }) => {
            const collapsed = collapsedGroups.has(section.title);
            return (
              <TouchableOpacity onPress={() => toggleCollapsed(section.title)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{collapsed ? '▸' : '▾'} {section.title}</Text>
                <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>{section.data.length}</Text>
              </TouchableOpacity>
            );
          }}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyEl}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
        />
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
                  <Row k="Quién" v={detail.user_name || 'Sin usuario (registro antiguo)'} />
                  <Row k="Qué hizo" v={EVENT_ACTIONS.has(detail.action) ? a.label.toUpperCase() : `${a.label.toUpperCase()} · ${tableLabel(detail.table_name)}`} />
                  <Row k={EVENT_ACTIONS.has(detail.action) ? 'Máquina / detalle' : 'A qué registro'} v={detail.detail ?? detail.row_label ?? (targetLoading ? 'Buscando…' : (targetName ?? (detail.row_id ? `ID ${detail.row_id}` : '—')))} />
                  <Row k="Cuándo" v={caracasDT(detail.at)} />
                  {detail.device ? <Row k="Dispositivo" v={detail.device} /> : null}
                  {detail.row_id ? <Row k="ID interno" v={detail.row_id} /> : null}

                  {/* CAMBIO DE ESTADO — lo primero que se viene a buscar acá. Sale con
                      su color antes que el desglose campo por campo. */}
                  {(() => {
                    const estados: CambioEstadoMaquina[] = cambiosEstadoMaquina(detail);
                    if (!estados.length) return null;
                    const acomp = acompanantes(detail);
                    const si = (b: boolean | null) => (b === null ? '—' : b ? 'sí' : 'no');
                    return (
                      <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>Cambio de estado de la máquina</Text>
                        {estados.map((c) => (
                          <View key={c.key} style={{ backgroundColor: c.hex, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>{c.icon} {c.label}</Text>
                            {c.campo ? (
                              <Text style={{ color: '#fff', fontSize: 11, opacity: 0.9 }}>{fieldLabel(c.campo)}: {si(c.de)} → {si(c.a)}</Text>
                            ) : null}
                          </View>
                        ))}
                        {acomp.length ? (
                          <Text style={{ color: colors.muted, fontSize: 11 }}>La ficha también anotó: {acomp.map(fieldLabel).join(' · ')}</Text>
                        ) : null}
                      </View>
                    );
                  })()}

                  {/* FICHA COMPLETA de la máquina, tal como está AHORA ("toda la
                      información posible"). Responde "¿quién la dejó así?" incluso para
                      retiros viejos: `inactivated_by`/`reactivated_by` los guarda la
                      propia ficha, aparte de la bitácora. */}
                  {detail.table_name === 'machinery' && target.row ? (() => {
                    const m: any = target.row;
                    const estadoActual = m.active === false ? '🗑️ Eliminada del catálogo'
                      : m.operational === false ? '⬛ Retirada (fuera de servicio)'
                      : m.en_espera ? '⏳ En espera por recepción'
                      : '✅ Operativa';
                    const quien = (id: any) => (id ? (nameById.get(String(id)) || `ID ${String(id).slice(0, 8)}…`) : null);
                    const fichaRows: [string, string | null][] = [
                      ['Máquina', machineLabel(m) || m.code || null],
                      ['Identificador', m.identifier || null],
                      ['Clase / marca', [m.clasificacion, m.marca, m.modelo].filter(Boolean).join(' · ') || m.tipo || null],
                      ['Empresa', target.empresa],
                      ['Encargado', m.encargado || null],
                      ['Zona / ref.', [m.zona, m.referencia].filter(Boolean).join(' · ') || null],
                      ['Estado AHORA', estadoActual],
                      ['QR', m.qr_blocked ? '🔒 Bloqueado' : '🔓 Normal'],
                      ['Retirada por', quien(m.inactivated_by)],
                      ['Retirada el', m.inactivated_at ? caracasDT(m.inactivated_at) : null],
                      ['Reactivada por', quien(m.reactivated_by)],
                      ['Reactivada el', m.reactivated_at ? caracasDT(m.reactivated_at) : null],
                      ['Horómetro', m.last_horometro != null ? `${m.last_horometro} h` : null],
                    ];
                    const visibles = fichaRows.filter(([, v]) => v != null && String(v).trim() !== '');
                    return (
                      <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs }}>Ficha de la máquina (como está ahora)</Text>
                        {visibles.map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
                        {m.inactivated_by || m.inactivated_at ? (
                          <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4 }}>
                            ℹ️ "Retirada por / el" los guarda la propia ficha de la máquina, aparte de la
                            bitácora: sirven aunque el retiro sea anterior a que se encendiera el seguimiento.
                          </Text>
                        ) : null}
                      </View>
                    );
                  })() : null}

                  {/* CAMBIOS: UPDATE muestra campo + (de → a); INSERT/DELETE muestra la fila. */}
                  {detail.changes && Object.keys(detail.changes).length > 0 ? (
                    <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs }}>
                        {detail.action === 'UPDATE' ? `Cambios (${Object.keys(detail.changes).length})` : detail.action === 'INSERT' ? 'Datos creados' : 'Datos eliminados'}
                      </Text>
                      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                        {Object.entries(detail.changes).map(([k, v]) => (
                          <View key={k} style={{ marginBottom: 5 }}>
                            <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{fieldLabel(k)}</Text>
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
                      ℹ️ Este registro es de antes del 10-ago-2026 (cuando se corrigió el seguimiento de
                      usuario). Las acciones nuevas siempre quedan con quién las hizo.
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

      {/* Menú ▾ "Filtros" (patrón tipo Odoo): Filtrar / Agrupar por / Favoritos. Todo lo
          que se elige aquí se combina en AND con la búsqueda libre y el rango de arriba,
          que quedan intactos. */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setMenuOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' }}>
            {/* Pestañas */}
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {([
                { key: 'filtrar', label: '🔎 Filtrar' },
                { key: 'agrupar', label: '📚 Agrupar por' },
                { key: 'favoritos', label: `⭐ Favoritos${favorites.length ? ` (${favorites.length})` : ''}` },
              ] as const).map((t) => (
                <TouchableOpacity key={t.key} onPress={() => setMenuTab(t.key)} style={{ flex: 1, paddingVertical: spacing.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: menuTab === t.key ? colors.primary : 'transparent' }}>
                  <Text style={{ color: menuTab === t.key ? colors.primary : colors.muted, fontWeight: '800', fontSize: 12 }}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {menuTab === 'filtrar' ? (
                <>
                  {/* Filtros predeterminados: criterios rápidos ya armados, un toque y listo. */}
                  <View>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>FILTROS RÁPIDOS</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      <Chip label="📅 Hoy" on={from === today && to === today} onPress={() => setPreset('hoy')} />
                      <Chip label="🗓️ Esta semana" on={from === weekStartISO(today) && to === today} onPress={() => setPreset('semana')} />
                      <Chip label="🗑️ Solo eliminaciones" on={actionFilter.size === 1 && actionFilter.has('DELETE')}
                        onPress={() => setActionFilter((prev) => (prev.size === 1 && prev.has('DELETE') ? new Set() : new Set(['DELETE'])))} />
                      <Chip label="💰 Solo cambios de dinero" on={moneyOnly} onPress={() => setMoneyOnly((v) => !v)} />
                      <Chip label="🚜 Estados de máquina" on={estadoMaqOnly} onPress={() => setEstadoMaqOnly((v) => !v)} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
                      🚜 «Estados de máquina» = retirada, reactivada, en espera, recibida, eliminada del
                      catálogo y QR bloqueado. «Averiada» y «parada» no salen acá: esas no se guardan en la
                      ficha de la máquina, se deducen de las averías y las jornadas.
                    </Text>
                  </View>

                  {/* Filtros personalizados: se pueden combinar varios módulos/acciones a la vez. */}
                  <View>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>MÓDULO (uno o varios)</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {MODULES.map((m) => <Chip key={m.key} label={`${m.icon} ${m.label}`} on={moduleFilter.has(m.key)} onPress={() => toggleModule(m.key)} />)}
                    </View>
                  </View>

                  <View>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>TIPO DE ACCIÓN (uno o varios)</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {ACTION_BUCKETS.map((b) => <Chip key={b.key} label={b.label} on={actionFilter.has(b.key)} onPress={() => toggleActionBucket(b.key)} />)}
                    </View>
                  </View>

                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    ℹ️ El usuario específico se elige con los chips de "Usuario" debajo de la búsqueda; también queda guardado si armas un favorito.
                  </Text>

                  {(moduleFilter.size > 0 || actionFilter.size > 0 || moneyOnly || estadoMaqOnly) ? (
                    <TouchableOpacity onPress={() => { setModuleFilter(new Set()); setActionFilter(new Set()); setMoneyOnly(false); setEstadoMaqOnly(false); }} style={{ alignSelf: 'flex-start' }}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Limpiar filtros de este menú</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : null}

              {menuTab === 'agrupar' ? (
                <View>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>AGRUPAR RESULTADOS POR</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <Chip label="Sin agrupar (lista)" on={groupBy === 'none'} onPress={() => setGroupBy('none')} />
                    <Chip label="📂 Módulo" on={groupBy === 'modulo'} onPress={() => setGroupBy('modulo')} />
                    <Chip label="👤 Usuario" on={groupBy === 'usuario'} onPress={() => setGroupBy('usuario')} />
                    <Chip label="📅 Día" on={groupBy === 'dia'} onPress={() => setGroupBy('dia')} />
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>
                    Toca el encabezado de cada grupo en la lista para plegarlo/desplegarlo.
                  </Text>
                </View>
              ) : null}

              {menuTab === 'favoritos' ? (
                <>
                  {/* Guarda la combinación ACTUAL (texto + módulos + acciones + usuario + rango
                      + agrupación) con un nombre corto, para aplicarla luego con un toque. */}
                  <View>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>GUARDAR FILTRO ACTUAL</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TextInput value={favName} onChangeText={setFavName} placeholder="Nombre (ej. Eliminaciones de esta semana)" placeholderTextColor={colors.muted}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
                      <TouchableOpacity onPress={saveFavorite} disabled={!favName.trim()} style={{ backgroundColor: favName.trim() ? colors.primary : colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: favName.trim() ? 1 : 0.5 }}>
                        <Text style={{ color: favName.trim() ? colors.primaryContrast : colors.muted, fontWeight: '800', fontSize: 12 }}>💾 Guardar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {favorites.length > 0 ? (
                    <View style={{ gap: spacing.xs }}>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>GUARDADOS EN ESTE DISPOSITIVO</Text>
                      {favorites.map((f) => (
                        <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                          <TouchableOpacity onPress={() => applyFavorite(f)} style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>⭐ {f.name}</Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
                              {f.from === f.to ? dmy(f.from) : `${dmy(f.from)} → ${dmy(f.to)}`}
                              {f.q ? ` · "${f.q}"` : ''}
                              {f.moduleFilter.length ? ` · ${f.moduleFilter.length} módulo(s)` : ''}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteFavorite(f.id)}>
                            <Text style={{ color: colors.danger, fontSize: 16 }}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía no guardaste ningún favorito en este dispositivo.</Text>
                  )}
                </>
              ) : null}
            </ScrollView>

            <TouchableOpacity onPress={() => setMenuOpen(false)} style={{ margin: spacing.lg, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Aplicar / cerrar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
