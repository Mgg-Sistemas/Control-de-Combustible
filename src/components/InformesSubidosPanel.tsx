import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Linking, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { DateField } from './DateField';
import type { InformeArchivo } from '../types/database';
import {
  anularInformeArchivo, eliminarInformeArchivo, listarInformesArchivos, restaurarInformeArchivo, subirInformesArchivos, type ArchivoParaSubir,
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
  const [accionPendiente, setAccionPendiente] = useState<{ id: string; tipo: 'anular' | 'eliminar' } | null>(null);
  const [procesandoId, setProcesandoId] = useState<string | null>(null);
  const [verAnulados, setVerAnulados] = useState(false);

  const cargar = async (incluirAnulados = verAnulados) => {
    setCargando(true);
    const data = await listarInformesArchivos({ incluirAnulados: puedeAnular && incluirAnulados });
    setFilas(data);
    setCargando(false);
  };

  useEffect(() => { void cargar(verAnulados); }, [verAnulados, puedeAnular]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploaders = useMemo(() => uploadersDe(filas), [filas]);
  const anuladosCount = useMemo(() => filas.filter((f) => !!f.anuladoAt).length, [filas]);
  const visibles = useMemo(
    () => filtrarInformes(filas, { query, desde, hasta, uploadedBy, incluirAnulados: puedeAnular && verAnulados }),
    [filas, query, desde, hasta, uploadedBy, puedeAnular, verAnulados]
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
    if (!puedeAnular || procesandoId) return;
    setError('');
    setAviso('');
    setProcesandoId(id);
    const r = await anularInformeArchivo(id, nombreSubida);
    setProcesandoId(null);
    setAccionPendiente(null);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo anular. Requiere control total.');
      return;
    }
    setAviso('Informe anulado. Ya no aparece en la bandeja activa (puedes consultarlo con «👁️ Ver anulados»).');
    await cargar();
  };

  const restaurar = async (id: string) => {
    if (!puedeAnular || procesandoId) return;
    setError('');
    setAviso('');
    setProcesandoId(id);
    const r = await restaurarInformeArchivo(id);
    setProcesandoId(null);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo restaurar el informe.');
      return;
    }
    setAviso('Informe restaurado a la bandeja activa.');
    await cargar();
  };

  const eliminar = async (row: InformeArchivo) => {
    if (!puedeAnular || procesandoId) return;
    setError('');
    setAviso('');
    setProcesandoId(row.id);
    const r = await eliminarInformeArchivo(row.id, row.storagePath);
    setProcesandoId(null);
    setAccionPendiente(null);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo eliminar. Requiere control total.');
      return;
    }
    setAviso(`Informe «${row.titulo}» eliminado definitivamente.`);
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
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
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <TouchableOpacity onPress={limpiarFiltros} disabled={!hayFiltros} style={{ opacity: hayFiltros ? 1 : 0.4 }}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Limpiar filtros</Text>
          </TouchableOpacity>
          {puedeAnular ? (
            <TouchableOpacity
              onPress={() => setVerAnulados((v) => !v)}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: verAnulados ? colors.warning : colors.border, backgroundColor: verAnulados ? colors.warning : colors.surface }}
            >
              <Text style={{ color: verAnulados ? colors.primaryContrast : colors.muted, fontWeight: '700', fontSize: 12 }}>
                {verAnulados ? `👁️ Viendo también anulados (${anuladosCount})` : '👁️ Ver anulados'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
        {visibles.map((r) => {
          const esAnulado = !!r.anuladoAt;
          const confirmandoAnular = accionPendiente?.id === r.id && accionPendiente.tipo === 'anular';
          const confirmandoEliminar = accionPendiente?.id === r.id && accionPendiente.tipo === 'eliminar';
          const ocupado = procesandoId === r.id;
          return (
            <View key={r.id} style={{ padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: esAnulado ? colors.warning : colors.border, backgroundColor: colors.surface, gap: 6, opacity: esAnulado ? 0.85 : 1 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text, flexShrink: 1 }} numberOfLines={2}>{r.titulo}</Text>
                {esAnulado ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: colors.dangerSoftText }}>🚫 ANULADO</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>📄 {r.fileName} · {tamanoLegible(r.sizeBytes)}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                👤 {r.uploadedByNombre || 'Sin nombre'} · 🕒 {fechaLegible(r.createdAt)} · {diaCaracas(r.createdAt)}
              </Text>
              {esAnulado ? (
                <Text style={{ fontSize: 11.5, color: colors.danger, fontWeight: '600' }}>
                  🚫 Anulado el {fechaLegible(r.anuladoAt!)}{r.anuladoPorNombre ? ` por ${r.anuladoPorNombre}` : ''}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <TouchableOpacity onPress={() => abrir(r.publicUrl)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary }}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>👁️ Abrir</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => descargar(r)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary }}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>⬇️ Descargar</Text>
                </TouchableOpacity>
                {puedeAnular && !esAnulado ? (
                  <TouchableOpacity
                    disabled={ocupado}
                    onPress={() => setAccionPendiente(confirmandoAnular ? null : { id: r.id, tipo: 'anular' })}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.warning, backgroundColor: confirmandoAnular ? colors.warning : colors.surface }}
                  >
                    <Text style={{ color: confirmandoAnular ? colors.primaryContrast : colors.warning, fontWeight: '700' }}>
                      🚫 Anular
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {puedeAnular && esAnulado ? (
                  <TouchableOpacity
                    disabled={ocupado}
                    onPress={() => restaurar(r.id)}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surface }}
                  >
                    <Text style={{ color: colors.success, fontWeight: '700' }}>
                      ↩️ Restaurar
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {puedeAnular ? (
                  <TouchableOpacity
                    disabled={ocupado}
                    onPress={() => setAccionPendiente(confirmandoEliminar ? null : { id: r.id, tipo: 'eliminar' })}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, backgroundColor: confirmandoEliminar ? colors.danger : colors.surface }}
                  >
                    <Text style={{ color: confirmandoEliminar ? '#fff' : colors.danger, fontWeight: '700' }}>
                      🗑️ Eliminar
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {confirmandoAnular ? (
                <View style={{ marginTop: 6, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surfaceAlt, gap: 8 }}>
                  <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '700' }}>
                    ¿Anular «{r.titulo}»? Dejará de verse en la bandeja activa, pero el archivo se conserva y podrás restaurarlo en «👁️ Ver anulados».
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <TouchableOpacity disabled={ocupado} onPress={() => anular(r.id)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.warning }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{ocupado ? 'Anulando…' : '✅ Sí, anular'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={ocupado} onPress={() => setAccionPendiente(null)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
              {confirmandoEliminar ? (
                <View style={{ marginTop: 6, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, gap: 8 }}>
                  <Text style={{ color: colors.dangerSoftText, fontSize: 12.5, fontWeight: '700' }}>
                    ⚠️ ¿Eliminar definitivamente «{r.titulo}»? Se borrará de la bandeja y del almacenamiento (solo quedará constancia en Auditoría).
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <TouchableOpacity disabled={ocupado} onPress={() => eliminar(r)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.danger }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>{ocupado ? 'Eliminando…' : '🗑️ Sí, eliminar definitivo'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={ocupado} onPress={() => setAccionPendiente(null)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                      <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
