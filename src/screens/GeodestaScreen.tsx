// MÓDULO DE GEODESTA · Fase 0 (cimientos) — gestor de PROYECTOS de levantamiento.
// Cada proyecto (levantamiento) se liga a una obra/edificio y define la tolerancia
// GPS. Coordenadas de trabajo: UTM SIRGAS-REGVEN 19N (EPSG:2202). Las fases
// siguientes agregan captura de puntos, curvas de nivel, volúmenes e inspección.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import EdificioPicker from '../components/EdificioPicker';
import { useTable } from '../hooks/useTable';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { spacing, radius } from '../theme';
import { norm, cmpText } from '../lib/text';
import { levelMeets } from '../lib/permissions';
import { fetchEdificioRows } from '../lib/edificios';
import { GeodestaProject } from '../types/database';

export default function GeodestaScreen({ navigation }: any) {
  const { colors } = useTheme();
  const toast = useToast();
  const { moduleLevel } = useAuth();
  const lvl = moduleLevel('geodesta');
  const canWrite = levelMeets(lvl, 'escritura');
  const canDelete = levelMeets(lvl, 'full');

  const { data: projects, loading, refetch } = useTable<GeodestaProject>('geodesta_projects', { orderBy: 'created_at', ascending: false });
  useRealtimeRefresh(['geodesta_projects'], () => refetch());

  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  // Formulario de nuevo proyecto.
  const [name, setName] = useState('');
  const [edificio, setEdificio] = useState('');
  const [tol, setTol] = useState('5');
  const [desc, setDesc] = useState('');

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    const list = !nq ? projects : projects.filter((p) => [p.name, p.referencia, p.status].filter(Boolean).some((v) => norm(v as string).includes(nq)));
    return [...list].sort((a, b) => cmpText(a.name, b.name));
  }, [projects, q]);

  const resetForm = () => { setName(''); setEdificio(''); setTol('5'); setDesc(''); };

  const crear = async () => {
    const nm = name.trim();
    if (!nm) { toast.error('Escribe el nombre del proyecto.'); return; }
    if (busy) return;
    setBusy(true);
    // Resuelve el edificio_id del catálogo si el nombre coincide (si no, queda solo el texto).
    let edificioId: string | null = null;
    const ref = edificio.trim() || null;
    if (ref) {
      try {
        const rows = await fetchEdificioRows();
        edificioId = rows.find((r) => norm(r.name) === norm(ref))?.id ?? null;
      } catch { /* best-effort */ }
    }
    const tolNum = Number(String(tol).replace(',', '.'));
    const { error } = await supabase.from('geodesta_projects').insert({
      name: nm,
      edificio_id: edificioId,
      referencia: ref,
      coord_system: 'UTM19N',
      srid: 2202,
      gps_tolerance_m: Number.isFinite(tolNum) && tolNum > 0 ? tolNum : 5,
      description: desc.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Proyecto de levantamiento creado.');
    resetForm();
    setShowForm(false);
    refetch();
  };

  const eliminar = async (p: GeodestaProject) => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from('geodesta_projects').delete().eq('id', p.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDelId(null);
    toast.success('Proyecto eliminado.');
    refetch();
  };

  const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return iso; } };

  return (
    <Screen>
      <SectionTitle>📐 Geodesta · Levantamientos</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Proyectos de levantamiento topográfico ligados a una obra/edificio. Coordenadas de
        trabajo: UTM SIRGAS-REGVEN 19N (EPSG:2202). La captura de puntos, las curvas de nivel
        y las cubicaciones llegan en las próximas fases del módulo.
      </Text>

      {canWrite ? (
        <TouchableOpacity onPress={() => setShowForm((v) => !v)} style={{ backgroundColor: showForm ? colors.surfaceAlt : colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm, borderWidth: showForm ? 1 : 0, borderColor: colors.border }}>
          <Text style={{ color: showForm ? colors.text : colors.brandContrast, fontWeight: '800' }}>{showForm ? 'Cancelar' : '＋ Nuevo levantamiento'}</Text>
        </TouchableOpacity>
      ) : null}

      {showForm && canWrite ? (
        <Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Nombre del proyecto</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Ej. Levantamiento Residencias La Joya" placeholderTextColor={colors.muted} style={input} />
          <EdificioPicker value={edificio} onChange={setEdificio} label="Obra / edificio" placeholder="Selecciona la obra…" />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Tolerancia GPS (m) — se rechazan tomas menos precisas que esto</Text>
          <TextInput value={tol} onChangeText={setTol} keyboardType="decimal-pad" placeholder="5" placeholderTextColor={colors.muted} style={input} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Descripción (opcional)</Text>
          <TextInput value={desc} onChangeText={setDesc} placeholder="Notas del levantamiento…" placeholderTextColor={colors.muted} style={[input, { minHeight: 44 }]} multiline />
          <TouchableOpacity onPress={crear} disabled={busy || !name.trim()} style={{ marginTop: spacing.md, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy || !name.trim() ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Crear levantamiento'}</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar levantamiento…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

      {loading && projects.length === 0 ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState title="Sin levantamientos" subtitle={q ? 'Prueba con otra búsqueda.' : canWrite ? 'Crea el primer levantamiento arriba.' : 'Aún no hay levantamientos registrados.'} />
      ) : (
        <>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{filtered.length} levantamiento(s)</Text>
          {filtered.map((p) => {
            const confirmingDel = delId === p.id;
            return (
              <Card key={p.id}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => navigation?.navigate?.('GeodestaDetalle', { projectId: p.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{p.name}</Text>
                    {p.referencia ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>🏗️ {p.referencia}</Text> : null}
                    <Text style={{ color: colors.primary, fontSize: 11, marginTop: 2, fontWeight: '700' }}>Abrir puntos y mapa ›</Text>
                  </View>
                  <Badge tone={p.status === 'activo' ? 'success' : 'muted'} label={(p.status || 'activo').toUpperCase()} />
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                  <Chip colors={colors}>📍 {p.coord_system} · EPSG:{p.srid}</Chip>
                  <Chip colors={colors}>🎯 Tol. GPS {p.gps_tolerance_m} m</Chip>
                  <Chip colors={colors}>🗓️ {fmtDate(p.created_at)}</Chip>
                </View>
                {p.description ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{p.description}</Text> : null}
                {canDelete ? (
                  confirmingDel ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                      <Text style={{ color: colors.danger, fontSize: 12, flex: 1 }}>¿Eliminar este levantamiento y todos sus puntos?</Text>
                      <TouchableOpacity onPress={() => setDelId(null)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>No</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => eliminar(p)} disabled={busy} style={{ backgroundColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, opacity: busy ? 0.6 : 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Sí, eliminar</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setDelId(p.id)} style={{ alignSelf: 'flex-end', marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🗑 Eliminar</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </Card>
            );
          })}
        </>
      )}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

function Chip({ children, colors }: { children: React.ReactNode; colors: any }) {
  return (
    <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}
