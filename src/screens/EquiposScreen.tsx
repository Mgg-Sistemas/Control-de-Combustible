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
import { exportPdf } from '../lib/pdf';
import { COMPANY_NAME, COMPANY_RIF } from '../lib/company';
import { workedHours } from './ControlMaquinariaScreen';
import { Machinery, Vehicle, Company } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

type FuelRow = { date: string; liters: number; tank: string };

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
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // empresa → desplegada

  // Traza de combustible por máquina
  const [fuelFor, setFuelFor] = useState<Machinery | null>(null);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelTrace, setFuelTrace] = useState<FuelRow[]>([]);
  const [fuelSurtido, setFuelSurtido] = useState(0);
  const [fuelWorked, setFuelWorked] = useState(0);
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

  // ── Traza de combustible (surtido) por máquina ───────────────────────────────
  const fuelConsumed = fuelFor?.expected_lph != null ? fuelWorked * Number(fuelFor.expected_lph) : null;
  const fuelLast = fuelTrace[0]?.date ?? null;

  const openFuel = async (m: Machinery) => {
    setFuelFor(m);
    setFuelLoading(true);
    setFuelTrace([]);
    setFuelSurtido(0);
    setFuelWorked(0);
    const [{ data: disp }, { data: rnd }] = await Promise.all([
      supabase.from('dispatches').select('dispatch_date, liters, tank:tank_id(name)').eq('machinery_id', m.id).order('dispatch_date', { ascending: false }),
      supabase.from('machine_rounds').select('round_date, status, hours_stopped').eq('machinery_id', m.id),
    ]);
    const trace: FuelRow[] = (disp ?? []).map((d: any) => ({ date: d.dispatch_date, liters: Number(d.liters) || 0, tank: d.tank?.name ?? '' }));
    const surtido = trace.reduce((s, t) => s + t.liters, 0);
    // Horas trabajadas (para el consumo estimado) = por día con ronda verde, 12 − parada.
    const perDay = new Map<string, { stopped: number; green: number }>();
    (rnd ?? []).forEach((r: any) => {
      const p = perDay.get(r.round_date) ?? { stopped: 0, green: 0 };
      p.stopped = Math.max(p.stopped, Number(r.hours_stopped) || 0);
      p.green += r.status === 'operativa' ? 1 : 0;
      perDay.set(r.round_date, p);
    });
    let worked = 0;
    perDay.forEach((d) => { if (d.green > 0) worked += workedHours(d.stopped); });
    setFuelTrace(trace);
    setFuelSurtido(surtido);
    setFuelWorked(worked);
    setFuelLoading(false);
  };

  const downloadFuelPdf = async () => {
    if (!fuelFor) return;
    const consumed = fuelConsumed;
    const rows = fuelTrace
      .map((t) => `<tr><td>${t.date}</td><td>${t.tank || '—'}</td><td style="text-align:right">${t.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
      <style>
        *{box-sizing:border-box}
        body{font-family:Tahoma,Geneva,Verdana,sans-serif;color:#222;padding:26px}
        h1{color:#1E3A5F;margin:0 0 2px;font-size:20px}
        .muted{color:#666;font-size:12px}
        .cards{display:flex;gap:10px;margin-top:12px}
        .c{flex:1;border:1px solid #ccc;border-radius:8px;padding:8px}
        .c .k{color:#666;font-size:11px}
        .c .v{font-weight:800;font-size:16px}
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        .foot{margin-top:18px;color:#888;font-size:10px;border-top:1px solid #ccc;padding-top:6px}
      </style></head><body>
      <h1>TRAZA DE COMBUSTIBLE</h1>
      <div class="muted">${fuelFor.code}${fuelFor.company_id ? ' · ' + (companyName(fuelFor.company_id) || '') : ''}</div>
      <div class="cards">
        <div class="c"><div class="k">Última vez surtida</div><div class="v">${fuelLast ?? '—'}</div></div>
        <div class="c"><div class="k">Total surtido</div><div class="v">${fuelSurtido.toLocaleString()} L</div></div>
        <div class="c"><div class="k">Consumo estimado</div><div class="v">${consumed != null ? consumed.toLocaleString() + ' L' : '—'}</div></div>
      </div>
      <p class="muted" style="margin-top:6px">Consumo estimado = ${fuelWorked.toLocaleString()} h trabajadas × ${fuelFor.expected_lph != null ? Number(fuelFor.expected_lph).toLocaleString() + ' L/h' : 'sin rendimiento'}</p>
      <h2 style="font-size:14px;color:#1E3A5F">Traza de surtidos</h2>
      <table><thead><tr><th>Fecha</th><th>Tanque origen</th><th style="text-align:right">Litros</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" style="text-align:center">Sin surtidos registrados</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2" style="text-align:right"><b>Total surtido</b></td><td style="text-align:right"><b>${fuelSurtido.toLocaleString()} L</b></td></tr></tfoot></table>
      <div class="foot">${COMPANY_NAME} · RIF ${COMPANY_RIF} · Documento generado por el sistema de control interno</div>
      </body></html>`;
    await exportPdf(html);
  };

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
    type Row = { key: string; data: Record<string, any>; company?: string | null };
    const rows: Row[] = lines
      .map((l) => {
        const [a, b, c, d, e] = l.split(/[,\t;]/).map((s) => s.trim());
        if (isVehicle) {
          // placa, marca, modelo
          const plate = a;
          if (!plate) return null;
          return { key: plate.toLowerCase(), data: { plate, brand: b || null, model: c || null } };
        }
        // nombre, placa, serial, IDENTIFICADOR, EMPRESA  →  código único = "nombre placa"
        const name = a;
        if (!name) return null;
        const plate = b || null;
        const code = (plate ? `${name} ${plate}` : name).trim();
        return {
          key: code.toLowerCase(),
          data: { code, description: name, plate, serial: c || null, identifier: d || null, machinery_type: kind },
          company: e || null, // 5ª columna: empresa (se resuelve/crea abajo)
        };
      })
      .filter(Boolean) as Row[];

    // 2) Quitar duplicados dentro del mismo lote (por la clave única)
    const seen = new Set<string>();
    const uniq = rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));

    // 2.5) Resolver la EMPRESA (4ª columna) a company_id: se busca por nombre
    //      (sin distinguir mayúsculas) y si no existe, se crea automáticamente.
    if (!isVehicle) {
      const wanted = Array.from(new Set(uniq.map((r) => r.company).filter(Boolean).map((s) => (s as string).trim())));
      if (wanted.length > 0) {
        const { data: existing } = await supabase.from('companies').select('id, name');
        const byName = new Map<string, string>();
        (existing ?? []).forEach((c: any) => byName.set(String(c.name).trim().toLowerCase(), c.id));
        const missing = wanted.filter((w) => !byName.has(w.toLowerCase()));
        if (missing.length > 0) {
          const { data: created } = await supabase.from('companies').insert(missing.map((name) => ({ name }))).select('id, name');
          (created ?? []).forEach((c: any) => byName.set(String(c.name).trim().toLowerCase(), c.id));
        }
        uniq.forEach((r) => {
          if (r.company) r.data.company_id = byName.get(r.company.trim().toLowerCase()) ?? null;
        });
      }
    }

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

  const companyOptions = useMemo(() => {
    // Máquinas del tipo actual (sin filtrar por empresa ni búsqueda) para contar.
    const ofKind = machinery.data.filter((m) => (m.machinery_type ?? 'maquinaria') === kind);
    const countFor = (id: string) => ofKind.filter((m) => m.company_id === id).length;
    return [
      { label: 'Todas las empresas', value: '__all__', count: ofKind.length },
      ...companies.data
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ label: c.name, value: c.id, count: countFor(c.id) })),
      { label: 'Sin empresa', value: '__none__', count: ofKind.filter((m) => !m.company_id).length },
    ];
  }, [companies.data, machinery.data, kind]);
  const companyFilterLabel = companyOptions.find((o) => o.value === companyFilter)?.label ?? 'Todas las empresas';

  // Agrupar la maquinaria por empresa (para el catálogo en acordeón).
  const machineryByCompany = useMemo(() => {
    if (isVehicle) return [] as { key: string; name: string; items: Machinery[] }[];
    const m = new Map<string, { key: string; name: string; items: Machinery[] }>();
    (list as Machinery[]).forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companyName(it.company_id) || 'Empresa' : 'Sin empresa';
      const g = m.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      m.set(k, g);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [isVehicle, list, companyName]);

  const renderMachineCard = (m: Machinery) => (
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
        <BigBtn label="⛽ Combustible" onPress={() => openFuel(m)} color="#0EA5E9" />
        <BigBtn label={m.operational ? '⛔ Inactiva' : '✅ Operativa'} onPress={() => toggleOp(m)} color={m.operational ? colors.danger : colors.success} disabled={busy === m.id + '-op'} />
      </View>
    </Card>
  );

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

      {/* Filtro por empresa (solo maquinaria) — lista desplegable */}
      {!isVehicle ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Filtrar por empresa</Text>
          <TouchableOpacity
            onPress={() => setCompanyPickerOpen(true)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>{companyFilterLabel}</Text>
            <Text style={{ color: colors.muted, fontSize: 16 }}>▾</Text>
          </TouchableOpacity>
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
        // Catálogo de maquinaria dividido por empresa (acordeón).
        machineryByCompany.map((g) => {
          // Al buscar, los grupos se muestran desplegados por defecto.
          const open = expanded[g.key] ?? (!!q || companyFilter !== '__all__');
          return (
            <View key={g.key} style={{ marginBottom: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setExpanded((p) => ({ ...p, [g.key]: !open }))}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  <Text style={{ color: open ? colors.primaryContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                  <Text style={{ color: open ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                </View>
                <View style={{ backgroundColor: open ? colors.primaryContrast : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                  <Text style={{ color: open ? colors.primary : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                </View>
              </TouchableOpacity>
              {open ? <View style={{ marginTop: spacing.sm }}>{g.items.map(renderMachineCard)}</View> : null}
            </View>
          );
        })
      )}

      {/* Carga por lote: pegar varias líneas */}
      <Modal visible={batchOpen} animationType="slide" transparent onRequestClose={() => setBatchOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 18, marginBottom: spacing.xs }}>
              Cargar {kindMeta.label.toLowerCase()} por lote
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Pega una por línea. Opcional: {isVehicle ? 'placa, marca, modelo' : 'nombre, placa, serial, identificador, empresa'} separados por coma.
              {isVehicle ? '' : ' La empresa se reconoce por su nombre y, si no existe, se crea.'}
            </Text>
            <ScrollView style={{ maxHeight: 240 }}>
              <TextInput
                value={batchText}
                onChangeText={setBatchText}
                multiline
                placeholder={isVehicle ? 'ABC123\nXYZ789, Toyota, Hilux' : 'RETRO-01\nVOLVO-02, PBA123, SER-998, ID-77, Beraca'}
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

      {/* Lista desplegable de empresas para filtrar */}
      <Modal visible={companyPickerOpen} transparent animationType="fade" onRequestClose={() => setCompanyPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setCompanyPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '75%', overflow: 'hidden' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, padding: spacing.md }}>Filtrar por empresa</Text>
            <ScrollView>
              {companyOptions.map((o) => {
                const active = companyFilter === o.value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => { setCompanyFilter(o.value); setCompanyPickerOpen(false); }}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.surfaceAlt : 'transparent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}
                  >
                    <Text style={{ color: active ? colors.primary : colors.text, fontWeight: active ? '800' : '500', flex: 1 }}>{o.label}</Text>
                    <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, minWidth: 26, alignItems: 'center' }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{o.count}</Text>
                    </View>
                    {active ? <Text style={{ color: colors.primary, fontWeight: '800' }}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Traza de combustible por máquina (vista previa + PDF) */}
      <Modal visible={!!fuelFor} animationType="slide" onRequestClose={() => setFuelFor(null)}>
        <Screen>
          {fuelFor ? (
            <>
              <SectionTitle>⛽ Combustible · {fuelFor.code}</SectionTitle>
              {fuelLoading ? (
                <Loading />
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Última vez surtida</Text>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fuelLast ?? '—'}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Total surtido</Text>
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>{fuelSurtido.toLocaleString()} L</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Consumo estimado</Text>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>{fuelConsumed != null ? `${fuelConsumed.toLocaleString()} L` : '—'}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    Consumo estimado = {fuelWorked.toLocaleString()} h trabajadas × {fuelFor.expected_lph != null ? `${Number(fuelFor.expected_lph).toLocaleString()} L/h` : 'sin rendimiento (defínelo al editar la máquina)'}
                  </Text>

                  <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }}>Traza de surtidos</Text>
                  {fuelTrace.length === 0 ? (
                    <EmptyState title="Sin surtidos" subtitle="Cuando registres un consumo/despacho a esta máquina, aparecerá aquí." />
                  ) : (
                    fuelTrace.map((t, i) => (
                      <Card key={i}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>{t.date}</Text>
                          <Text style={{ color: colors.success, fontWeight: '800' }}>{t.liters.toLocaleString()} L</Text>
                        </View>
                        {t.tank ? <Text style={{ color: colors.muted, fontSize: 12 }}>Tanque: {t.tank}</Text> : null}
                      </Card>
                    ))
                  )}

                  <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={downloadFuelPdf}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬇️ Descargar PDF</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setFuelFor(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
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
