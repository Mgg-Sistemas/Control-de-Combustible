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
  resolverNuevoRenglon,
  aplicarPendientesFicha,
  sincronizarFichaConCatalogo,
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
  const [catRenglonSel, setCatRenglonSel] = useState<'Datos Generales' | 'Componentes Principales' | '__otra__'>('Componentes Principales');
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
    const inicial = construirFichaInicial(machine, options);
    getFichaPersonalizada(mid)
      .then((saved) => {
        if (saved) {
          const sincronizada = sincronizarFichaConCatalogo(saved, inicial);
          setData({
            ...sincronizada,
            fotoPrincipalUrl: saved.fotoPrincipalUrl !== undefined ? saved.fotoPrincipalUrl : (machine.photo_url || null),
            fotoPrincipalLeyenda: saved.fotoPrincipalLeyenda !== undefined ? saved.fotoPrincipalLeyenda : (machine.photo_url ? 'Vista general de la unidad en campo operativo' : null),
            seccionFotosTitulo: saved.seccionFotosTitulo || 'VISTA GENERAL DEL EQUIPO',
            seccionFotosTag: saved.seccionFotosTag || machine.clasificacion || 'Vista en Terreno',
          });
        } else {
          setData(inicial);
        }
      })
      .catch(() => {
        setData(inicial);
      })
      .finally(() => setLoading(false));
  }, [visible, machine, machineId]);

  if (!visible || !machine) return null;

  const mid = machineId || machine.code || 'default';

  const consolidarDatosActuales = (actual: FichaPersonalizada): FichaPersonalizada => {
    const res = aplicarPendientesFicha(actual, {
      categoriaSeleccionada: catRenglonSel === '__otra__' ? (nuevoCampoCat.trim() || 'Componentes Principales') : catRenglonSel,
      nuevoCampoCat: catRenglonSel === '__otra__' ? nuevoCampoCat : '',
      nuevoCampoEtq,
      nuevoCampoVal,
      nuevaMetricaTit,
      nuevaMetricaSub,
      nuevaMetricaVal,
      nuevaObsTit,
      nuevaObsTxt,
    });
    if (res.agregados.renglon) {
      setNuevoCampoEtq('');
      setNuevoCampoVal('');
      if (catRenglonSel === '__otra__') setNuevoCampoCat('');
    }
    if (res.agregados.metrica) {
      setNuevaMetricaTit('');
      setNuevaMetricaSub('');
      setNuevaMetricaVal('');
    }
    if (res.agregados.observacion) {
      setNuevaObsTit('');
      setNuevaObsTxt('');
    }
    return res.data;
  };

  // Guardar personalización
  const guardar = async () => {
    if (!data) return;
    const finalData = consolidarDatosActuales(data);
    setData(finalData);
    await saveFichaPersonalizada(mid, finalData);
    toast.success('Ficha técnica personalizada guardada.');
  };

  // Restablecer al catálogo
  const restablecer = async () => {
    await deleteFichaPersonalizada(mid);
    const inicial = construirFichaInicial(machine, options);
    setData(inicial);
    setNuevoCampoEtq('');
    setNuevoCampoVal('');
    setNuevoCampoCat('');
    toast.info('Valores restablecidos a los datos originales del catálogo.');
  };

  // Exportar PDF (vuelca cualquier campo escrito pendiente y guarda automáticamente)
  const handleExport = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const finalData = consolidarDatosActuales(data);
      setData(finalData);
      await saveFichaPersonalizada(mid, finalData);
      await onExport(finalData);
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
  const setSeccionFotosTitulo = (t: string) => setData((d) => (d ? { ...d, seccionFotosTitulo: t } : null));
  const setSeccionFotosTag = (t: string) => setData((d) => (d ? { ...d, seccionFotosTag: t } : null));
  const setFotoPrincipalLeyenda = (l: string) => setData((d) => (d ? { ...d, fotoPrincipalLeyenda: l } : null));
  const setFotoSecundariaLeyenda = (l: string) => setData((d) => (d ? { ...d, fotoSecundariaLeyenda: l } : null));

  // Manejo de fotos de Página 1
  const tomarFotoP1 = async (slot: 1 | 2, via: 'camara' | 'galeria') => {
    if (fotoTomando) return;
    setFotoTomando(true);
    try {
      const res = via === 'galeria' ? await elegirFotoLocal() : await capturarFotoLocal();
      if (res.ok && res.dataUrl) {
        if (slot === 1) {
          setData((d) => (d ? {
            ...d,
            fotoPrincipalUrl: res.dataUrl,
            fotoPrincipalLeyenda: d.fotoPrincipalLeyenda || 'Vista general de la unidad en campo operativo',
          } : null));
        } else {
          setData((d) => (d ? {
            ...d,
            fotoSecundariaUrl: res.dataUrl,
            fotoSecundariaLeyenda: d.fotoSecundariaLeyenda || 'Vista posterior / lateral del equipo',
          } : null));
        }
        toast.success(`Foto ${slot} de Página 1 actualizada.`);
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setFotoTomando(false);
    }
  };

  const eliminarFotoP1 = (slot: 1 | 2) => {
    if (slot === 1) {
      setData((d) => (d ? { ...d, fotoPrincipalUrl: null, fotoPrincipalLeyenda: null } : null));
    } else {
      setData((d) => (d ? { ...d, fotoSecundariaUrl: null, fotoSecundariaLeyenda: null } : null));
    }
    toast.info(`Foto ${slot} de Página 1 quitada.`);
  };

  // Agregar / editar / quitar renglón
  const agregarRenglon = () => {
    const catActiva = catRenglonSel === '__otra__' ? (nuevoCampoCat.trim() || 'Componentes Principales') : catRenglonSel;
    const nuevo = resolverNuevoRenglon({
      categoriaSeleccionada: catActiva,
      categoria: catRenglonSel === '__otra__' ? nuevoCampoCat : '',
      etiqueta: nuevoCampoEtq,
      valor: nuevoCampoVal,
    });
    if (!nuevo) {
      toast.error('Escribe el nombre del campo o su valor para añadir el renglón.');
      return;
    }
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, renglones: [...(d.renglones ?? []), nuevo] };
      saveFichaPersonalizada(mid, next).catch(() => {});
      return next;
    });
    setNuevoCampoEtq('');
    setNuevoCampoVal('');
    toast.success(`Renglón "${nuevo.etiqueta}" agregado.`);
  };

  const agregarFilaDirecta = (categoria: 'Datos Generales' | 'Componentes Principales') => {
    const nuevo: FichaRenglon = {
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      categoria,
      etiqueta: 'Nuevo campo',
      valor: '',
    };
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, renglones: [...(d.renglones ?? []), nuevo] };
      return next;
    });
  };

  const actualizarRenglon = (id: string, patch: Partial<FichaRenglon>) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        renglones: (d.renglones ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      };
      saveFichaPersonalizada(mid, next).catch(() => {});
      return next;
    });
  };

  const alternarCategoriaRenglon = (id: string) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        renglones: (d.renglones ?? []).map((r) => {
          if (r.id !== id) return r;
          const catActual = String(r.categoria ?? '').trim();
          const nuevaCat = catActual === 'Datos Generales' ? 'Componentes Principales' : 'Datos Generales';
          return { ...r, categoria: nuevaCat };
        }),
      };
      saveFichaPersonalizada(mid, next).catch(() => {});
      return next;
    });
  };

  const eliminarRenglon = (id: string) => {
    setData((d) => {
      if (!d) return null;
      const ocultos = new Set(d.renglonesOcultos ?? []);
      ocultos.add(id);
      const next: FichaPersonalizada = {
        ...d,
        renglones: (d.renglones ?? []).filter((r) => r.id !== id),
        renglonesOcultos: Array.from(ocultos),
      };
      saveFichaPersonalizada(mid, next).catch(() => {});
      return next;
    });
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

                {/* Lista de renglones existentes (editables en vivo) */}
                <View style={{ maxHeight: 280, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                  <ScrollView nestedScrollEnabled style={{ padding: 6 }}>
                    {(data.renglones ?? []).map((r, idx) => (
                      <View
                        key={r.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingVertical: 5,
                          paddingHorizontal: 4,
                          borderBottomWidth: idx === (data.renglones ?? []).length - 1 ? 0 : 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <View style={{ flex: 1, gap: 4 }}>
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            <TextInput
                              value={r.etiqueta}
                              onChangeText={(txt) => actualizarRenglon(r.id, { etiqueta: txt })}
                              placeholder="Nombre del campo"
                              placeholderTextColor={colors.muted}
                              style={{
                                flex: 1,
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                fontSize: 11,
                                fontWeight: '700',
                                color: '#16324F',
                              }}
                            />
                            <TextInput
                              value={r.valor}
                              onChangeText={(txt) => actualizarRenglon(r.id, { valor: txt })}
                              placeholder="Valor"
                              placeholderTextColor={colors.muted}
                              style={{
                                flex: 1.3,
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                fontSize: 11,
                                color: colors.text,
                              }}
                            />
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <TouchableOpacity
                              onPress={() => alternarCategoriaRenglon(r.id)}
                              style={{
                                backgroundColor: colors.surfaceAlt,
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: radius.sm,
                                borderWidth: 1,
                                borderColor: colors.border,
                              }}
                            >
                              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700' }}>
                                📂 {r.categoria || 'Componentes Principales'} (toca para cambiar columna)
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => eliminarRenglon(r.id)} style={{ padding: 6 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>✕</Text>
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

                {/* Botones rápidos para insertar fila directo en cada columna */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.xs, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    onPress={() => agregarFilaDirecta('Datos Generales')}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 5,
                      paddingHorizontal: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 10.5 }}>
                      + Fila en Datos Generales
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => agregarFilaDirecta('Componentes Principales')}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 5,
                      paddingHorizontal: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 10.5 }}>
                      + Fila en Componentes Principales
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Formulario para agregar renglón */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>
                    + Agregar campo o renglón a la tabla:
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginRight: 2 }}>Columna:</Text>
                    {(['Datos Generales', 'Componentes Principales', '__otra__'] as const).map((opCat) => {
                      const activo = catRenglonSel === opCat;
                      const label = opCat === '__otra__' ? 'Otra sección…' : opCat;
                      return (
                        <TouchableOpacity
                          key={opCat}
                          onPress={() => setCatRenglonSel(opCat)}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: radius.pill,
                            backgroundColor: activo ? '#16324F' : colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: activo ? '#16324F' : colors.border,
                          }}
                        >
                          <Text style={{ color: activo ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {catRenglonSel === '__otra__' ? (
                    <TextInput
                      value={nuevoCampoCat}
                      onChangeText={setNuevoCampoCat}
                      placeholder="Nombre de la sección (ej. Sistema Hidráulico)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 4 }}
                    />
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput
                      value={nuevoCampoEtq}
                      onChangeText={setNuevoCampoEtq}
                      placeholder="Nombre del campo (ej. Motor, Voltaje, Capacidad)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1.2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TextInput
                      value={nuevoCampoVal}
                      onChangeText={setNuevoCampoVal}
                      onSubmitEditing={agregarRenglon}
                      placeholder="Valor (ej. Cummins 6BT, 1.2 m³)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1.4, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TouchableOpacity
                      onPress={agregarRenglon}
                      style={{ flex: 0.7, backgroundColor: '#16324F', borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>+ Añadir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* SECCIÓN 4: FOTOS DE LA PRIMERA PÁGINA (VISTA GENERAL DEL EQUIPO) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    🖼️ Fotos de Página 1 (Vista General del Equipo)
                  </Text>
                  <View style={{ backgroundColor: '#0284c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 1</Text>
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Se muestran lado a lado debajo de las especificaciones principales (estilo catálogo oficial).
                </Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Título de la sección de fotos:</Text>
                    <TextInput
                      value={data.seccionFotosTitulo ?? ''}
                      onChangeText={setSeccionFotosTitulo}
                      placeholder="VISTA GENERAL DEL EQUIPO"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Etiqueta lateral:</Text>
                    <TextInput
                      value={data.seccionFotosTag ?? ''}
                      onChangeText={setSeccionFotosTag}
                      placeholder="Vista en Terreno"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                </View>

                {/* Grid con las 2 fotos de Página 1 */}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {/* FOTO 1: PRINCIPAL */}
                  <View style={{ flex: 1, minWidth: 240, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>Foto 1 · Principal (Vista Lateral / Frontal)</Text>
                      {data.fotoPrincipalUrl ? (
                        <TouchableOpacity onPress={() => eliminarFotoP1(1)} style={{ padding: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {data.fotoPrincipalUrl ? (
                      <View style={{ height: 110, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 6, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border }}>
                        <Image source={{ uri: data.fotoPrincipalUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
                      </View>
                    ) : (
                      <View style={{ height: 70, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 6, backgroundColor: colors.background }}>
                        <Text style={{ color: colors.muted, fontSize: 10 }}>Sin foto principal</Text>
                      </View>
                    )}

                    <TextInput
                      value={data.fotoPrincipalLeyenda ?? ''}
                      onChangeText={setFotoPrincipalLeyenda}
                      placeholder="Leyenda (ej. Vista general en campo operativo)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text, marginBottom: 6 }}
                    />

                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(1, 'camara')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>📷 Cámara</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(1, 'galeria')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* FOTO 2: SECUNDARIA */}
                  <View style={{ flex: 1, minWidth: 240, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>Foto 2 · Secundaria (Vista Posterior / Cabina)</Text>
                      {data.fotoSecundariaUrl ? (
                        <TouchableOpacity onPress={() => eliminarFotoP1(2)} style={{ padding: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {data.fotoSecundariaUrl ? (
                      <View style={{ height: 110, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 6, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border }}>
                        <Image source={{ uri: data.fotoSecundariaUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
                      </View>
                    ) : (
                      <View style={{ height: 70, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 6, backgroundColor: colors.background }}>
                        <Text style={{ color: colors.muted, fontSize: 10 }}>Opcional: si se omite, la Foto 1 ocupará el ancho</Text>
                      </View>
                    )}

                    <TextInput
                      value={data.fotoSecundariaLeyenda ?? ''}
                      onChangeText={setFotoSecundariaLeyenda}
                      placeholder="Leyenda (ej. Vista posterior de equipos auxiliares)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text, marginBottom: 6 }}
                    />

                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(2, 'camara')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>📷 Cámara</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(2, 'galeria')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>

              {/* SECCIÓN 5: APARTADO DE OBSERVACIONES Y CUADROS DE TEXTO (PÁGINA 2) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    📝 Observaciones y Condiciones Técnicas (Página 2)
                  </Text>
                  <View style={{ backgroundColor: '#64748b', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 2</Text>
                  </View>
                </View>
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

              {/* SECCIÓN 6: FOTOS EXTRAS DE COMPONENTES (PÁGINA 2 / ANEXO) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    📷 Fotos de Componentes y Detalles (Página 2 / Anexo)
                  </Text>
                  <View style={{ backgroundColor: '#64748b', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 2</Text>
                  </View>
                </View>

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
