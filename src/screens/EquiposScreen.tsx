import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Modal, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { captureLocation } from '../lib/location';
import { pickAndUploadPhoto } from '../lib/photo';
import { elapsedSince } from '../lib/time';
import { Machinery, Vehicle, Company } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

type Kind = 'vehiculo' | 'maquinaria' | 'maquinaria pesada';

const KINDS: { value: Kind; label: string; icon: string }[] = [
  { value: 'vehiculo', label: 'Vehículo', icon: '🚗' },
  { value: 'maquinaria', label: 'Maquinaria', icon: '🚜' },
  { value: 'maquinaria pesada', label: 'Maq. pesada', icon: '🏗️' },
];

const VEHICLE_FIELDS: Field[] = [
  { key: 'plate', label: 'Placa', type: 'text', required: true },
  { key: 'brand', label: 'Marca', type: 'text' },
  { key: 'model', label: 'Modelo', type: 'text' },
  { key: 'vehicle_type', label: 'Tipo', type: 'text' },
  { key: 'tank_capacity_l', label: 'Capacidad tanque (L)', type: 'number' },
  { key: 'expected_kml', label: 'Rendimiento (km/L)', type: 'number' },
];

const MACHINERY_FIELDS: Field[] = [
  { key: 'code', label: 'Código / Nombre', type: 'text', required: true },
  { key: 'plate', label: 'Placa', type: 'text' },
  { key: 'serial', label: 'Serial', type: 'text' },
  { key: 'company_id', label: 'Empresa supervisora', type: 'lookup', table: 'companies', labelCol: 'name', createColumn: 'name' },
  { key: 'expected_lph', label: 'Rendimiento (L/h)', type: 'number' },
];

export default function EquiposScreen({ navigation }: any) {
  const { colors } = useTheme();
  const [kind, setKind] = useState<Kind>('vehiculo');

  const vehicles = useTable<Vehicle>('vehicles', { orderBy: 'plate', ascending: true });
  const machinery = useTable<Machinery>('machinery', { orderBy: 'code', ascending: true });
  const companies = useTable<Company>('companies');
  const [query, setQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  const companyName = useMemo(() => {
    const m = new Map(companies.data.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? '' : '');
  }, [companies.data]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isVehicle = kind === 'vehiculo';
  const matchCompany = (m: Machinery) =>
    companyFilter === '__all__'
      ? true
      : companyFilter === '__none__'
      ? !m.company_id
      : m.company_id === companyFilter;
  const baseList = isVehicle
    ? vehicles.data
    : machinery.data.filter((m) => (m.machinery_type ?? 'maquinaria') === kind && matchCompany(m));
  const q = query.trim().toLowerCase();
  const list = !q
    ? baseList
    : (baseList as any[]).filter((it) => {
        const hay = isVehicle
          ? [it.plate, it.brand, it.model, it.vehicle_type]
          : [it.code, it.description, it.plate, it.serial, companyName(it.company_id)];
        return hay.filter(Boolean).some((v: string) => String(v).toLowerCase().includes(q));
      });
  const loading = isVehicle ? vehicles.loading : machinery.loading;
  const refetch = isVehicle ? vehicles.refetch : machinery.refetch;

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: any) => {
    setEditing(item);
    setFormOpen(true);
  };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) setNotice('⚠️ ' + res.error);
    if (res.ok) machinery.refetch();
  };
  const locate = (m: Machinery) => run(m.id + '-loc', () => captureLocation(m.id));
  const photo = (m: Machinery) => run(m.id + '-photo', () => pickAndUploadPhoto(m.id));
  const toggleOp = (m: Machinery) =>
    run(m.id + '-op', async () => {
      const { error } = await supabase.from('machinery').update({ operational: !m.operational }).eq('id', m.id);
      return { ok: !error, error: error?.message };
    });

  const saveBatch = async () => {
    setBatchError(null);
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setBatchError('Pega al menos un equipo (uno por línea).');
      return;
    }
    setBatchBusy(true);

    // La clave única es la PLACA (vehículos) o el CÓDIGO (maquinaria).
    // Se omiten duplicados dentro del lote y los que ya existen en la BD.
    const table = isVehicle ? 'vehicles' : 'machinery';
    const keyCol = isVehicle ? 'plate' : 'code';

    // 1) Construir filas a partir de cada línea (separadores: coma, tab o ;)
    type Row = { key: string; data: Record<string, any> };
    const rows: Row[] = lines
      .map((l) => {
        const [a, b, c] = l.split(/[,\t;]/).map((s) => s.trim());
        if (isVehicle) {
          // placa, marca, modelo
          const plate = a;
          if (!plate) return null;
          return { key: plate.toLowerCase(), data: { plate, brand: b || null, model: c || null } };
        }
        // nombre, placa, serial  →  código único = "nombre placa"
        const name = a;
        if (!name) return null;
        const plate = b || null;
        const code = (plate ? `${name} ${plate}` : name).trim();
        return {
          key: code.toLowerCase(),
          data: { code, description: name, plate, serial: c || null, machinery_type: kind },
        };
      })
      .filter(Boolean) as Row[];

    // 2) Quitar duplicados dentro del mismo lote (por la clave única)
    const seen = new Set<string>();
    const uniq = rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));

    // 3) Insertar con ON CONFLICT DO NOTHING: los que ya existen se omiten
    //    automáticamente (sin error 409). .select() devuelve solo los nuevos.
    const { data: inserted, error } = await supabase
      .from(table)
      .upsert(
        uniq.map((r) => r.data),
        { onConflict: keyCol, ignoreDuplicates: true }
      )
      .select(keyCol);
    setBatchBusy(false);
    if (error) {
      const msg = `${error.message} ${(error as any).details ?? ''}`.toLowerCase();
      if (msg.includes('uq_machinery_serial') || (msg.includes('serial') && msg.includes('duplicate'))) {
        setBatchError('YA EXISTE una máquina con uno de esos seriales. Revisa el lote y quita los repetidos.');
      } else {
        setBatchError(`${error.message}${(error as any).details ? ' — ' + (error as any).details : ''}`);
      }
      return;
    }

    const added = inserted?.length ?? 0;
    const omitted = rows.length - added;
    setBatchText('');
    setBatchOpen(false);
    setNotice(
      `✅ Lote cargado: se agregaron ${added} equipo(s).` + (omitted > 0 ? ` Omitidos por duplicado: ${omitted}.` : '')
    );
    refetch();
  };

  const kindMeta = KINDS.find((k) => k.value === kind)!;

  const BigBtn = ({ label, onPress, color, disabled }: any) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flexGrow: 1,
        flexBasis: 100,
        minHeight: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color,
        opacity: disabled ? 0.6 : 1,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Catálogo maquinaria/vehículos</SectionTitle>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {/* Selector de tipo (uno al lado del otro, selección única) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
        {KINDS.map((k) => {
          const active = k.value === kind;
          return (
            <TouchableOpacity
              key={k.value}
              onPress={() => setKind(k.value)}
              style={{
                flexGrow: 1,
                flexBasis: 100,
                minHeight: 60,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: spacing.sm,
              }}
            >
              <Text style={{ fontSize: 22 }}>{k.icon}</Text>
              <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>
                {k.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TouchableOpacity
          style={{ flex: 2, backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' }}
          onPress={openNew}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>
            {kindMeta.icon}  + Agregar
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' }}
          onPress={() => {
            setBatchError(null);
            setBatchOpen(true);
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>📋 Lote</Text>
        </TouchableOpacity>
      </View>

      {!isVehicle ? (
        <TouchableOpacity
          onPress={() => navigation.navigate('Map')}
          style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>🗺️  Ver mapa de máquinas</Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ marginTop: spacing.sm }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={isVehicle ? '🔎 Buscar por placa, marca…' : '🔎 Buscar por código, placa, serial o empresa…'}
          placeholderTextColor={colors.muted}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
        />
        {q ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{list.length} resultado(s)</Text>
        ) : null}
      </View>

      {/* Filtro por empresa (solo maquinaria) */}
      {!isVehicle ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Filtrar por empresa</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {[
                { label: 'Todas', value: '__all__' },
                ...companies.data
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => ({ label: c.name, value: c.id })),
                { label: 'Sin empresa', value: '__none__' },
              ].map((c) => {
                const active = companyFilter === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    onPress={() => setCompanyFilter(c.value)}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }}
                  >
                    <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          {companyFilter !== '__all__' ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{list.length} resultado(s)</Text>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : `Sin ${kindMeta.label.toLowerCase()}`} subtitle={q ? 'Prueba con otra búsqueda.' : 'Agrega tu primer equipo con el botón de arriba.'} />
      ) : isVehicle ? (
        (list as Vehicle[]).map((v) => (
          <TouchableOpacity key={v.id} onPress={() => openEdit(v)} activeOpacity={0.7}>
            <Card>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 17 }}>{v.plate}</Text>
              {v.brand || v.model ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>{`${v.brand ?? ''} ${v.model ?? ''}`.trim()}</Text>
              ) : null}
              {v.vehicle_type ? <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo: {v.vehicle_type}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Toca para editar</Text>
            </Card>
          </TouchableOpacity>
        ))
      ) : (
        (list as Machinery[]).map((m) => (
          <Card key={m.id}>
            <TouchableOpacity onPress={() => openEdit(m)} activeOpacity={0.7}>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                {m.photo_url ? (
                  <Image source={{ uri: m.photo_url }} style={{ width: 64, height: 64, borderRadius: radius.md }} />
                ) : (
                  <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 28 }}>{kindMeta.icon}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 17 }}>{m.code}</Text>
                    <Text style={{ color: m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 13 }}>
                      {m.operational ? '● Operativa' : '● No operativa'}
                    </Text>
                  </View>
                  {m.plate ? <Text style={{ color: colors.muted, fontSize: 12 }}>Placa: {m.plate}</Text> : null}
                  {m.serial ? <Text style={{ color: colors.muted, fontSize: 12 }}>Serial: {m.serial}</Text> : null}
                  {m.latitude != null ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📍 {m.latitude}, {m.longitude} · {elapsedSince(m.location_at)}</Text>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Sin ubicación</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
              <BigBtn label={busy === m.id + '-loc' ? 'Ubicando…' : '📍 Ubicación'} onPress={() => locate(m)} color="#2563EB" disabled={busy === m.id + '-loc'} />
              <BigBtn label={busy === m.id + '-photo' ? 'Subiendo…' : '📷 Foto'} onPress={() => photo(m)} color={colors.primary} disabled={busy === m.id + '-photo'} />
              <BigBtn label={m.operational ? '⛔ Inactiva' : '✅ Operativa'} onPress={() => toggleOp(m)} color={m.operational ? colors.danger : colors.success} disabled={busy === m.id + '-op'} />
            </View>
          </Card>
        ))
      )}

      {/* Carga por lote: pegar varias líneas */}
      <Modal visible={batchOpen} animationType="slide" transparent onRequestClose={() => setBatchOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 18, marginBottom: spacing.xs }}>
              Cargar {kindMeta.label.toLowerCase()} por lote
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Pega una por línea. Opcional: {isVehicle ? 'placa, marca, modelo' : 'código, placa, serial'} separados por coma.
            </Text>
            <ScrollView style={{ maxHeight: 240 }}>
              <TextInput
                value={batchText}
                onChangeText={setBatchText}
                multiline
                placeholder={isVehicle ? 'ABC123\nXYZ789, Toyota, Hilux' : 'RETRO-01\nVOLVO-02, PBA123, SER-998'}
                placeholderTextColor={colors.muted}
                style={{ minHeight: 160, textAlignVertical: 'top', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
              />
            </ScrollView>
            {batchError ? (
              <View style={{ backgroundColor: '#FEE2E2', borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: '#B91C1C', fontSize: 13, fontWeight: '600' }}>Error: {batchError}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setBatchOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={saveBatch} disabled={batchBusy}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{batchBusy ? 'Guardando…' : 'Guardar lote'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <RecordForm
        visible={formOpen}
        title={editing ? `Editar ${kindMeta.label.toLowerCase()}` : `Nuevo: ${kindMeta.label}`}
        table={isVehicle ? 'vehicles' : 'machinery'}
        fields={isVehicle ? VEHICLE_FIELDS : MACHINERY_FIELDS}
        fixedValues={isVehicle ? undefined : { machinery_type: kind }}
        uniqueField={isVehicle ? undefined : { key: 'serial', labelCol: 'code', labelName: 'serial' }}
        record={editing}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />
    </Screen>
  );
}
