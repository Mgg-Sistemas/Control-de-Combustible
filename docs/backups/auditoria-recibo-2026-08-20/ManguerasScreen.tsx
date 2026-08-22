// Módulo de Fabricación (MRP) — Fase 1: Control y confección de mangueras
// hidráulicas (Taller). Registra cada manguera hecha/reparada para la flota:
// código físico, máquina, descripción del trabajo, costo, proveedor, si ya
// está instalada y el estado de autorización de pago (lo aprueba "Chelia",
// vía el nivel de permiso FULL sobre este módulo).
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useBcvRate, bsFromUsd, fmtUsd, fmtBs } from '../lib/bcv';
import { HoseService, HoseInstallStatus, HosePaymentStatus, Encargado, HoseEmpresa } from '../types/database';
import { generateHoseServiceReport, generateHoseAuthorization } from '../lib/hoseServiceReport';
import { generateReciboCobro } from '../lib/reciboCobro';
import { machineLabel as etiquetaMaquina } from '../lib/machineLabel';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';

type MachineryRow = { id: string; code: string; serial: string | null; plate: string | null; tipo: string | null; company_id: string | null; encargado: string | null; operational: boolean };
type ProfileRow = { id: string; full_name: string | null };
type CompanyRow = { id: string; name: string | null };

type Tone = 'info' | 'warning' | 'danger' | 'success';
function toneSoft(colors: any, tone: Tone) {
  switch (tone) {
    case 'success': return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText };
    case 'warning': return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    case 'danger': return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    default: return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
  }
}
function Pill({ label, tone, colors }: { label: string; tone: Tone; colors: any }) {
  const t = toneSoft(colors, tone);
  return (
    <View style={{ backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

const INSTALL_INFO: Record<HoseInstallStatus, { label: string; tone: Tone }> = {
  en_proceso: { label: '🟡 En proceso', tone: 'warning' },
  instalada: { label: '🟢 Instalada', tone: 'success' },
};
const PAYMENT_INFO: Record<HosePaymentStatus, { label: string; tone: Tone }> = {
  pendiente: { label: '⏳ Pendiente', tone: 'warning' },
  en_proceso_autorizacion: { label: '📤 Pendiente por autorización', tone: 'info' },
  pagado: { label: '✅ Pagado', tone: 'success' },
};

const INSTALL_FILTERS: { key: '' | HoseInstallStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'en_proceso', label: '🟡 En proceso' },
  { key: 'instalada', label: '🟢 Instalada' },
];
const PAYMENT_FILTERS: { key: '' | HosePaymentStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'pendiente', label: '⏳ Pendiente' },
  { key: 'en_proceso_autorizacion', label: '📤 Pendiente por autorización' },
  { key: 'pagado', label: '✅ Pagado' },
];

const fmtFecha = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
};

export default function ManguerasScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { moduleLevel } = useAuth();
  const level = moduleLevel('mangueras');

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Fabricación (Taller)</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');
  // "Chelia": solo el nivel FULL puede aprobar y marcar como pagado.
  const canApprove = levelMeets(level, 'full');

  const { data: hoses, loading, refetch } = useTable<HoseService>('hose_services', { orderBy: 'service_date', ascending: false, realtimeFrom: 'hose_services' });
  const { data: machinery } = useTable<MachineryRow>('machinery', { select: 'id, code, serial, plate, tipo, company_id, encargado, operational', orderBy: 'code', realtimeFrom: 'machinery' });
  const { data: profiles } = useTable<ProfileRow>('profiles', { select: 'id, full_name', realtimeFrom: 'profiles' });
  const { data: companies } = useTable<CompanyRow>('companies', { select: 'id, name', orderBy: 'name' });
  const { data: encargados } = useTable<Encargado>('encargados', { orderBy: 'name' });
  // Empresas a cobrar: LISTA PROPIA de mangueras (no el catálogo companies).
  const { data: hoseEmpresas } = useTable<HoseEmpresa>('hose_empresas', { orderBy: 'name' });
  const { rate: bcvRate } = useBcvRate();

  const hoseEmpresasMap = useMemo(() => {
    const m: Record<string, string> = {};
    hoseEmpresas.forEach((e) => { if (e.id) m[e.id] = e.name || '—'; });
    return m;
  }, [hoseEmpresas]);

  const companiesMap = useMemo(() => {
    const m: Record<string, string> = {};
    companies.forEach((c) => { if (c.id) m[c.id] = c.name || '—'; });
    return m;
  }, [companies]);
  const machineryMap = useMemo(() => {
    const m: Record<string, { code: string; serial: string | null; plate: string | null; tipo: string | null; encargado: string | null; companyName: string | null; operational: boolean }> = {};
    machinery.forEach((r) => { m[r.id] = { code: r.code, serial: r.serial, plate: r.plate, tipo: r.tipo, encargado: r.encargado, companyName: r.company_id ? (companiesMap[r.company_id] ?? null) : null, operational: r.operational }; });
    return m;
  }, [machinery, companiesMap]);
  const profilesMap = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => { m[p.id] = p.full_name || 'Usuario'; });
    return m;
  }, [profiles]);
  const encargadosMap = useMemo(() => {
    const m: Record<string, Encargado> = {};
    encargados.forEach((e) => { if (e.id) m[e.id] = e; });
    return m;
  }, [encargados]);

  // ── Filtros ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [installFilter, setInstallFilter] = useState<'' | HoseInstallStatus>('');
  const [paymentFilter, setPaymentFilter] = useState<'' | HosePaymentStatus>('');
  // Origen: '' todas · 'flota' solo máquinas internas · 'externa' solo externas.
  const [originFilter, setOriginFilter] = useState<'' | 'flota' | 'externa'>('');
  const [machineFilterId, setMachineFilterId] = useState('');
  const [machineOpen, setMachineOpen] = useState(false);
  const [machineQuery, setMachineQuery] = useState('');

  const machineFilterInfo = machineFilterId ? machineryMap[machineFilterId] : undefined;
  // Con placa/serial: hay tres maquinas llamadas "RETROEXCAVADORA" y este label
  // encabeza el PDF de gasto en mangueras imputado a UNA de ellas.
  const machineFilterLabel = etiquetaMaquina(machineFilterInfo) || undefined;

  const machineOptions = useMemo(() => {
    const q = norm(machineQuery);
    const withInfo = machinery.map((m) => ({ ...m, companyName: m.company_id ? (companiesMap[m.company_id] ?? '') : '' }));
    const list = q
      ? withInfo.filter((m) => norm(`${m.code} ${m.serial ?? ''} ${m.plate ?? ''} ${m.tipo ?? ''} ${m.companyName} ${m.encargado ?? ''}`).includes(q))
      : withInfo;
    return list.slice().sort((a, b) => cmpText(a.code, b.code)).slice(0, 30);
  }, [machinery, machineQuery, companiesMap]);

  const q = norm(query.trim());
  const shown = useMemo(() => {
    return hoses
      .filter((h) => !q || norm(`${h.code} ${h.description ?? ''} ${h.provider ?? ''} ${h.external_client ?? ''}`).includes(q))
      .filter((h) => !installFilter || h.install_status === installFilter)
      .filter((h) => !paymentFilter || h.payment_status === paymentFilter)
      .filter((h) => !originFilter || (originFilter === 'externa' ? !!h.is_external : !h.is_external))
      .filter((h) => !machineFilterId || h.machinery_id === machineFilterId);
  }, [hoses, q, installFilter, paymentFilter, originFilter, machineFilterId]);

  // ── Totales / inversión (sobre la lista FILTRADA actual) ──────────────────
  const totals = useMemo(() => {
    const total = shown.reduce((s, h) => s + (Number(h.cost_usd) || 0), 0);
    return { count: shown.length, total };
  }, [shown]);

  // ── Formulario (crear / editar) ────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HoseService | null>(null);
  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (h: HoseService) => { setEditing(h); setFormOpen(true); };

  // El campo `install_status` se arma aparte (ver abajo): si la manguera ya está
  // pagada, NO se deja como `select` editable (evita "desinstalarla" por accidente
  // desde el formulario normal); se muestra como texto fijo informativo.
  const installStatusField: Field = editing?.payment_status === 'pagado'
    ? {
        key: 'install_status_locked', type: 'section',
        label: `Estado de instalación: ${INSTALL_INFO[editing.install_status]?.label ?? editing.install_status} (bloqueado: ya está pagada, no se puede editar aquí)`,
      }
    : {
        key: 'install_status', label: 'Estado de instalación', type: 'select',
        options: [{ label: 'En proceso', value: 'en_proceso' }, { label: 'Instalada', value: 'instalada' }],
      };

  // El "Código de la fabricación" ya NO lo escribe el usuario: lo asigna la BASE
  // automáticamente como correlativo de 4 dígitos (0001, 0002…). Al crear se muestra un
  // aviso; al editar, el código ya asignado en modo solo lectura (no editable).
  const codeField: Field = editing
    ? { key: 'code_locked', type: 'section', label: `🔖 Código de la fabricación: ${editing.code ?? '—'} (automático · no editable)` }
    : { key: 'code_info', type: 'section', label: '🔖 Código de la fabricación: se asigna automático (0001, 0002…) al guardar.' };

  const FIELDS: Field[] = [
    codeField,
    // Fabricación para una máquina/empresa EXTERNA (fuera de la flota): si se activa,
    // se oculta el selector de máquina interna y se escribe libremente el nombre de la
    // máquina o empresa externa. Por defecto OFF (lo normal: máquina de la flota).
    { key: 'is_external', label: '🏭 Es para una máquina o empresa EXTERNA (fuera de la flota)', type: 'switch', defaultValue: false },
    // `activeCol: 'operational'` marca con "(Inactiva)" las máquinas dadas de baja
    // en la lista, SIN ocultarlas (el historial de mangueras de una máquina inactiva
    // debe seguir siendo consultable/asignable si hiciera falta).
    { key: 'machinery_id', label: 'Máquina', type: 'lookup', table: 'machinery', labelCol: 'code', subLabelCols: ['serial', 'plate', 'encargado'], activeCol: 'operational', dropdown: true, required: true, showIf: (v) => v.is_external !== 'true' },
    // Solo cuando es externa: nombre libre de la máquina o empresa (no está en la flota).
    { key: 'external_client', label: 'Máquina / empresa externa', type: 'text', required: true, placeholder: 'Nombre de la máquina o empresa externa', showIf: (v) => v.is_external === 'true' },
    { key: 'description', label: 'Descripción del trabajo', type: 'textarea', placeholder: 'Detalle del trabajo realizado…' },
    { key: 'service_date', label: 'Fecha', type: 'date', required: true, defaultValue: new Date().toISOString().slice(0, 10) },
    { key: 'cost_usd', label: 'Costo (US$)', type: 'number', required: true },
    // Proveedor REAL del catálogo (antes texto libre). Es a quién se le paga y con
    // eso se genera la CUENTA POR PAGAR automática (trigger en BD). Se puede crear
    // uno nuevo escribiéndolo. Obligatorio: cada manguera queda ligada a un proveedor.
    { key: 'supplier_id', label: 'Proveedor (a quién se le paga)', type: 'lookup', table: 'suppliers', labelCol: 'name', createColumn: 'name', dropdown: true, required: true },
    // Cuenta POR COBRAR: empresa + encargado a quien se le cobra la manguera y el
    // margen de venta. Aplica a mangueras de flota Y externas (se piden siempre). La
    // BD genera la cuenta 'por_cobrar' (trigger), salvo que el encargado sea CHELI
    // (cobrar=false) o falte empresa/encargado.
    // Empresa a cobrar de la LISTA PROPIA de mangueras (hose_empresas): se puede
    // agregar una nueva escribiéndola (createColumn) SIN que entre al catálogo companies.
    { key: 'hose_empresa_id', label: 'Empresa a cobrar', type: 'lookup', table: 'hose_empresas', labelCol: 'name', createColumn: 'name', dropdown: true, required: true },
    { key: 'encargado_id', label: 'Encargado (a quién se le cobra)', type: 'lookup', table: 'encargados', labelCol: 'name', createColumn: 'name', dropdown: true, required: true },
    { key: 'sale_margin_pct', label: 'Margen de cobro (%)', type: 'number', defaultValue: '30' },
    { key: 'cobro_info', type: 'section', label: 'ℹ️ Monto a cobrar = costo + margen. Si el encargado es CHELI, NO se genera cuenta por cobrar.' },
    installStatusField,
  ];

  // payment_status/approved_by/approved_at NUNCA se editan desde este formulario
  // (solo mediante los botones de acción de abajo), así el flujo de aprobación
  // no se puede saltar editando el registro. `fixedValues` con payment_status
  // 'pendiente' se aplica SOLO al crear: si se pasara también al editar,
  // RecordForm lo re-aplicaría en cada guardado y resetearía el estado de pago
  // de una manguera ya enviada a autorización o pagada.
  const formFixedValues = editing ? undefined : { payment_status: 'pendiente' as HosePaymentStatus };

  // ── Acciones por fila ──────────────────────────────────────────────────
  const [busy, setBusy] = useState<string | null>(null);

  const marcarInstalada = async (h: HoseService) => {
    setBusy(h.id + '-install');
    await supabase.from('hose_services').update({ install_status: 'instalada' }).eq('id', h.id);
    setBusy(null);
    refetch();
  };
  const enviarAutorizacion = async (h: HoseService) => {
    setBusy(h.id + '-auth');
    await supabase.from('hose_services').update({ payment_status: 'en_proceso_autorizacion' }).eq('id', h.id);
    setBusy(null);
    refetch();
  };
  const aprobarPago = async (h: HoseService) => {
    // No se puede pagar una manguera que aún no está instalada (evita pagar un
    // trabajo que nunca se llegó a hacer). El botón ya se oculta en ese caso, pero
    // se valida también aquí por si el estado cambió justo antes de pulsar.
    if (h.install_status !== 'instalada') {
      toast.error('No se puede pagar una manguera que no está instalada.');
      return;
    }
    setBusy(h.id + '-approve');
    const { data } = await supabase.auth.getUser();
    await supabase.from('hose_services').update({
      payment_status: 'pagado',
      approved_by: data.user?.id ?? null,
      approved_at: new Date().toISOString(),
    }).eq('id', h.id);
    setBusy(null);
    refetch();
  };
  // 🗑️ Eliminar una manguera que AÚN NO fue aprobada/pagada (payment_status != 'pagado').
  // Una vez pagada NO se puede borrar (queda como registro contable). Antes de borrar el
  // hose_service se elimina su cuenta ligada NO pagada — el FK es `on delete set null`, así
  // que sin esto la cuenta quedaría huérfana (pendiente por pagar/cobrar sin manguera).
  const eliminarManguera = async (h: HoseService) => {
    if (h.payment_status === 'pagado') { toast.error('No se puede eliminar: ya fue aprobada/pagada.'); return; }
    const ok = await confirm({ title: 'Eliminar manguera', message: `¿Eliminar "${h.code || 'manguera'}"? Se borrará también su cuenta pendiente asociada. No se puede deshacer.`, confirmText: 'Eliminar', danger: true });
    if (!ok) return;
    setBusy(h.id + '-del');
    await supabase.from('cuentas').delete().eq('hose_service_id', h.id).neq('estado', 'pagada');
    const { error } = await supabase.from('hose_services').delete().eq('id', h.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Manguera eliminada.');
    refetch();
  };

  // ── Reporte PDF ──────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const exportarReporte = async () => {
    setExporting(true);
    try {
      await generateHoseServiceReport({
        rows: shown,
        machineryMap,
        profilesMap,
        bcvRate,
        machineFilterLabel,
      });
    } finally {
      setExporting(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ flexGrow: 1, flexBasis: 110, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: color, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  if (loading && hoses.length === 0) {
    return <Screen><Loading /></Screen>;
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>🔧 Fabricación (Taller)</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={openNew} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nueva fabricación</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {hoses.length === 0 ? (
        <EmptyState title="Sin registros" subtitle="Aún no se ha registrado ninguna fabricación." />
      ) : (
        <>
          {/* Filtro y consulta por equipo — trazabilidad de mangueras por máquina */}
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🚜 Filtro y consulta por equipo</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Busca una máquina para ver todas las fabricaciones hechas para ella.</Text>
            <TouchableOpacity onPress={() => setMachineOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>
                {machineFilterId ? `Equipo: ${machineFilterLabel ?? '—'}` : 'Todos los equipos'}
                {/* La máquina dada de baja se puede seguir consultando (no se oculta),
                    pero se avisa con un badge para no confundirla con una activa. */}
                {machineFilterId && machineFilterInfo && !machineFilterInfo.operational ? '  ⛔ Inactiva' : ''}
              </Text>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>{machineOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {machineFilterId ? (
              <TouchableOpacity onPress={() => { setMachineFilterId(''); setMachineQuery(''); }} style={{ alignSelf: 'flex-start', marginTop: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Quitar filtro</Text>
              </TouchableOpacity>
            ) : null}
            {machineOpen ? (
              <View style={{ marginTop: spacing.xs }}>
                <TextInput value={machineQuery} onChangeText={setMachineQuery} placeholder="🔎 Buscar por código, serial, placa, tipo, empresa o encargado…" placeholderTextColor={colors.muted} style={input} />
                <View style={{ maxHeight: 240, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  {machineOptions.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Sin resultados.</Text>
                  ) : machineOptions.map((m) => (
                    <TouchableOpacity key={m.id} onPress={() => { setMachineFilterId(m.id); setMachineOpen(false); setMachineQuery(''); }} style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{m.code}</Text>
                        {/* Máquinas de baja/inactivas se siguen mostrando (el historial de
                            mangueras debe poder consultarse), solo se marcan con un badge. */}
                        {!m.operational ? <Pill label="⛔ Inactiva" tone="danger" colors={colors} /> : null}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{[m.serial ? `Serial ${m.serial}` : '', m.plate ? `Placa ${m.plate}` : ''].filter(Boolean).join(' · ') || '—'}</Text>
                      {m.companyName ? <Text style={{ color: colors.muted, fontSize: 11 }}>🏢 {m.companyName}</Text> : null}
                      {m.encargado ? <Text style={{ color: colors.muted, fontSize: 11 }}>👤 {m.encargado}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
          </Card>

          <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar por código, descripción o proveedor…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

          {/* Origen: separa las fabricaciones de la FLOTA de las de máquinas/empresas
              EXTERNAS. Al elegir "Externas" se quita el filtro por equipo (las externas
              no tienen máquina de la flota). */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
            {([{ key: '', label: 'Todas' }, { key: 'flota', label: '🚜 Flota' }, { key: 'externa', label: '🏭 Externas' }] as const).map((f) => {
              const on = originFilter === f.key;
              return (
                <TouchableOpacity key={f.key || 'all'} onPress={() => { setOriginFilter(f.key); if (f.key === 'externa') { setMachineFilterId(''); setMachineQuery(''); } }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
            {INSTALL_FILTERS.map((f) => {
              const on = installFilter === f.key;
              return (
                <TouchableOpacity key={f.key || 'all'} onPress={() => setInstallFilter(f.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            {PAYMENT_FILTERS.map((f) => {
              const on = paymentFilter === f.key;
              return (
                <TouchableOpacity key={f.key || 'all'} onPress={() => setPaymentFilter(f.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Total invertido en el filtro actual */}
          <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
              {machineFilterId ? `TOTAL INVERTIDO EN ${(machineFilterLabel ?? '').toUpperCase()}` : 'TOTAL INVERTIDO (FILTROS ACTUALES)'}
            </Text>
            <Text style={{ color: colors.brandContrast, fontSize: 20, fontWeight: '900' }}>
              {fmtUsd(totals.total)}{bcvRate ? ` · ${fmtBs(bsFromUsd(totals.total, bcvRate))}` : ''}
            </Text>
            <Text style={{ color: colors.brandContrast, opacity: 0.75, fontSize: 12, marginTop: 2 }}>{totals.count} registro(s)</Text>
          </View>

          {shown.length > 0 ? (
            <TouchableOpacity onPress={exportarReporte} disabled={exporting} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: exporting ? 0.6 : 1 }}>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>{exporting ? 'Generando…' : '📄 Reporte de confección y pago'}</Text>
            </TouchableOpacity>
          ) : null}

          {shown.length === 0 ? (
            <EmptyState title="Sin resultados" subtitle="Prueba con otra búsqueda o quita algún filtro." />
          ) : (
            shown.map((h) => {
              const mach = h.machinery_id ? machineryMap[h.machinery_id] : undefined;
              // Externa: se muestra el nombre libre (máquina/empresa fuera de la flota).
              const machLabel = h.is_external
                ? `🏭 ${h.external_client || 'Externa'} · Externa (fuera de la flota)`
                : (mach ? [mach.code, mach.serial ? `Serial ${mach.serial}` : '', mach.plate ? `Placa ${mach.plate}` : '', mach.companyName ? `🏢 ${mach.companyName}` : '', mach.encargado ? `👤 ${mach.encargado}` : ''].filter(Boolean).join(' · ') : '—');
              const installInfo = INSTALL_INFO[h.install_status] ?? INSTALL_INFO.en_proceso;
              const paymentInfo = PAYMENT_INFO[h.payment_status] ?? PAYMENT_INFO.pendiente;
              const registradoPor = h.created_by ? (profilesMap[h.created_by] || 'Usuario') : 'Usuario';
              const aprobadoPor = h.approved_by ? (profilesMap[h.approved_by] || 'Usuario') : null;
              return (
                <Card key={h.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{h.code}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {machLabel}</Text>
                    </View>
                    <View style={{ gap: 4, alignItems: 'flex-end' }}>
                      <Pill label={installInfo.label} tone={installInfo.tone} colors={colors} />
                      <Pill label={paymentInfo.label} tone={paymentInfo.tone} colors={colors} />
                    </View>
                  </View>

                  {h.description ? <Text style={{ color: colors.text, fontSize: 13 }}>{h.description}</Text> : null}

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📅 {fmtFecha(h.service_date)}</Text>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                      {fmtUsd(h.cost_usd)}{bcvRate ? ` · ${fmtBs(bsFromUsd(h.cost_usd, bcvRate))}` : ''}
                    </Text>
                  </View>
                  {h.provider ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏭 {h.provider}</Text> : null}
                  {/* La cuenta por pagar se genera/sincroniza sola en la BD (trigger). */}
                  {h.supplier_id && (Number(h.cost_usd) || 0) > 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 11 }}>🧾 Cuenta por pagar {h.payment_status === 'pagado' ? 'saldada' : 'generada'} en Cuentas ({fmtUsd(h.cost_usd)})</Text>
                  ) : null}

                  <Text style={{ color: colors.muted, fontSize: 11 }}>Registrado por {registradoPor} el {fmtFecha(h.created_at)}</Text>
                  {aprobadoPor ? (
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Aprobado por {aprobadoPor} el {fmtFecha(h.approved_at)}</Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                    {canWrite ? (
                      <>
                        <Btn label="✏️ Editar" color="#475569" onPress={() => openEdit(h)} />
                        {h.install_status === 'en_proceso' ? (
                          <Btn label="🔧 Marcar instalada" color="#0EA5E9" disabled={busy === h.id + '-install'} onPress={() => marcarInstalada(h)} />
                        ) : null}
                        {h.payment_status === 'pendiente' ? (
                          <Btn label="📤 Enviar a autorización" color="#D97706" disabled={busy === h.id + '-auth'} onPress={() => enviarAutorizacion(h)} />
                        ) : null}
                        {/* Eliminar: solo mientras NO haya sido aprobada/pagada. */}
                        {h.payment_status !== 'pagado' ? (
                          <Btn label="🗑️ Eliminar" color="#B91C1C" disabled={busy === h.id + '-del'} onPress={() => eliminarManguera(h)} />
                        ) : null}
                      </>
                    ) : null}
                    {/* No se puede aprobar el pago de una manguera que aún no está
                        instalada (el botón se oculta; aprobarPago() también valida
                        esto por si acaso). */}
                    {canApprove && h.payment_status !== 'pagado' && h.install_status === 'instalada' ? (
                      <Btn label="✅ Aprobar y marcar pagado" color="#059669" disabled={busy === h.id + '-approve'} onPress={() => aprobarPago(h)} />
                    ) : null}
                    {/* PDF de autorización con la firma del Director General (Jesús Lozada):
                        para enviárselo a autorizar (pendiente) o como constancia (ya pagado). */}
                    {h.payment_status !== 'pendiente' ? (
                      <Btn label="📄 Autorización (PDF)" color="#1D4ED8" disabled={busy === h.id + '-pdf'} onPress={async () => {
                        setBusy(h.id + '-pdf');
                        try {
                          const label = h.is_external ? (h.external_client || 'Externa') : (mach?.code || '—');
                          await generateHoseAuthorization({ hose: h, machineLabel: label, bcvRate });
                        } finally { setBusy(null); }
                      }} />
                    ) : null}
                    {/* Recibo de cobro (PDF): solo si la manguera es cobrable — tiene
                        empresa + encargado y el encargado NO es CHELI (cobrar !== false). */}
                    {(() => {
                      const enc = h.encargado_id ? encargadosMap[h.encargado_id] : undefined;
                      const cobrable = !!h.hose_empresa_id && !!h.encargado_id && (enc ? enc.cobrar !== false : false);
                      if (!cobrable) return null;
                      return (
                        <Btn label="🧾 Recibo de cobro" color="#7C3AED" disabled={busy === h.id + '-recibo'} onPress={async () => {
                          setBusy(h.id + '-recibo');
                          try {
                            await generateReciboCobro({
                              hose: h,
                              companyName: (h.hose_empresa_id ? hoseEmpresasMap[h.hose_empresa_id] : '') || '—',
                              encargadoName: enc?.name || '—',
                              machineLabel: h.is_external
                                ? `${h.external_client || 'Externa'} (externa, fuera de la flota)`
                                : (mach ? [mach.code, mach.serial ? `Serial ${mach.serial}` : ''].filter(Boolean).join(' · ') : '—'),
                            });
                          } finally { setBusy(null); }
                        }} />
                      );
                    })()}
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? `Editar fabricación: ${editing.code}` : 'Nueva fabricación'}
        table="hose_services"
        fields={FIELDS}
        fixedValues={formFixedValues}
        record={editing as any}
        autoUserField="created_by"
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
