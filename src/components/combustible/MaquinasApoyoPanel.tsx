// 🆘 Máquinas de apoyo (02-nov-2026) — consumo de las máquinas que NO están en el
// catálogo y a las que el surtidor les echó combustible. Agrupado por máquina
// (nombre + placa) con su total de litros, y cada surtido con toda su información
// y sus fotos (de la máquina y de lo surtido). Quien tiene 'full' en Consumos
// puede agregar o quitar fotos de los dos juegos.
//
// Depende de las columnas apoyo_* de dispatches (creadas el 02-nov-2026); con
// APOYO_ACTIVO en false el panel solo muestra un aviso y no consulta nada.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, Modal, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { levelMeets } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { takePhotoAndUpload, pickPhotoFromGalleryAndUpload } from '../../lib/photo';
import { APOYO_ACTIVO, agruparApoyo, esDeApoyo, normalizarApoyo } from '../../lib/combustibleApoyo';
import { useToast } from '../ToastProvider';

const hoy = () => new Date().toISOString().slice(0, 10);
const haceDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const fmt = (n: any) => Number(n ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
const hora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '';

type Juego = 'apoyo_fotos' | 'photos';

export default function MaquinasApoyoPanel() {
  const { colors } = useTheme();
  const toast = useToast();
  const { moduleLevel } = useAuth();
  const esFull = levelMeets(moduleLevel('consumos'), 'full');

  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoy());
  const [buscar, setBuscar] = useState('');
  const [filas, setFilas] = useState<any[]>([]);
  const [tanques, setTanques] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [fotoGrande, setFotoGrande] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ fila: any; juego: Juego } | null>(null);
  const [fotosEdit, setFotosEdit] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    if (!APOYO_ACTIVO) return;
    setCargando(true);
    try {
      // select('*'): no nombra columnas nuevas; el filtro de apoyo se hace aquí.
      const { data, error } = await supabase
        .from('dispatches')
        .select('*')
        .is('machinery_id', null)
        .is('vehicle_id', null)
        .gte('dispatch_date', desde)
        .lte('dispatch_date', hasta)
        .order('dispatch_date', { ascending: false })
        .limit(2000);
      if (error) throw error;
      setFilas((data ?? []).filter((d: any) => esDeApoyo(d)));
      const { data: tk } = await supabase.from('tanks').select('id, name');
      const m: Record<string, string> = {};
      for (const t of tk ?? []) m[(t as any).id] = (t as any).name;
      setTanques(m);
    } catch (e: any) {
      toast.error('No se pudo cargar el consumo de apoyo: ' + (e?.message || 'Error'));
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const grupos = useMemo(() => {
    const q = normalizarApoyo(buscar);
    const vis = q
      ? filas.filter((d) => normalizarApoyo(`${d.apoyo_nombre} ${d.apoyo_placa ?? ''} ${d.apoyo_serial ?? ''} ${d.apoyo_empresa ?? ''}`).includes(q))
      : filas;
    return agruparApoyo(vis);
  }, [filas, buscar]);
  const totalLitros = grupos.reduce((s, g) => s + g.litros, 0);

  const abrirEdicion = (fila: any, juego: Juego) => {
    setEditando({ fila, juego });
    setFotosEdit(((fila[juego] ?? []) as string[]).filter(Boolean));
  };

  const agregarFoto = async (fuente: 'camara' | 'galeria') => {
    setOcupado(true);
    try {
      const r = fuente === 'camara'
        ? await takePhotoAndUpload('combustible-apoyo', 'combustible')
        : await pickPhotoFromGalleryAndUpload('combustible-apoyo', 'combustible');
      if (r.ok && typeof r.url === 'string') {
        const url = r.url;
        setFotosEdit((p) => [...p, url]);
      } else if (r.error) toast.error(r.error);
    } finally {
      setOcupado(false);
    }
  };

  const guardarFotos = async () => {
    if (!editando || !APOYO_ACTIVO) return;
    setOcupado(true);
    try {
      const { data, error } = await supabase
        .from('dispatches')
        .update({ [editando.juego]: fotosEdit })
        .eq('id', editando.fila.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error('No se guardó: hace falta permiso full en Consumos.');
        return;
      }
      toast.success('Fotos guardadas.');
      setEditando(null);
      cargar();
    } catch (e: any) {
      toast.error('No se pudieron guardar las fotos: ' + (e?.message || 'Error'));
    } finally {
      setOcupado(false);
    }
  };

  const campo = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, fontSize: 14, color: colors.text } as const;
  const boton = { flexGrow: 1, flexBasis: 120, alignItems: 'center' as const, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt };

  const Miniaturas = ({ fotos }: { fotos: string[] }) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {fotos.map((u, i) => (
        <TouchableOpacity key={u + i} onPress={() => setFotoGrande(u)}>
          <Image source={{ uri: u }} style={{ width: 60, height: 60, borderRadius: radius.sm }} />
        </TouchableOpacity>
      ))}
    </View>
  );

  if (!APOYO_ACTIVO) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 28 }}>🆘</Text>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginTop: spacing.sm, textAlign: 'center' }}>Máquinas de apoyo</Text>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.sm, maxWidth: 520 }}>
          Aquí se verá el consumo de las máquinas que no están en el catálogo. Se enciende cuando la base de datos esté lista para guardar sus datos.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
          <TextInput value={desde} onChangeText={setDesde} placeholder="Desde AAAA-MM-DD" placeholderTextColor={colors.muted} style={[campo, { flexGrow: 1, flexBasis: 130 }]} />
          <TextInput value={hasta} onChangeText={setHasta} placeholder="Hasta AAAA-MM-DD" placeholderTextColor={colors.muted} style={[campo, { flexGrow: 1, flexBasis: 130 }]} />
          <TextInput value={buscar} onChangeText={setBuscar} placeholder="Buscar nombre, placa, serial o empresa" placeholderTextColor={colors.muted} style={[campo, { flexGrow: 2, flexBasis: 200 }]} />
        </View>
        <Text style={{ color: colors.text, fontWeight: '800' }}>
          {grupos.length} máquina(s) de apoyo · {fmt(totalLitros)} L
        </Text>
        {cargando && <ActivityIndicator color={colors.primary} />}
        {!cargando && grupos.length === 0 && (
          <Text style={{ color: colors.muted, textAlign: 'center' }}>No hay surtidos a máquinas de apoyo en este rango.</Text>
        )}

        {grupos.map((g) => (
          <View key={g.clave} style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm }}>
            <TouchableOpacity onPress={() => setAbierto(abierto === g.clave ? null : g.clave)} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm }}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🆘 {g.nombre}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {[g.placa ? `Placa ${g.placa}` : null, g.empresa].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={{ color: colors.primary, fontWeight: '900' }}>
                {fmt(g.litros)} L · {g.surtidos.length} surtido(s) {abierto === g.clave ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>

            {abierto === g.clave && g.surtidos.map((d: any) => {
              const fotosMaq = ((d.apoyo_fotos ?? []) as string[]).filter(Boolean);
              const fotosSur = ((d.photos ?? []) as string[]).filter(Boolean);
              return (
                <View key={d.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>
                    {String(d.dispatch_date).slice(0, 10)} {hora(d.created_at)} · {fmt(d.liters)} L
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Tanque: {tanques[d.tank_id] || 'Bomba directa'}
                    {d.fuel_start != null || d.fuel_end != null ? ` · Contador ${d.fuel_start ?? '—'} → ${d.fuel_end ?? '—'}` : ''}
                    {d.hourmeter_h != null ? ` · Horómetro ${fmt(d.hourmeter_h)}` : ''}
                  </Text>
                  {d.apoyo_serial ? <Text style={{ color: colors.muted, fontSize: 12 }}>Serial: {d.apoyo_serial}</Text> : null}
                  {d.driver_operator ? <Text style={{ color: colors.muted, fontSize: 12 }}>Autorizó: {d.driver_operator}</Text> : null}
                  {d.notes ? <Text style={{ color: colors.text, fontSize: 12 }}>📝 {d.notes}</Text> : null}
                  {fotosMaq.length > 0 && <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>Fotos de la máquina</Text>}
                  {fotosMaq.length > 0 && <Miniaturas fotos={fotosMaq} />}
                  {fotosSur.length > 0 && <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>Fotos de lo surtido</Text>}
                  {fotosSur.length > 0 && <Miniaturas fotos={fotosSur} />}
                  {esFull && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      <TouchableOpacity onPress={() => abrirEdicion(d, 'apoyo_fotos')} style={boton}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>✏️ Fotos de la máquina</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => abrirEdicion(d, 'photos')} style={boton}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>✏️ Fotos de lo surtido</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Modales al final (en web gana el último montado) */}
      <Modal visible={editando != null} transparent animationType="fade" onRequestClose={() => setEditando(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
          <View style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md }}>
            <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>
                {editando?.juego === 'apoyo_fotos' ? 'Fotos de la máquina' : 'Fotos de lo surtido'} ({fotosEdit.length})
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <TouchableOpacity disabled={ocupado} onPress={() => agregarFoto('camara')} style={boton}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>📷 Cámara</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={ocupado} onPress={() => agregarFoto('galeria')} style={boton}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>🖼️ Galería</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {fotosEdit.map((u, i) => (
                  <TouchableOpacity key={u + i} onPress={() => setFotosEdit(fotosEdit.filter((_, j) => j !== i))}>
                    <Image source={{ uri: u }} style={{ width: 70, height: 70, borderRadius: radius.sm }} />
                    <Text style={{ fontSize: 10, color: colors.danger, textAlign: 'center' }}>✕ quitar</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {ocupado && <ActivityIndicator color={colors.primary} />}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <TouchableOpacity onPress={() => setEditando(null)} style={boton}>
                  <Text style={{ fontWeight: '700', color: colors.muted }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={ocupado} onPress={guardarFotos} style={[boton, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  <Text style={{ fontWeight: '800', color: colors.primaryContrast }}>Guardar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={fotoGrande != null} transparent animationType="fade" onRequestClose={() => setFotoGrande(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setFotoGrande(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
          {fotoGrande ? <Image source={{ uri: fotoGrande }} resizeMode="contain" style={{ width: '100%', height: '85%' }} /> : null}
          <Text style={{ color: '#fff', marginTop: spacing.sm }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
