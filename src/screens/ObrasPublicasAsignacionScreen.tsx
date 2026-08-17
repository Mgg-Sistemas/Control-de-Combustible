import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Badge } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { cmpText } from '../lib/text';
import { Company, Machinery } from '../types/database';
import {
  fetchAveriaCat, fetchJornadaCat, fetchInspByShift, makeLiveStatusOf,
  AveriaEntry, JornadaEntry, InspByShiftEntry,
} from '../lib/machineLiveStatus';
import {
  listOpSupervisors, listOpAssignments, assignOpSupervisor, clearOpAssignment,
  OpSupervisor, OpAssignment,
} from '../lib/obrasPublicas';

// ============================================================================
// PANEL DE ADMINISTRACIÓN — "Obras Públicas · asignar máquinas".
//
// Vive FUERA del módulo de Obras Públicas (módulo propio `op_asignacion`, ver
// src/lib/permissions.ts) para que los supervisores externos NO puedan cambiar
// sus propias asignaciones: ellos solo ven, en su teléfono, las máquinas que
// alguien con este permiso les asignó.
//
// Reemplaza al viejo `ObrasPublicasAssignModal` (abierto desde el Catálogo), que
// además estaba LIMITADO a las empresas Golden/Liccioni. Acá se puede asignar
// CUALQUIER máquina del catálogo, filtrando por VARIAS empresas a la vez y por
// CUALQUIER estado (operativa / averiada / en espera / inactiva).
//
// Datos: solo usa la capa ya existente de src/lib/obrasPublicas.ts
// (listOpSupervisors / listOpAssignments / assignOpSupervisor / clearOpAssignment).
// ============================================================================

/** Estado de la máquina con el que se filtra (los 4 cubos del Catálogo). */
type EstadoKey = 'operativa' | 'averiada' | 'espera' | 'inactiva';

const ESTADOS: { key: EstadoKey; label: string; tone: 'success' | 'danger' | 'warning' | 'muted' }[] = [
  { key: 'operativa', label: '🟢 Operativas', tone: 'success' },
  { key: 'averiada', label: '🔴 Averiadas', tone: 'danger' },
  { key: 'espera', label: '🟡 En espera', tone: 'warning' },
  { key: 'inactiva', label: '⚫ Inactivas', tone: 'muted' },
];
const ESTADO_LABEL: Record<EstadoKey, string> = {
  operativa: 'Operativa', averiada: 'Averiada', espera: 'En espera', inactiva: 'Inactiva',
};
const ESTADO_TONE: Record<EstadoKey, 'success' | 'danger' | 'warning' | 'muted'> = {
  operativa: 'success', averiada: 'danger', espera: 'warning', inactiva: 'muted',
};

/** Clave del filtro por empresa para las máquinas SIN empresa asignada. */
const SIN_EMPRESA = '__none__';

/** Cuántas máquinas se pintan de una (el resto se abre con "Mostrar más"). */
const PAGINA = 60;

export default function ObrasPublicasAsignacionScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { session, canSee } = useAuth();
  const userId = session?.user?.id ?? null;

  const machinery = useTable<Machinery>('machinery', { orderBy: 'code', ascending: true });
  const companies = useTable<Company>('companies');

  // Supervisores de obras públicas + asignaciones vigentes (máquina → supervisor).
  const [supers, setSupers] = useState<OpSupervisor[]>([]);
  const [assigns, setAssigns] = useState<Map<string, OpAssignment>>(new Map());
  const [loadingOp, setLoadingOp] = useState(true);
  const [saving, setSaving] = useState(false);

  // Estatus EN VIVO (mismas fuentes y misma clasificación que el Catálogo).
  const [jornadaCat, setJornadaCat] = useState<Record<string, JornadaEntry>>({});
  const [averiaCat, setAveriaCat] = useState<Record<string, AveriaEntry>>({});
  const [inspByShift, setInspByShift] = useState<Record<string, InspByShiftEntry>>({});
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // Filtros / selección.
  const [q, setQ] = useState('');
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set()); // vacío = todas
  const [estadosSel, setEstadosSel] = useState<Set<EstadoKey>>(new Set()); // vacío = todos
  const [supSel, setSupSel] = useState<string | null>(null);              // supervisor destino
  const [sel, setSel] = useState<Set<string>>(new Set());                 // máquinas marcadas
  const [limite, setLimite] = useState(PAGINA);

  const puede = canSee('op_asignacion');

  const reloadOp = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([listOpSupervisors(), listOpAssignments()]);
      setSupers(s);
      setAssigns(a);
      setSupSel((prev) => (prev && s.some((x) => x.id === prev) ? prev : s[0]?.id ?? null));
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron cargar los supervisores de Obras Públicas.');
    } finally {
      setLoadingOp(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadEstatus = useCallback(() => {
    fetchJornadaCat().then(setJornadaCat).catch(() => {});
    fetchAveriaCat().then(setAveriaCat).catch(() => {});
    fetchInspByShift().then(setInspByShift).catch(() => {});
    setNowTick(Date.now());
  }, []);

  useEffect(() => { if (puede) { reloadOp(); reloadEstatus(); } }, [puede, reloadOp, reloadEstatus]);
  // Las horas "en curso" avanzan solas: refresca el reloj cada minuto.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    reloadEstatus();
    machinery.refetch();
    companies.refetch();
    await reloadOp();
    setRefreshing(false);
  };

  const companyName = useMemo(() => {
    const m = new Map(companies.data.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? '' : '');
  }, [companies.data]);

  const retiredIds = useMemo(
    () => new Set(machinery.data.filter((m) => m.operational === false).map((m) => m.id)),
    [machinery.data],
  );
  const statusOf = useMemo(
    () => makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds, nowTick }),
    [jornadaCat, averiaCat, inspByShift, retiredIds, nowTick],
  );

  /** Estado de una máquina: inactiva > en espera > averiada > operativa (mismo
   *  criterio EXCLUYENTE de los 4 cubos del Catálogo, ver bucketMachineStatus). */
  const estadoDe = useCallback((m: Machinery): EstadoKey => {
    if (m.operational === false) return 'inactiva';
    if (m.en_espera) return 'espera';
    return statusOf(m.id).estado === 'averiada' ? 'averiada' : 'operativa';
  }, [statusOf]);

  /** Empresas con al menos una máquina en el catálogo (+ "Sin empresa" si la hay). */
  const empresas = useMemo(() => {
    const cnt = new Map<string, number>();
    machinery.data.forEach((m) => {
      const k = m.company_id ?? SIN_EMPRESA;
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
    });
    return [...cnt.entries()]
      .map(([key, count]) => ({ key, name: key === SIN_EMPRESA ? 'Sin empresa' : companyName(key) || 'Empresa', count }))
      .sort((a, b) => cmpText(a.name, b.name));
  }, [machinery.data, companyName]);

  // Texto buscable: TODAS las características de la máquina + su supervisor.
  const searchText = useCallback((m: Machinery) =>
    [m.code, m.description, m.plate, m.serial, m.identifier, m.grupo, m.encargado, m.tipo, m.marca, m.modelo,
     m.clasificacion, m.machinery_type, m.parroquia, m.sector, m.referencia, companyName(m.company_id ?? null),
     assigns.get(m.id)?.supervisor_name]
      .filter(Boolean).join(' ').toLowerCase(), [companyName, assigns]);

  const lista = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return machinery.data
      .filter((m) => (empresasSel.size === 0 ? true : empresasSel.has(m.company_id ?? SIN_EMPRESA)))
      .filter((m) => (estadosSel.size === 0 ? true : estadosSel.has(estadoDe(m))))
      .filter((m) => !needle || searchText(m).includes(needle))
      .sort((a, b) => cmpText(a.code ?? '', b.code ?? ''));
  }, [machinery.data, q, empresasSel, estadosSel, estadoDe, searchText]);

  // Al cambiar los filtros se vuelve a la primera "página" de resultados.
  useEffect(() => { setLimite(PAGINA); }, [q, empresasSel, estadosSel]);

  const asignadas = useMemo(() => lista.filter((m) => assigns.has(m.id)).length, [lista, assigns]);
  const supName = (id: string | null) => supers.find((s) => s.id === id)?.full_name ?? '';

  const toggleEmpresa = (key: string) => setEmpresasSel((prev) => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const toggleEstado = (key: EstadoKey) => setEstadosSel((prev) => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const toggleMaquina = (id: string) => setSel((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const asignarLote = async () => {
    if (!supSel) { toast.error('Elige el supervisor destino.'); return; }
    if (!sel.size) { toast.error('Marca al menos una máquina.'); return; }
    setSaving(true);
    try {
      const n = await assignOpSupervisor(Array.from(sel), supSel, userId);
      await reloadOp();
      setSel(new Set());
      toast.success(`Se asignaron ${n} máquina(s) a ${supName(supSel)}.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo asignar.');
    } finally {
      setSaving(false);
    }
  };

  const asignarUna = async (id: string) => {
    if (!supSel) { toast.error('Elige el supervisor destino arriba.'); return; }
    setSaving(true);
    try {
      await assignOpSupervisor([id], supSel, userId);
      await reloadOp();
      toast.success(`Asignada a ${supName(supSel)}.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo asignar.');
    } finally {
      setSaving(false);
    }
  };

  const quitar = async (id: string) => {
    setSaving(true);
    try {
      await clearOpAssignment(id);
      await reloadOp();
      toast.success('Supervisor quitado.');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo quitar.');
    } finally {
      setSaving(false);
    }
  };

  if (!puede) {
    return (
      <Screen>
        <EmptyState
          title="Sin acceso"
          subtitle="No tienes permiso para asignar máquinas de Obras Públicas. Pídeselo a un administrador (módulo “Obras Públicas · asignar máquinas”)."
        />
      </Screen>
    );
  }

  const chip = (on: boolean) => ({
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: on ? colors.brand : colors.border,
    backgroundColor: on ? colors.brand : colors.surfaceAlt,
  } as const);
  const chipText = (on: boolean) => ({
    color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12,
  });

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <View>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>🏛️ Obras Públicas · asignar máquinas</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          Asigna CUALQUIER máquina del catálogo a un supervisor externo de Obras Públicas (por lote o
          individual). Cada supervisor verá en su teléfono solo las máquinas que le asignes.
        </Text>
      </View>

      {/* Supervisor destino */}
      <Card>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14 }}>👷 Supervisor destino</Text>
        {loadingOp ? (
          <ActivityIndicator color={colors.brand} />
        ) : supers.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            No hay usuarios con el módulo “Obras Públicas”. Créalos o dales el permiso en Usuarios y vuelve a esta pantalla.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {supers.map((s) => {
              const on = supSel === s.id;
              return (
                <TouchableOpacity key={s.id} onPress={() => setSupSel(s.id)} style={chip(on)}>
                  <Text style={chipText(on)}>👷 {s.full_name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </Card>

      {/* Filtros: buscador + empresas (multi) + estados (multi) */}
      <Card>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 14 }}>🔎 Filtrar máquinas</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Buscar por código, placa, serial, marca, empresa, parroquia…"
          placeholderTextColor={colors.muted}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text }}
        />

        {/* Empresas (multi-selección). Ninguna marcada = todas. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>🏢 Empresas</Text>
          {empresasSel.size > 0 ? (
            <TouchableOpacity onPress={() => setEmpresasSel(new Set())}>
              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar ({empresasSel.size})</Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11 }}>Ninguna marcada = todas</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
          {empresas.map((e) => {
            const on = empresasSel.has(e.key);
            return (
              <TouchableOpacity key={e.key} onPress={() => toggleEmpresa(e.key)} style={chip(on)}>
                <Text style={chipText(on)} numberOfLines={1}>{e.name} ({e.count})</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Estados (multi-selección). Ninguno marcado = todos. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>⚙️ Estado</Text>
          {estadosSel.size > 0 ? (
            <TouchableOpacity onPress={() => setEstadosSel(new Set())}>
              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✕ Limpiar ({estadosSel.size})</Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11 }}>Ninguno marcado = todos</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
          {ESTADOS.map((e) => {
            const on = estadosSel.has(e.key);
            return (
              <TouchableOpacity key={e.key} onPress={() => toggleEstado(e.key)} style={chip(on)}>
                <Text style={chipText(on)}>{e.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* Acciones de LOTE sobre lo que muestra el filtro */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <TouchableOpacity
            onPress={() => setSel(new Set(lista.map((m) => m.id)))}
            disabled={lista.length === 0}
            style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, opacity: lista.length === 0 ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>✓ Marcar todas ({lista.length})</Text>
          </TouchableOpacity>
          {sel.size > 0 ? (
            <TouchableOpacity onPress={() => setSel(new Set())} style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>✕ Limpiar ({sel.size})</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 11, flex: 1, textAlign: 'right' }}>
            {lista.length} máquina(s) · {asignadas} con supervisor
          </Text>
        </View>
        {sel.size > 0 ? (
          <TouchableOpacity
            onPress={asignarLote}
            disabled={saving || !supSel}
            style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, opacity: saving || !supSel ? 0.6 : 1 }}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>
              {saving ? 'Asignando…' : `✅ Asignar ${sel.size} máquina(s) a ${supName(supSel) || '—'}`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </Card>

      <SectionTitle>Máquinas del catálogo · {lista.length}</SectionTitle>

      {machinery.loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : lista.length === 0 ? (
        <EmptyState title="No hay máquinas que coincidan" subtitle="Prueba con otro texto, otras empresas u otros estados." />
      ) : (
        <View style={{ gap: spacing.xs }}>
          {lista.slice(0, limite).map((m) => {
            const est = estadoDe(m);
            const asg = assigns.get(m.id);
            const marcada = sel.has(m.id);
            const ficha = [m.plate || m.serial, m.marca, m.modelo].filter(Boolean).join(' · ');
            return (
              <Card key={m.id} style={{ borderColor: marcada ? colors.brand : colors.border, borderWidth: marcada ? 2 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <TouchableOpacity
                    onPress={() => toggleMaquina(m.id)}
                    style={{ width: 24, height: 24, borderRadius: 5, borderWidth: 2, borderColor: marcada ? colors.brand : colors.border, backgroundColor: marcada ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {marcada ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                  </TouchableOpacity>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{m.code}</Text>
                    {ficha ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>🔖 {ficha}</Text> : null}
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>🏢 {companyName(m.company_id ?? null) || 'Sin empresa'}</Text>
                  </View>
                  <Badge label={ESTADO_LABEL[est]} tone={ESTADO_TONE[est]} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6, flexWrap: 'wrap' }}>
                  <Text style={{ flex: 1, minWidth: 140, fontSize: 12, color: asg ? colors.text : colors.muted, fontWeight: asg ? '700' : '400' }}>
                    {asg ? `👷 ${asg.supervisor_name}` : 'Sin supervisor de obras públicas'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => asignarUna(m.id)}
                    disabled={saving || !supSel}
                    style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.brand, opacity: saving || !supSel ? 0.6 : 1 }}
                  >
                    <Text style={{ color: colors.brandContrast, fontSize: 12, fontWeight: '800' }}>Asignar aquí</Text>
                  </TouchableOpacity>
                  {asg ? (
                    <TouchableOpacity
                      onPress={() => quitar(m.id)}
                      disabled={saving}
                      style={{ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, opacity: saving ? 0.6 : 1 }}
                    >
                      <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800' }}>Quitar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </Card>
            );
          })}
          {lista.length > limite ? (
            <TouchableOpacity
              onPress={() => setLimite((n) => n + PAGINA)}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
            >
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                Mostrar {Math.min(PAGINA, lista.length - limite)} más ({lista.length - limite} restantes)
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      <View style={{ height: 30 }} />
    </Screen>
  );
}
