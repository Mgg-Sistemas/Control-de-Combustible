import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Linking, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { DateField } from './DateField';
import type { InformeArchivo } from '../types/database';
import {
  anularInformeArchivo, listarInformesArchivos, subirInformesArchivos, type ArchivoParaSubir,
} from '../lib/informesArchivosDb';
import {
  diaCaracas, fechaLegible, filtrarInformes, tamanoLegible, uploadersDe, urlDescarga,
} from '../lib/informesArchivos';

type Props = {
  /** Quién sube, para guardar el snapshot del autor desde la sesión. */
  nombreSubida?: string | null;
  /** Solo full control puede anular. Lo calcula CombustibleScreen. */
  puedeAnular: boolean;
};

/** Bandeja de informes subidos desde la PC. Se monta SOLO en web, dentro de
 *  Más → Combustible → pestaña 📁 Informes subidos. En teléfono no se crea. */
export default function InformesSubidosPanel({ nombreSubida, puedeAnular }: Props) {
  const { colors } = useTheme();
  const [filas, setFilas] = useState<InformeArchivo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [query, setQuery] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [uploadedBy, setUploadedBy] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [seleccion, setSeleccion] = useState<ArchivoParaSubir[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [confirmarId, setConfirmarId] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    const data = await listarInformesArchivos();
    setFilas(data);
    setCargando(false);
  };

  useEffect(() => { void cargar(); }, []);

  const uploaders = useMemo(() => uploadersDe(filas), [filas]);
  const visibles = useMemo(
    () => filtrarInformes(filas, { query, desde, hasta, uploadedBy }),
    [filas, query, desde, hasta, uploadedBy]
  );
  const rangoInvalido = !!desde && !!hasta && desde > hasta;
  const hayFiltros = !!query || !!desde || !!hasta || !!uploadedBy;

  const elegir = async () => {
    if (Platform.OS !== 'web') {
      setError('Esta bandeja solo está disponible en la versión de PC.');
      return;
    }
    setError('');
    setAviso('');
    const doc: any = (globalThis as any).document;
    const win: any = (globalThis as any).window;
    if (!doc?.createElement) return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '*/*';
    let done = false;
    const finish = (files: ArchivoParaSubir[] | null) => {
      if (done) return;
      done = true;
      win?.removeEventListener?.('focus', onFocus);
      if (files?.length) setSeleccion(files);
    };
    const onFocus = () => win?.setTimeout?.(() => finish(null), 1500);
    input.onchange = () => {
      const arr = input.files ? Array.from(input.files) : [];
      if (!arr.length) return finish(null);
      finish(arr.map((f: any) => ({
        name: String(f.name ?? 'archivo'),
        type: f.type || null,
        size: Number(f.size ?? 0),
        body: f,
      })));
    };
    win?.addEventListener?.('focus', onFocus);
    input.click();
  };

  const subir = async () => {
    if (!seleccion.length || subiendo) return;
    setSubiendo(true);
    setError('');
    setAviso('');
    const r = await subirInformesArchivos({ archivos: seleccion, tituloBase: titulo, nombreSubida });
    setSubiendo(false);
    if (!r.ok || !r.docs?.length) {
      setError(r.error ?? 'No se pudo subir ningún archivo.');
      return;
    }
    setSeleccion([]);
    setTitulo('');
    setAviso(`Se subió ${r.docs.length} archivo${r.docs.length === 1 ? '' : 's'}.`);
    await cargar();
  };

  const anular = async (id: string) => {
    if (!puedeAnular || confirmarId !== id) return;
    setError('');
    const r = await anularInformeArchivo(id);
    setConfirmarId(null);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo anular. Requiere control total.');
      return;
    }
    setAviso('Informe anulado. Queda en el historial, ya no aparece en la lista.');
    await cargar();
  };

  const limpiarFiltros = () => {
    setQuery(''); setDesde(''); setHasta(''); setUploadedBy(null);
  };

  const abrir = (url: string) => { void Linking.openURL(url).catch(() => setError('No se pudo abrir el archivo.')); };
  const descargar = (row: InformeArchivo) => { void Linking.openURL(urlDescarga(row.publicUrl, row.fileName)).catch(() => setError('No se pudo descargar el archivo.')); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.md, gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>📁 Informes subidos</Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          Archivos de combustible subidos desde la PC. Se guardan con tu nombre y la fecha de subida.
        </Text>
      </View>

      {!!error && <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoftBorder, backgroundColor: colors.dangerSoftBg }}><Text style={{ color: colors.dangerSoftText, fontWeight: '700' }}>{error}</Text></View>}
      {!!aviso && <View style={{ padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.successSoftBorder, backgroundColor: colors.successSoftBg }}><Text style={{ color: colors.successSoftText, fontWeight: '700' }}>{aviso}</Text></View>}

      {/* Subida */}
      <View style={{ padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>⬆️ Subir informe(s)</Text>
        <TextInput
          value={titulo}
          onChangeText={setTitulo}
          placeholder="Título (opcional). Ej.: Valuación 01 — noviembre"
          placeholderTextColor={colors.muted}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, color: colors.text, backgroundColor: colors.surfaceAlt }}
        />
        <TouchableOpacity onPress={elegir} style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>📎 Elegir archivos</Text>
        </TouchableOpacity>
        {!!seleccion.length && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>{seleccion.length} archivo(s) elegido(s):</Text>
            {seleccion.map((a, i) => <Text key={`${a.name}-${i}`} style={{ fontSize: 12, color: colors.text }} numberOfLines={1}>· {a.name}</Text>)}
            <TouchableOpacity disabled={subiendo} onPress={subir} style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.primary, opacity: subiendo ? 0.6 : 1 }}>
              {subiendo ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬆️ Subir {seleccion.length} archivo(s)</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Buscador */}
      <View style={{ padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>🔎 Buscar</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Nombre del archivo, título o quien lo subió"
          placeholderTextColor={colors.muted}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, color: colors.text, backgroundColor: colors.surfaceAlt }}
        />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <View style={{ minWidth: 150 }}><DateField label="Desde" value={desde} onChange={setDesde} /></View>
          <View style={{ minWidth: 150 }}><DateField label="Hasta" value={hasta} onChange={setHasta} /></View>
        </View>
        {rangoInvalido && <Text style={{ color: colors.danger, fontWeight: '700' }}>La fecha «Hasta» es anterior a «Desde».</Text>}
        {!!uploaders.length && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Subido por:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity onPress={() => setUploadedBy(null)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: !uploadedBy ? colors.primary : colors.border, backgroundColor: !uploadedBy ? colors.primary : colors.surface }}>
                  <Text style={{ color: !uploadedBy ? colors.primaryContrast : colors.text, fontWeight: '700' }}>Todos</Text>
                </TouchableOpacity>
                {uploaders.map((u) => {
                  const on = uploadedBy === u.id;
                  return (
                    <TouchableOpacity key={u.id} onPress={() => setUploadedBy(on ? null : u.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700' }}>{u.nombre}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
        <TouchableOpacity onPress={limpiarFiltros} disabled={!hayFiltros} style={{ alignSelf: 'flex-start', opacity: hayFiltros ? 1 : 0.4 }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Limpiar filtros</Text>
        </TouchableOpacity>
      </View>

      {/* Lista */}
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>
          {cargando ? 'Cargando…' : `${visibles.length} informe(s)${hayFiltros ? ` de ${filas.length}` : ''}`}
        </Text>
        {!cargando && !visibles.length && (
          <View style={{ padding: spacing.lg, alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.muted, textAlign: 'center' }}>{filas.length ? 'No hay informes que coincidan con la búsqueda.' : 'Aún no hay informes subidos.'}</Text>
          </View>
        )}
        {visibles.map((r) => (
          <View key={r.id} style={{ padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }} numberOfLines={2}>{r.titulo}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>📄 {r.fileName} · {tamanoLegible(r.sizeBytes)}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              👤 {r.uploadedByNombre || 'Sin nombre'} · 🕒 {fechaLegible(r.createdAt)} · {diaCaracas(r.createdAt)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <TouchableOpacity onPress={() => abrir(r.publicUrl)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary }}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>👁️ Abrir</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => descargar(r)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary }}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>⬇️ Descargar</Text>
              </TouchableOpacity>
              {puedeAnular && (
                <TouchableOpacity
                  onPress={() => confirmarId === r.id ? anular(r.id) : setConfirmarId(r.id)}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, backgroundColor: confirmarId === r.id ? colors.danger : colors.surface }}
                >
                  <Text style={{ color: confirmarId === r.id ? colors.primaryContrast : colors.danger, fontWeight: '700' }}>
                    {confirmarId === r.id ? 'Confirmar anular' : 'Anular'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
