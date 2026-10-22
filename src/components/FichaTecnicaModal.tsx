// ============================================================================
// 📄 MODAL PARA PERSONALIZAR Y EXPORTAR FICHA TÉCNICA.
//
// Permite modificar el título, subtítulo, badge superior, renglones de
// especificaciones, métricas destacadas, cuadros de texto / observaciones
// y fotos extras antes de exportar el PDF con el estilo moderno de alta calidad
// (similar al Grupo Electrógeno Metro).
//
// Todo se almacena localmente vía `AsyncStorage` SIN alterar la base de datos de
// `machinery` ni romper el flujo de trabajo del catálogo.
// ============================================================================
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import {
  FichaPersonalizada,
  FichaRenglon,
  FichaMetrica,
  FichaObservacion,
  FichaFoto,
  MaquinaFichaTecnica,
  OpcionesFichaTecnica,
} from '../lib/fichaTecnicaMaquina';
import {
  getFichaPersonalizada,
  saveFichaPersonalizada,
  deleteFichaPersonalizada,
  construirFichaInicial,
} from '../lib/fichaTecnicaStorage';
import { capturarFotoLocal, elegirFotoLocal } from '../lib/photo';

export function FichaTecnicaModal({
  visible,
  machine,
  machineId,
  options,
  onClose,
  onExport,
}: {
  visible: boolean;
  machine: MaquinaFichaTecnica | null;
  machineId: string | null;
  options: OpcionesFichaTecnica;
  onClose: () => void;
  onExport: (personalizada: FichaPersonalizada) => Promise<void>;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<FichaPersonalizada | null>(null);

  // Estados para formulario de agregar renglón
  const [nuevoCampoCat, setNuevoCampoCat] = useState('');
  const [nuevoCampoEtq, setNuevoCampoEtq] = useState('');
  const [nuevoCampoVal, setNuevoCampoVal] = useState('');

  // Estados para formulario de agregar métrica
  const [nuevaMetricaTit, setNuevaMetricaTit] = useState('');
  const [nuevaMetricaSub, setNuevaMetricaSub] = useState('');
  const [nuevaMetricaVal, setNuevaMetricaVal] = useState('');

  // Estados para formulario de agregar observación
  const [nuevaObsTit, setNuevaObsTit] = useState('');
  const [nuevaObsTxt, setNuevaObsTxt] = useState('');

  // Estados para foto extra
  const [fotoTomando, setFotoTomando] = useState(false);
  const [nuevaFotoLeyenda, setNuevaFotoLeyenda] = useState('');

  // Cargar personalización previa o inicial
  useEffect(() => {
    if (!visible || !machine) return;
    setLoading(true);
    const mid = machineId || machine.code || 'default';
    getFichaPersonalizada(mid)
      .then((saved) => {
        if (saved) {
          setData(saved);
        } else {
          setData(construirFichaInicial(machine, options));
        }
      })
      .catch(() => {
        setData(construirFichaInicial(machine, options));
      })
      .finally(() => setLoading(false));
  }, [visible, machine, machineId]);

  if (!visible || !machine) return null;

  const mid = machineId || machine.code || 'default';

  // Guardar personalización
  const guardar = async () => {
    if (!data) return;
    await saveFichaPersonalizada(mid, data);
    toast.success('Ficha técnica personalizada guardada.');
  };

  // Restablecer al catálogo
  const restablecer = async () => {
    await deleteFichaPersonalizada(mid);
    const inicial = construirFichaInicial(machine, options);
    setData(inicial);
    toast.info('Valores restablecidos a los datos originales del catálogo.');
  };

  // Exportar PDF
  const handleExport = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      await onExport(data);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo exportar la ficha.');
    } finally {
      setExporting(false);
    }
  };

  // Modificadores de estado
  const setTitulo = (t: string) => setData((d) => (d ? { ...d, titulo: t } : null));
  const setSubtitulo = (s: string) => setData((d) => (d ? { ...d, subtitulo: s } : null));
  const setBadgeSuperior = (b: string) => setData((d) => (d ? { ...d, badgeSuperior: b } : null));
  const setSubcodigo = (c: string) => setData((d) => (d ? { ...d, subcodigo: c } : null));
  const setSeccionTitulo = (t: string) => setData((d) => (d ? { ...d, seccionTitulo: t } : null));
  const setSeccionTag = (t: string) => setData((d) => (d ? { ...d, seccionTag: t } : null));

  // Agregar / quitar renglón
  const agregarRenglon = () => {
    if (!nuevoCampoEtq.trim() || !nuevoCampoVal.trim()) {
      toast.error('Indica al menos el nombre del campo y su valor.');
      return;
    }
    const nuevo: FichaRenglon = {
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      categoria: nuevoCampoCat.trim() || 'Componentes Principales',
      etiqueta: nuevoCampoEtq.trim(),
      valor: nuevoCampoVal.trim(),
    };
    setData((d) => (d ? { ...d, renglones: [...(d.renglones ?? []), nuevo] } : null));
    setNuevoCampoEtq('');
    setNuevoCampoVal('');
    toast.success('Renglón agregado.');
  };

  const eliminarRenglon = (id: string) => {
    setData((d) => (d ? { ...d, renglones: (d.renglones ?? []).filter((r) => r.id !== id) } : null));
  };

  // Agregar / quitar métrica
  const agregarMetrica = () => {
    if (!nuevaMetricaTit.trim() || !nuevaMetricaVal.trim()) {
      toast.error('Indica el título de la métrica y su valor.');
      return;
    }
    const nueva: FichaMetrica = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      titulo: nuevaMetricaTit.trim(),
      subtitulo: nuevaMetricaSub.trim() || undefined,
      valor: nuevaMetricaVal.trim(),
    };
    setData((d) => (d ? { ...d, metricas: [...(d.metricas ?? []), nueva] } : null));
    setNuevaMetricaTit('');
    setNuevaMetricaSub('');
    setNuevaMetricaVal('');
    toast.success('Métrica agregada.');
  };

  const eliminarMetrica = (id: string) => {
    setData((d) => (d ? { ...d, metricas: (d.metricas ?? []).filter((m) => m.id !== id) } : null));
  };

  // Agregar / quitar observación
  const agregarObservacion = () => {
    if (!nuevaObsTxt.trim()) {
      toast.error('Escribe el texto de la observación.');
      return;
    }
    const nueva: FichaObservacion = {
      id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      titulo: nuevaObsTit.trim(),
      texto: nuevaObsTxt.trim(),
    };
    setData((d) => (d ? { ...d, observaciones: [...(d.observaciones ?? []), nueva] } : null));
    setNuevaObsTit('');
    setNuevaObsTxt('');
    toast.success('Observación agregada.');
  };

  const eliminarObservacion = (id: string) => {
    setData((d) => (d ? { ...d, observaciones: (d.observaciones ?? []).filter((o) => o.id !== id) } : null));
  };

  // Fotos extras
  const tomarFotoExtra = async (via: 'camara' | 'galeria') => {
    if (fotoTomando) return;
    setFotoTomando(true);
    try {
      const res = via === 'galeria' ? await elegirFotoLocal() : await capturarFotoLocal();
      if (res.ok && res.dataUrl) {
        const nueva: FichaFoto = {
          id: `f-${Date.now()}`,
          url: res.dataUrl,
          leyenda: nuevaFotoLeyenda.trim() || 'Foto de componente / sistema',
        };
        setData((d) => (d ? { ...d, fotosExtra: [...(d.fotosExtra ?? []), nueva] } : null));
        setNuevaFotoLeyenda('');
        toast.success('Foto agregada a la ficha.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setFotoTomando(false);
    }
  };

  const eliminarFotoExtra = (id: string) => {
    setData((d) => (d ? { ...d, fotosExtra: (d.fotosExtra ?? []).filter((f) => f.id !== id) } : null));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: spacing.md }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: radius.lg,
            maxHeight: '92%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Cabecera del modal */}
          <View
            style={{
              padding: spacing.md,
              backgroundColor: '#16324F',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
                📄 Personalizar Ficha Técnica · {machine.code || 'Equipo'}
              </Text>
              <Text style={{ color: '#AFC4DB', fontSize: 11, marginTop: 2 }}>
                Edita títulos, especificaciones, observaciones y fotos con el estilo moderno de alta calidad
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading || !data ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando datos de la ficha…</Text>
            </View>
          ) : (
            <ScrollView style={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
              {/* SECCIÓN 1: CABECERA Y TÍTULO */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  🏷️ Título y Encabezado Principal
                </Text>

                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Título del documento:</Text>
                <TextInput
                  value={data.titulo ?? ''}
                  onChangeText={setTitulo}
                  placeholder="Ej. GRUPO ELECTRÓGENO DIESEL"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text, marginBottom: spacing.xs }}
                />

                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Subtítulo / Metadatos en línea:</Text>
                <TextInput
                  value={data.subtitulo ?? ''}
                  onChangeText={setSubtitulo}
                  placeholder="Ej. Marca: METRO | Motor: Cummins NTA855 | Alt: Stamford"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text, marginBottom: spacing.xs }}
                />

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Insignia dorada superior (badge):</Text>
                    <TextInput
                      value={data.badgeSuperior ?? ''}
                      onChangeText={setBadgeSuperior}
                      placeholder="Ej. 350 kVA, 70 TON, OPERATIVA"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Subcódigo o Modelo:</Text>
                    <TextInput
                      value={data.subcodigo ?? ''}
                      onChangeText={setSubcodigo}
                      placeholder="Ej. MODELO: MXGA350-1DY"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text }}
                    />
                  </View>
                </View>
              </View>

              {/* SECCIÓN 2: TARJETAS MÉTRICAS SUPERIORES */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  📊 Métricas Clave Superiores (Fila de tarjetas)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Cuadros destacados en la parte superior (Potencia, Horómetro, Voltaje, etc.).
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                  {(data.metricas ?? []).map((m) => (
                    <View
                      key={m.id}
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        padding: 8,
                        minWidth: 130,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#16324F', fontWeight: '900', fontSize: 13 }}>{m.valor}</Text>
                        <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 9.5 }}>{m.titulo}</Text>
                        {m.subtitulo ? <Text style={{ color: colors.muted, fontSize: 8.5 }}>{m.subtitulo}</Text> : null}
                      </View>
                      <TouchableOpacity onPress={() => eliminarMetrica(m.id)} style={{ padding: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 12 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                {/* Formulario para añadir métrica */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar métrica clave:</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    <TextInput
                      value={nuevaMetricaTit}
                      onChangeText={setNuevaMetricaTit}
                      placeholder="Título (ej. POTENCIA NOMINAL)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TextInput
                      value={nuevaMetricaSub}
                      onChangeText={setNuevaMetricaSub}
                      placeholder="Sub (ej. PRIME, opcional)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput
                      value={nuevaMetricaVal}
                      onChangeText={setNuevaMetricaVal}
                      placeholder="Valor (ej. 350 kVA / 280 kW)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TouchableOpacity
                      onPress={agregarMetrica}
                      style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6 }}
                    >
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>Añadir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* SECCIÓN 3: ESPECIFICACIONES TÉCNICAS (RENGLONES) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  📋 Especificaciones Técnicas (Campos y Renglones)
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
                  <View style={{ flex: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Título de sección:</Text>
                    <TextInput
                      value={data.seccionTitulo ?? ''}
                      onChangeText={setSeccionTitulo}
                      placeholder="ESPECIFICACIONES TÉCNICAS PRINCIPALES"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Etiqueta lateral:</Text>
                    <TextInput
                      value={data.seccionTag ?? ''}
                      onChangeText={setSeccionTag}
                      placeholder="Placa de Identificación"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                </View>

                {/* Lista de renglones existentes */}
                <View style={{ maxHeight: 240, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface, marginBottom: spacing.sm }}>
                  <ScrollView nestedScrollEnabled style={{ padding: 4 }}>
                    {(data.renglones ?? []).map((r, idx) => (
                      <View
                        key={r.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 4,
                          paddingHorizontal: 6,
                          borderBottomWidth: idx === (data.renglones ?? []).length - 1 ? 0 : 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#16324F', fontWeight: '700', fontSize: 11 }}>{r.etiqueta}:</Text>
                          <Text style={{ color: colors.text, fontSize: 11.5 }}>{r.valor}</Text>
                          {r.categoria ? <Text style={{ color: colors.muted, fontSize: 9 }}>📂 {r.categoria}</Text> : null}
                        </View>
                        <TouchableOpacity onPress={() => eliminarRenglon(r.id)} style={{ padding: 6 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {(data.renglones ?? []).length === 0 ? (
                      <Text style={{ color: colors.muted, padding: 10, textAlign: 'center', fontSize: 11 }}>
                        Sin renglones cargados. Agrega uno abajo.
                      </Text>
                    ) : null}
                  </ScrollView>
                </View>

                {/* Formulario para agregar renglón */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar campo o renglón a la tabla:</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    <TextInput
                      value={nuevoCampoCat}
                      onChangeText={setNuevoCampoCat}
                      placeholder="Categoría (ej. Datos Generales o Componentes)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TextInput
                      value={nuevoCampoEtq}
                      onChangeText={setNuevoCampoEtq}
                      placeholder="Nombre del campo (ej. Voltaje de Salida)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput
                      value={nuevoCampoVal}
                      onChangeText={setNuevoCampoVal}
                      placeholder="Valor (ej. 127 / 220 V Trifásica)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TouchableOpacity
                      onPress={agregarRenglon}
                      style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6 }}
                    >
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>Añadir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* SECCIÓN 4: APARTADO DE OBSERVACIONES Y CUADROS DE TEXTO */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  📝 Apartado de Observaciones y Cuadros de Texto
                </Text>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Cuadros destacados con borde dorado para notas técnicas, condiciones, cabina, etc.
                </Text>

                {(data.observaciones ?? []).map((o) => (
                  <View
                    key={o.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderLeftWidth: 4,
                      borderLeftColor: '#EAB308',
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      padding: 8,
                      marginBottom: 6,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11.5 }}>{o.titulo || 'Observación'}</Text>
                      <TouchableOpacity onPress={() => eliminarObservacion(o.id)} style={{ padding: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 11, marginTop: 2 }}>{o.texto}</Text>
                  </View>
                ))}

                {/* Formulario para agregar observación */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar observación / cuadro de texto:</Text>
                  <TextInput
                    value={nuevaObsTit}
                    onChangeText={setNuevaObsTit}
                    placeholder="Título (ej. Cabina Super Silenciosa o Condiciones)"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 4 }}
                  />
                  <TextInput
                    value={nuevaObsTxt}
                    onChangeText={setNuevaObsTxt}
                    multiline
                    numberOfLines={3}
                    placeholder="Detalles y observaciones del equipo…"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 6, minHeight: 48 }}
                  />
                  <TouchableOpacity
                    onPress={agregarObservacion}
                    style={{ backgroundColor: colors.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>Añadir Observación</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* SECCIÓN 5: FOTOS EXTRAS */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  📷 Fotos Adicionales de Componentes y Detalles
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
                  {(data.fotosExtra ?? []).map((f) => (
                    <View
                      key={f.id}
                      style={{
                        width: 110,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        overflow: 'hidden',
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Image source={{ uri: f.url }} style={{ width: 110, height: 80 }} />
                      <View style={{ padding: 4 }}>
                        <Text style={{ color: colors.text, fontSize: 9.5 }} numberOfLines={2}>{f.leyenda || 'Foto'}</Text>
                        <TouchableOpacity onPress={() => eliminarFotoExtra(f.id)} style={{ alignSelf: 'flex-end', marginTop: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>Eliminar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Formulario para agregar foto extra */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar foto de componente / detalle:</Text>
                  <TextInput
                    value={nuevaFotoLeyenda}
                    onChangeText={setNuevaFotoLeyenda}
                    placeholder="Leyenda (ej. Vista Posterior - Atenuación Acústica)"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 6 }}
                  />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => tomarFotoExtra('camara')}
                      disabled={fotoTomando}
                      style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>📷 Tomar Foto</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => tomarFotoExtra('galeria')}
                      disabled={fotoTomando}
                      style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>🖼️ Elegir Galería</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}

          {/* Pie de acciones del modal */}
          <View
            style={{
              padding: spacing.md,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: spacing.xs,
              flexWrap: 'wrap',
            }}
          >
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={guardar}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>💾 Guardar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={restablecer}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>🔄 Restablecer</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={onClose}
                style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleExport}
                disabled={exporting}
                style={{
                  paddingHorizontal: spacing.lg,
                  paddingVertical: 8,
                  borderRadius: radius.sm,
                  backgroundColor: '#16324F',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>
                  {exporting ? 'Generando…' : '📄 Exportar PDF'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
