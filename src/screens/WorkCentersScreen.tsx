// Módulo de Fabricación (MRP) — Fase 2: Centros de trabajo. Administra las
// áreas/máquinas/cuadrillas que se usarán para planificar y costear órdenes
// de manufactura (capacidad, costo de mano de obra y de máquina por hora,
// tiempos de alistamiento/limpieza). Reutiliza el mismo permiso de módulo
// que "Fabricación" (mangueras): no se crea una clave de permiso nueva.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { norm } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { fmtUsd } from '../lib/bcv';
import { WorkCenter, WorkCenterType } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type MachineryRow = { id: string; code: string };

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

const TYPE_INFO: Record<WorkCenterType, { icon: string; label: string }> = {
  maquina: { icon: '🏭', label: 'Máquina' },
  area: { icon: '📍', label: 'Área' },
  cuadrilla: { icon: '👷', label: 'Cuadrilla' },
};

export default function WorkCentersScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const level = moduleLevel('mangueras');

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Centros de trabajo</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  const { data: centers, loading, refetch } = useTable<WorkCenter>('work_centers', { orderBy: 'code', realtimeFrom: ['work_centers'] });
  const { data: machinery } = useTable<MachineryRow>('machinery', { select: 'id, code', orderBy: 'code' });

  const machineryMap = useMemo(() => {
    const m: Record<string, string> = {};
    machinery.forEach((r) => { m[r.id] = r.code; });
    return m;
  }, [machinery]);

  // ── Búsqueda ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const q = norm(query.trim());
  const shown = useMemo(() => {
    return centers.filter((c) => !q || norm(`${c.code} ${c.name}`).includes(q));
  }, [centers, q]);

  // ── Formulario (crear / editar) ────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkCenter | null>(null);
  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (c: WorkCenter) => { if (canWrite) { setEditing(c); setFormOpen(true); } };

  const FIELDS: Field[] = [
    { key: 'code', label: 'Código', type: 'text', required: true },
    { key: 'name', label: 'Nombre', type: 'text', required: true },
    {
      key: 'type', label: 'Tipo', type: 'select', required: true,
      options: [
        { label: '🏭 Máquina', value: 'maquina' },
        { label: '📍 Área', value: 'area' },
        { label: '👷 Cuadrilla', value: 'cuadrilla' },
      ],
    },
    {
      key: 'machinery_id', label: 'Máquina asociada', type: 'lookup', table: 'machinery', labelCol: 'code',
      dropdown: true, showIf: (v) => v.type === 'maquina',
    },
    { key: 'capacity_units_per_hour', label: 'Capacidad (unidades/hora)', type: 'number' },
    { key: 'hourly_cost_labor', label: 'Costo de mano de obra (US$/hora)', type: 'number' },
    { key: 'hourly_cost_machine', label: 'Costo de máquina (US$/hora)', type: 'number' },
    { key: 'setup_minutes', label: 'Minutos de alistamiento (setup)', type: 'number' },
    { key: 'cleanup_minutes', label: 'Minutos de limpieza', type: 'number' },
    {
      // El tipo Field no tiene una variante "boolean": se representa como un
      // select Activo/Inactivo cuyo valor ('true'/'false') Postgres castea al
      // guardar la columna boolean. Si se deja sin elegir al CREAR, no se envía
      // y aplica el default de la BD (true); al EDITAR llega precargado con el
      // valor actual del registro.
      key: 'active', label: 'Estado', type: 'select',
      options: [{ label: '✅ Activo', value: 'true' }, { label: '⛔ Inactivo', value: 'false' }],
    },
  ];

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if (loading && centers.length === 0) {
    return <Screen><Loading /></Screen>;
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>🏗️ Centros de trabajo</SectionTitle>
        {canWrite ? (
          <TouchableOpacity onPress={openNew} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nuevo centro de trabajo</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {centers.length === 0 ? (
        <EmptyState title="Sin registros" subtitle="Aún no se ha registrado ningún centro de trabajo." />
      ) : (
        <>
          <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar por código o nombre…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

          {shown.length === 0 ? (
            <EmptyState title="Sin resultados" subtitle="Prueba con otra búsqueda." />
          ) : (
            shown.map((c) => {
              const info = TYPE_INFO[c.type] ?? TYPE_INFO.area;
              const machLabel = c.machinery_id ? machineryMap[c.machinery_id] : undefined;
              const RowWrapper = canWrite ? TouchableOpacity : View;
              return (
                <RowWrapper key={c.id} {...(canWrite ? { onPress: () => openEdit(c), activeOpacity: 0.75 } : {})}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{info.icon} {c.code} · {c.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {info.label}{machLabel ? ` · 🚜 ${machLabel}` : ''}
                        </Text>
                      </View>
                      <Pill label={c.active ? '✅ Activo' : '⛔ Inactivo'} tone={c.active ? 'success' : 'danger'} colors={colors} />
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
                      <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>
                        👷 {fmtUsd(c.hourly_cost_labor)}/h
                      </Text>
                      <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>
                        🏭 {fmtUsd(c.hourly_cost_machine)}/h
                      </Text>
                      {c.capacity_units_per_hour != null ? (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>⚙️ {c.capacity_units_per_hour} unid./h</Text>
                      ) : null}
                    </View>
                    {(c.setup_minutes || c.cleanup_minutes) ? (
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        Alistamiento {c.setup_minutes ?? 0} min · Limpieza {c.cleanup_minutes ?? 0} min
                      </Text>
                    ) : null}
                  </Card>
                </RowWrapper>
              );
            })
          )}
        </>
      )}

      <RecordForm
        visible={formOpen}
        title={editing ? `Editar centro de trabajo: ${editing.code}` : 'Nuevo centro de trabajo'}
        table="work_centers"
        fields={FIELDS}
        uniqueField={{ key: 'code', labelCol: 'code', labelName: 'código' }}
        record={editing as any}
        autoUserField="created_by"
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
