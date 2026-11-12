// ============================================================================
// 📊 COMPONENTE COMPARTIDO DE CUPO Y AJUSTE DE LÍMITES (TELÉFONO Y PC)
//
// Se muestra en:
//  1) `src/screens/SolicitudesCompraTab.tsx` (Pestaña 📥 Solicitudes)
//  2) `src/screens/RequerimientoTab.tsx` (Pestaña 📝 Requerimiento)
//  3) `src/screens/SolicitudMaterialScreen.tsx` (Pantalla 🛒 Pedir Material / Repuestos)
//
// Incluye:
//  - Franja compacta de cupo en vivo (usados / límite disponible + barra de 4px).
//  - Selector rápido de cantidad de tarjetas visibles en pantalla (después de filtrar).
//  - Banner accionable cuando se alcanza el límite (con botones de 1 toque +1 / +5
//    para el administrador).
//  - Modal completo y táctil para que el administrador manipule el máximo para
//    todos los usuarios (y excepciones individuales) cuando lo necesite.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme';
import { useToast } from './ToastProvider';
import { leerNumero } from '../lib/numeros';
import {
  ConfigLimitesCompras,
  EstadoCupoOperativo,
  ExcepcionLimiteUsuario,
  ModoConteoLimite,
  OPCIONES_RAPIDAS_TOPE,
  OPCIONES_TARJETAS_VISIBLES,
  normalizarTopeEntero,
  normalizarTopeMontoUsd,
} from '../lib/limitesCompras';
import { guardarConfigLimitesComprasEnDB } from '../lib/limitesComprasStorage';

export interface UsuarioSimpleLimite {
  id: string;
  full_name: string;
  username?: string | null;
  role?: string | null;
}

interface Props {
  cupo: EstadoCupoOperativo;
  config: ConfigLimitesCompras;
  onChangeConfig: (nueva: ConfigLimitesCompras) => void;
  puedeConfigurar: boolean;
  userId?: string | null;
  usuarios?: UsuarioSimpleLimite[];
  /** Para el control de tarjetas visibles en la bandeja actual */
  totalFiltrados?: number;
  visiblesCount?: number;
  limiteTarjetasActual?: number;
  onChangeLimiteTarjetas?: (nuevoLimite: number) => void;
  onVerMisSolicitudes?: () => void;
}

export function CupoLimiteBanner({
  cupo,
  config,
  onChangeConfig,
  puedeConfigurar,
  userId,
  usuarios = [],
  totalFiltrados,
  visiblesCount,
  limiteTarjetasActual,
  onChangeLimiteTarjetas,
  onVerMisSolicitudes,
}: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const { width: viewportW } = useWindowDimensions();
  const isPhone = viewportW < 768;

  const [modalOpen, setModalOpen] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Estados editables del modal
  const [activo, setActivo] = useState(config.activo);
  const [maxSolTxt, setMaxSolTxt] = useState(String(config.maxSolicitudesPorUsuario || 0));
  const [modoSol, setModoSol] = useState<ModoConteoLimite>(config.modoConteoSolicitudes);
  const [maxItemsSolTxt, setMaxItemsSolTxt] = useState(String(config.maxItemsPorSolicitud || 0));

  const [maxReqTxt, setMaxReqTxt] = useState(String(config.maxRequerimientosPorUsuario || 0));
  const [modoReq, setModoReq] = useState<ModoConteoLimite>(config.modoConteoRequerimientos);
  const [maxItemsReqTxt, setMaxItemsReqTxt] = useState(String(config.maxItemsPorRequerimiento || 0));
  const [maxMontoReqTxt, setMaxMontoReqTxt] = useState(String(config.maxMontoUsdRequerimiento || 0));

  const [maxTarjetas, setMaxTarjetas] = useState<number>(config.maxTarjetasVisibles ?? 50);
  const [aplicarAAdmins, setAplicarAAdmins] = useState(Boolean(config.aplicarAAdmins));
  const [excepciones, setExcepciones] = useState<Record<string, ExcepcionLimiteUsuario>>(
    config.excepcionesPorUsuario || {},
  );

  // Buscador de usuario para excepción puntual
  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [usuarioExcSel, setUsuarioExcSel] = useState<UsuarioSimpleLimite | null>(null);
  const [excMaxSolTxt, setExcMaxSolTxt] = useState('');
  const [excMaxReqTxt, setExcMaxReqTxt] = useState('');
  const [excMaxMontoTxt, setExcMaxMontoTxt] = useState('');

  useEffect(() => {
    if (!modalOpen) {
      setActivo(config.activo);
      setMaxSolTxt(String(config.maxSolicitudesPorUsuario || 0));
      setModoSol(config.modoConteoSolicitudes);
      setMaxItemsSolTxt(String(config.maxItemsPorSolicitud || 0));
      setMaxReqTxt(String(config.maxRequerimientosPorUsuario || 0));
      setModoReq(config.modoConteoRequerimientos);
      setMaxItemsReqTxt(String(config.maxItemsPorRequerimiento || 0));
      setMaxMontoReqTxt(String(config.maxMontoUsdRequerimiento || 0));
      setMaxTarjetas(config.maxTarjetasVisibles ?? 50);
      setAplicarAAdmins(Boolean(config.aplicarAAdmins));
      setExcepciones(config.excepcionesPorUsuario || {});
    }
  }, [config, modalOpen]);

  const abrirModal = () => {
    setActivo(config.activo);
    setMaxSolTxt(String(config.maxSolicitudesPorUsuario || 0));
    setModoSol(config.modoConteoSolicitudes);
    setMaxItemsSolTxt(String(config.maxItemsPorSolicitud || 0));
    setMaxReqTxt(String(config.maxRequerimientosPorUsuario || 0));
    setModoReq(config.modoConteoRequerimientos);
    setMaxItemsReqTxt(String(config.maxItemsPorRequerimiento || 0));
    setMaxMontoReqTxt(String(config.maxMontoUsdRequerimiento || 0));
    setMaxTarjetas(config.maxTarjetasVisibles ?? 50);
    setAplicarAAdmins(Boolean(config.aplicarAAdmins));
    setExcepciones(config.excepcionesPorUsuario || {});
    setBusquedaUsuario('');
    setUsuarioExcSel(null);
    setModalOpen(true);
  };

  const ajustarNumeroTexto = (actualTxt: string, delta: number): string => {
    const actual = normalizarTopeEntero(actualTxt);
    const sig = Math.max(0, actual + delta);
    return String(sig);
  };

  const guardarCambioRapido = async (parcial: Partial<ConfigLimitesCompras>, mensajeExito: string) => {
    if (!puedeConfigurar || guardando) return;
    setGuardando(true);
    try {
      const res = await guardarConfigLimitesComprasEnDB(parcial, userId);
      if (!res.ok) {
        toast.error(res.error || 'No se pudo guardar el límite.');
        return;
      }
      onChangeConfig(res.config);
      if (parcial.maxTarjetasVisibles !== undefined && onChangeLimiteTarjetas) {
        onChangeLimiteTarjetas(res.config.maxTarjetasVisibles);
      }
      toast.success(mensajeExito);
    } finally {
      setGuardando(false);
    }
  };

  const guardarDesdeModal = async () => {
    if (!puedeConfigurar || guardando) return;
    const nuevoMaxSol = normalizarTopeEntero(maxSolTxt);
    const nuevoMaxItemsSol = normalizarTopeEntero(maxItemsSolTxt, 500);
    const nuevoMaxReq = normalizarTopeEntero(maxReqTxt);
    const nuevoMaxItemsReq = normalizarTopeEntero(maxItemsReqTxt, 500);
    const nuevoMaxMontoReq = normalizarTopeMontoUsd(maxMontoReqTxt);

    setGuardando(true);
    try {
      const res = await guardarConfigLimitesComprasEnDB(
        {
          activo,
          maxSolicitudesPorUsuario: nuevoMaxSol,
          modoConteoSolicitudes: modoSol,
          maxItemsPorSolicitud: nuevoMaxItemsSol,
          maxRequerimientosPorUsuario: nuevoMaxReq,
          modoConteoRequerimientos: modoReq,
          maxItemsPorRequerimiento: nuevoMaxItemsReq,
          maxMontoUsdRequerimiento: nuevoMaxMontoReq,
          maxTarjetasVisibles: maxTarjetas,
          aplicarAAdmins,
          excepcionesPorUsuario: excepciones,
        },
        userId,
      );
      if (!res.ok) {
        toast.error(res.error || 'No se pudo actualizar el límite.');
        return;
      }
      onChangeConfig(res.config);
      if (onChangeLimiteTarjetas) {
        onChangeLimiteTarjetas(res.config.maxTarjetasVisibles);
      }
      setModalOpen(false);
      toast.success('Límite máximo actualizado para todos los usuarios.');
    } finally {
      setGuardando(false);
    }
  };

  const agregarOActualizarExcepcion = () => {
    if (!usuarioExcSel) return;
    const ms = excMaxSolTxt.trim() === '' ? null : normalizarTopeEntero(excMaxSolTxt);
    const mr = excMaxReqTxt.trim() === '' ? null : normalizarTopeEntero(excMaxReqTxt);
    const mm = excMaxMontoTxt.trim() === '' ? null : normalizarTopeMontoUsd(excMaxMontoTxt);
    if (ms === null && mr === null && mm === null) {
      toast.error('Indica al menos un límite personalizado para este usuario.');
      return;
    }
    setExcepciones((prev) => ({
      ...prev,
      [usuarioExcSel.id]: {
        userId: usuarioExcSel.id,
        userName: usuarioExcSel.full_name,
        maxSolicitudes: ms,
        maxRequerimientos: mr,
        maxMontoUsd: mm,
      },
    }));
    setUsuarioExcSel(null);
    setBusquedaUsuario('');
    setExcMaxSolTxt('');
    setExcMaxReqTxt('');
    setExcMaxMontoTxt('');
  };

  const quitarExcepcion = (uid: string) => {
    setExcepciones((prev) => {
      const copia = { ...prev };
      delete copia[uid];
      return copia;
    });
  };

  const usuariosFiltrados = useMemo(() => {
    const q = busquedaUsuario.trim().toLowerCase();
    if (!q) return usuarios.slice(0, 8);
    return usuarios
      .filter(
        (u) =>
          (u.full_name || '').toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [usuarios, busquedaUsuario]);

  const iconoSem = cupo.enTope ? '🔴' : cupo.cercaDelTope ? '🟡' : '🟢';
  const colorBorde = cupo.enTope
    ? '#EF4444'
    : cupo.cercaDelTope
    ? '#F59E0B'
    : colors.border;
  const colorFondo = cupo.enTope
    ? '#FEF2F2'
    : cupo.cercaDelTope
    ? '#FFFBEB'
    : colors.surfaceAlt;
  const colorTexto = cupo.enTope
    ? '#991B1B'
    : cupo.cercaDelTope
    ? '#92400E'
    : colors.text;

  const campoTopeActual =
    cupo.tipo === 'solicitud' ? 'maxSolicitudesPorUsuario' : 'maxRequerimientosPorUsuario';

  return (
    <View style={{ marginBottom: spacing.sm, gap: 6 }}>
      {/* 1. FRANJA COMPACTA DE CUPO + CONTROL DE TARJETAS VISIBLES + BOTÓN ADMIN */}
      <View
        style={{
          backgroundColor: colorFondo,
          borderColor: colorBorde,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: 10,
          paddingVertical: 8,
          gap: 6,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, flex: 1 }}>
            <Text style={{ fontSize: 13 }}>{iconoSem}</Text>
            <Text style={{ color: colorTexto, fontWeight: '800', fontSize: 12 }}>
              {cupo.resumenCorto}
            </Text>
            {cupo.maxItems > 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                · Máx. {cupo.maxItems} renglones
              </Text>
            ) : null}
            {cupo.tipo === 'requerimiento' && cupo.maxMontoUsd > 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                · Tope: ${cupo.maxMontoUsd.toLocaleString('en-US')} USD
              </Text>
            ) : null}
            {cupo.exentoPorRol && cupo.limite > 0 ? (
              <View
                style={{
                  backgroundColor: '#DBEAFE',
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ color: '#1E40AF', fontSize: 10, fontWeight: '800' }}>
                  Admin sin bloqueo
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            {/* Selector de tarjetas visibles cuando hay listado */}
            {typeof totalFiltrados === 'number' && onChangeLimiteTarjetas ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                  Mostrando {visiblesCount ?? totalFiltrados} de {totalFiltrados}:
                </Text>
                {([30, 50, 100, 0] as const).map((op) => {
                  const act = (limiteTarjetasActual ?? 0) === op;
                  return (
                    <TouchableOpacity
                      key={op}
                      onPress={() => onChangeLimiteTarjetas(op)}
                      style={{
                        paddingHorizontal: 7,
                        paddingVertical: 3,
                        borderRadius: radius.pill,
                        backgroundColor: act ? colors.brand : colors.surface,
                        borderWidth: 1,
                        borderColor: act ? colors.brand : colors.border,
                      }}
                    >
                      <Text
                        style={{
                          color: act ? colors.brandContrast : colors.text,
                          fontSize: 10.5,
                          fontWeight: '800',
                        }}
                      >
                        {op === 0 ? 'Todas' : String(op)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {/* Botón directo para que el Administrador manipule el máximo cuando necesite */}
            {puedeConfigurar ? (
              <TouchableOpacity
                onPress={abrirModal}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.brand,
                  paddingHorizontal: 11,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Text style={{ fontSize: 12 }}>📊</Text>
                <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 11.5 }}>
                  Límite máximo {cupo.limite > 0 ? `(${cupo.limite})` : '(∞)'} · Ajustar
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Micro-barra de progreso de 4px cuando hay un tope > 0 */}
        {cupo.limite > 0 ? (
          <View
            style={{
              height: 4,
              backgroundColor: 'rgba(0,0,0,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.min(100, cupo.porcentaje)}%`,
                height: '100%',
                backgroundColor: cupo.enTope
                  ? '#DC2626'
                  : cupo.cercaDelTope
                  ? '#D97706'
                  : '#10B981',
              }}
            />
          </View>
        ) : null}
      </View>

      {/* 2. BANNER ACCIONABLE CUANDO SE ALCANZA EL TOPE (O PARA AMPLIAR EN 1 TOQUE) */}
      {cupo.limite > 0 && cupo.usados >= cupo.limite ? (
        <View
          style={{
            backgroundColor: '#FEF2F2',
            borderColor: '#DC2626',
            borderWidth: 1.5,
            borderLeftWidth: 5,
            borderRadius: radius.md,
            padding: spacing.sm,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ fontSize: 18 }}>🛑</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#991B1B', fontWeight: '900', fontSize: 13 }}>
                Límite máximo alcanzado ({cupo.usados} de {cupo.limite}{' '}
                {cupo.tipo === 'solicitud' ? 'solicitudes' : 'requerimientos'} {cupo.etiquetaModo})
              </Text>
              <Text style={{ color: '#7F1D1D', fontSize: 12, marginTop: 2 }}>
                {cupo.exentoPorRol
                  ? 'Como administrador puedes continuar, pero los demás usuarios han llegado al tope configurado.'
                  : cupo.motivoBloqueo}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {onVerMisSolicitudes ? (
              <TouchableOpacity
                onPress={onVerMisSolicitudes}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#DC2626',
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.sm,
                }}
              >
                <Text style={{ color: '#991B1B', fontWeight: '800', fontSize: 12 }}>
                  📋 Ver mis solicitudes activas
                </Text>
              </TouchableOpacity>
            ) : null}

            {puedeConfigurar ? (
              <>
                <TouchableOpacity
                  disabled={guardando}
                  onPress={() =>
                    guardarCambioRapido(
                      { [campoTopeActual]: cupo.limite + 1 },
                      `Límite ampliado a ${cupo.limite + 1}.`,
                    )
                  }
                  style={{
                    backgroundColor: '#16324F',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 12 }}>
                    ➕ Subir +1 (a {cupo.limite + 1})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={guardando}
                  onPress={() =>
                    guardarCambioRapido(
                      { [campoTopeActual]: cupo.limite + 5 },
                      `Límite ampliado a ${cupo.limite + 5}.`,
                    )
                  }
                  style={{
                    backgroundColor: '#0284C7',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 12 }}>
                    🚀 Subir +5 (a {cupo.limite + 5})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={guardando}
                  onPress={() =>
                    guardarCambioRapido(
                      { [campoTopeActual]: 0 },
                      'Límite desactivado (Sin límite máximo).',
                    )
                  }
                  style={{
                    backgroundColor: '#059669',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 12 }}>
                    ♾️ Poner Sin límite
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={abrirModal}
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#16324F',
                    borderWidth: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12 }}>
                    ⚙️ Elegir otro número
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* 3. MODAL DE AJUSTE DE LÍMITES PARA TODOS LOS USUARIOS */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.65)',
            justifyContent: 'center',
            padding: isPhone ? spacing.sm : spacing.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              borderRadius: radius.lg,
              maxHeight: '92%',
              width: '100%',
              maxWidth: 680,
              alignSelf: 'center',
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {/* Cabecera del Modal */}
            <View
              style={{
                backgroundColor: '#16324F',
                padding: spacing.md,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 16 }}>
                  📊 Límite Máximo para Solicitudes y Requerimientos
                </Text>
                <Text style={{ color: '#AFC4DB', fontSize: 11.5, marginTop: 2 }}>
                  Ajusta el máximo permitido para todos los usuarios cuando lo necesites (0 = Sin límite).
                </Text>
              </View>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={{ padding: 6 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '900' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
              {/* Interruptor global */}
              <TouchableOpacity
                onPress={() => setActivo((v) => !v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: activo ? '#ECFDF5' : colors.surfaceAlt,
                  borderWidth: 1.5,
                  borderColor: activo ? '#10B981' : colors.border,
                  marginBottom: spacing.md,
                }}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: activo ? '#065F46' : colors.text, fontWeight: '900', fontSize: 13 }}>
                    {activo ? '✅ Control de límites ACTIVO' : '⏸️ Control de límites PAUSADO (Sin límites)'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>
                    Toca aquí para encender o apagar todos los límites de un solo toque.
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: activo ? '#10B981' : colors.muted,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 11 }}>
                    {activo ? 'ACTIVO' : 'APAGADO'}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* BLOQUE 1: SOLICITUDES DE COMPRA */}
              <View
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  marginBottom: spacing.md,
                  gap: 10,
                }}
              >
                <Text style={{ color: '#16324F', fontWeight: '900', fontSize: 14 }}>
                  📥 1. Límite en Solicitudes de Compra (Personal y Taller)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                  Cantidad máxima de solicitudes de compra que cada usuario puede tener al mismo tiempo (o por jornada). Escribe 0 para dejarlo sin límite (∞).
                </Text>

                {/* Steppers grandes + input */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    onPress={() => setMaxSolTxt((t) => ajustarNumeroTexto(t, -5))}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>−5</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setMaxSolTxt((t) => ajustarNumeroTexto(t, -1))}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>−1</Text>
                  </TouchableOpacity>

                  <TextInput
                    value={maxSolTxt}
                    onChangeText={setMaxSolTxt}
                    keyboardType="numeric"
                    placeholder="0 = Sin límite"
                    placeholderTextColor={colors.muted}
                    style={{
                      minWidth: 90,
                      textAlign: 'center',
                      backgroundColor: colors.background,
                      borderWidth: 1.5,
                      borderColor: '#16324F',
                      borderRadius: radius.md,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      color: colors.text,
                      fontWeight: '900',
                      fontSize: 16,
                    }}
                  />

                  <TouchableOpacity
                    onPress={() => setMaxSolTxt((t) => ajustarNumeroTexto(t, 1))}
                    style={{
                      backgroundColor: '#16324F',
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 14 }}>+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setMaxSolTxt((t) => ajustarNumeroTexto(t, 5))}
                    style={{
                      backgroundColor: '#0284C7',
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 14 }}>+5</Text>
                  </TouchableOpacity>

                  <View
                    style={{
                      backgroundColor: normalizarTopeEntero(maxSolTxt) > 0 ? '#FEF3C7' : '#DCFCE7',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                    }}
                  >
                    <Text
                      style={{
                        color: normalizarTopeEntero(maxSolTxt) > 0 ? '#92400E' : '#166534',
                        fontWeight: '900',
                        fontSize: 11.5,
                      }}
                    >
                      {normalizarTopeEntero(maxSolTxt) > 0
                        ? `Máx. ${normalizarTopeEntero(maxSolTxt)} por usuario`
                        : '♾️ Sin límite activo'}
                    </Text>
                  </View>
                </View>

                {/* Botones rápidos de 1 toque */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {OPCIONES_RAPIDAS_TOPE.map((n) => {
                    const act = normalizarTopeEntero(maxSolTxt) === n;
                    return (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setMaxSolTxt(String(n))}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: act ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: act ? '#16324F' : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: act ? '#FFFFFF' : colors.text,
                            fontWeight: '800',
                            fontSize: 11.5,
                          }}
                        >
                          {n === 0 ? '♾️ Sin límite' : `${n} solicitudes`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Modo de conteo de Solicitudes */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {(
                    [
                      ['activos', '📌 Contar las que están en curso (pendientes)'],
                      ['jornada', '☀️ Contar las creadas hoy (jornada 7am a 7am)'],
                    ] as const
                  ).map(([mVal, mLbl]) => {
                    const act = modoSol === mVal;
                    return (
                      <TouchableOpacity
                        key={mVal}
                        onPress={() => setModoSol(mVal)}
                        style={{
                          flex: 1,
                          minWidth: 200,
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: radius.sm,
                          backgroundColor: act ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: act ? '#16324F' : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: act ? '#FFFFFF' : colors.text,
                            fontWeight: '800',
                            fontSize: 11.5,
                          }}
                        >
                          {mLbl}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Máximo de renglones por solicitud */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    paddingTop: 6,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                    Máximo de productos/renglones por cada Solicitud (0 = sin límite):
                  </Text>
                  <TextInput
                    value={maxItemsSolTxt}
                    onChangeText={setMaxItemsSolTxt}
                    keyboardType="numeric"
                    style={{
                      width: 80,
                      textAlign: 'center',
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 6,
                      color: colors.text,
                      fontWeight: '800',
                      fontSize: 13,
                    }}
                  />
                </View>
              </View>

              {/* BLOQUE 2: REQUERIMIENTOS DE COMPRA */}
              <View
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  marginBottom: spacing.md,
                  gap: 10,
                }}
              >
                <Text style={{ color: '#16324F', fontWeight: '900', fontSize: 14 }}>
                  📝 2. Límite en Requerimientos de Compra
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                  Cantidad máxima de requerimientos por usuario y tope opcional de monto en dólares ($ USD) por requerimiento.
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    onPress={() => setMaxReqTxt((t) => ajustarNumeroTexto(t, -5))}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>−5</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setMaxReqTxt((t) => ajustarNumeroTexto(t, -1))}
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>−1</Text>
                  </TouchableOpacity>

                  <TextInput
                    value={maxReqTxt}
                    onChangeText={setMaxReqTxt}
                    keyboardType="numeric"
                    placeholder="0 = Sin límite"
                    placeholderTextColor={colors.muted}
                    style={{
                      minWidth: 90,
                      textAlign: 'center',
                      backgroundColor: colors.background,
                      borderWidth: 1.5,
                      borderColor: '#16324F',
                      borderRadius: radius.md,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      color: colors.text,
                      fontWeight: '900',
                      fontSize: 16,
                    }}
                  />

                  <TouchableOpacity
                    onPress={() => setMaxReqTxt((t) => ajustarNumeroTexto(t, 1))}
                    style={{
                      backgroundColor: '#16324F',
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 14 }}>+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setMaxReqTxt((t) => ajustarNumeroTexto(t, 5))}
                    style={{
                      backgroundColor: '#0284C7',
                      borderRadius: radius.md,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 14 }}>+5</Text>
                  </TouchableOpacity>

                  <View
                    style={{
                      backgroundColor: normalizarTopeEntero(maxReqTxt) > 0 ? '#FEF3C7' : '#DCFCE7',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                    }}
                  >
                    <Text
                      style={{
                        color: normalizarTopeEntero(maxReqTxt) > 0 ? '#92400E' : '#166534',
                        fontWeight: '900',
                        fontSize: 11.5,
                      }}
                    >
                      {normalizarTopeEntero(maxReqTxt) > 0
                        ? `Máx. ${normalizarTopeEntero(maxReqTxt)} por usuario`
                        : '♾️ Sin límite activo'}
                    </Text>
                  </View>
                </View>

                {/* Botones rápidos de 1 toque */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {OPCIONES_RAPIDAS_TOPE.map((n) => {
                    const act = normalizarTopeEntero(maxReqTxt) === n;
                    return (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setMaxReqTxt(String(n))}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: act ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: act ? '#16324F' : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: act ? '#FFFFFF' : colors.text,
                            fontWeight: '800',
                            fontSize: 11.5,
                          }}
                        >
                          {n === 0 ? '♾️ Sin límite' : `${n} requerimientos`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Modo de conteo de Requerimientos */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {(
                    [
                      ['activos', '📌 Contar los que están en curso (pendientes)'],
                      ['jornada', '☀️ Contar los creados hoy (jornada 7am a 7am)'],
                    ] as const
                  ).map(([mVal, mLbl]) => {
                    const act = modoReq === mVal;
                    return (
                      <TouchableOpacity
                        key={mVal}
                        onPress={() => setModoReq(mVal)}
                        style={{
                          flex: 1,
                          minWidth: 200,
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: radius.sm,
                          backgroundColor: act ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: act ? '#16324F' : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: act ? '#FFFFFF' : colors.text,
                            fontWeight: '800',
                            fontSize: 11.5,
                          }}
                        >
                          {mLbl}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Monto máximo en USD por requerimiento */}
                <View
                  style={{
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    gap: 6,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                      💵 Monto máximo en USD ($) por Requerimiento (0 = sin límite):
                    </Text>
                    <TextInput
                      value={maxMontoReqTxt}
                      onChangeText={setMaxMontoReqTxt}
                      keyboardType="decimal-pad"
                      placeholder="0 = Sin límite"
                      style={{
                        width: 110,
                        textAlign: 'center',
                        backgroundColor: colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        paddingVertical: 6,
                        color: colors.text,
                        fontWeight: '800',
                        fontSize: 13,
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {([0, 500, 1000, 2500, 5000, 10000] as const).map((mUsd) => {
                      const act = Math.abs(normalizarTopeMontoUsd(maxMontoReqTxt) - mUsd) < 0.01;
                      return (
                        <TouchableOpacity
                          key={mUsd}
                          onPress={() => setMaxMontoReqTxt(String(mUsd))}
                          style={{
                            paddingHorizontal: 9,
                            paddingVertical: 5,
                            borderRadius: radius.pill,
                            backgroundColor: act ? '#0284C7' : colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: act ? '#0284C7' : colors.border,
                          }}
                        >
                          <Text
                            style={{
                              color: act ? '#FFFFFF' : colors.text,
                              fontWeight: '800',
                              fontSize: 11,
                            }}
                          >
                            {mUsd === 0 ? '♾️ Sin tope $' : `$${mUsd.toLocaleString('en-US')}`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Máximo de renglones por requerimiento */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    paddingTop: 6,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                    Máximo de productos/renglones por cada Requerimiento (0 = sin límite):
                  </Text>
                  <TextInput
                    value={maxItemsReqTxt}
                    onChangeText={setMaxItemsReqTxt}
                    keyboardType="numeric"
                    style={{
                      width: 80,
                      textAlign: 'center',
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 6,
                      color: colors.text,
                      fontWeight: '800',
                      fontSize: 13,
                    }}
                  />
                </View>
              </View>

              {/* BLOQUE 3: TARJETAS VISIBLES Y ALCANCE POR USUARIO */}
              <View
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  marginBottom: spacing.md,
                  gap: 10,
                }}
              >
                <Text style={{ color: '#16324F', fontWeight: '900', fontSize: 14 }}>
                  👥 3. Visualización en Bandejas, Administradores y Excepciones
                </Text>

                <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                  Cantidad de tarjetas visibles por defecto en las bandejas de Solicitudes y Requerimientos (después de aplicar filtros):
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {OPCIONES_TARJETAS_VISIBLES.map((op) => {
                    const act = maxTarjetas === op;
                    return (
                      <TouchableOpacity
                        key={op}
                        onPress={() => setMaxTarjetas(op)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: act ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: act ? '#16324F' : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: act ? '#FFFFFF' : colors.text,
                            fontWeight: '800',
                            fontSize: 11.5,
                          }}
                        >
                          {op === 0 ? 'Mostrar Todas' : `${op} tarjetas`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Aplicar también a Administradores */}
                <TouchableOpacity
                  onPress={() => setAplicarAAdmins((v) => !v)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{aplicarAAdmins ? '☑️' : '⬜'}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, flex: 1 }}>
                    Aplicar el bloqueo también a los usuarios con rol Administrador (si está desmarcado, los administradores pueden crear sin bloqueo en caso de emergencia).
                  </Text>
                </TouchableOpacity>

                {/* Excepciones puntuales por usuario */}
                {usuarios.length > 0 ? (
                  <View
                    style={{
                      paddingTop: 8,
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      gap: 8,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                      🎯 Límite personalizado para un usuario específico (opcional):
                    </Text>

                    {Object.values(excepciones).length > 0 ? (
                      <View style={{ gap: 6 }}>
                        {Object.values(excepciones).map((exc) => (
                          <View
                            key={exc.userId}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: colors.surfaceAlt,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              borderWidth: 1,
                              borderColor: colors.border,
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                                👤 {exc.userName || exc.userId}
                              </Text>
                              <Text style={{ color: colors.muted, fontSize: 11 }}>
                                {[
                                  exc.maxSolicitudes !== null && exc.maxSolicitudes !== undefined
                                    ? `Solicitudes: ${exc.maxSolicitudes === 0 ? '∞' : exc.maxSolicitudes}`
                                    : null,
                                  exc.maxRequerimientos !== null && exc.maxRequerimientos !== undefined
                                    ? `Requerimientos: ${exc.maxRequerimientos === 0 ? '∞' : exc.maxRequerimientos}`
                                    : null,
                                  exc.maxMontoUsd !== null && exc.maxMontoUsd !== undefined
                                    ? `Tope $: ${exc.maxMontoUsd === 0 ? '∞' : `$${exc.maxMontoUsd}`}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => quitarExcepcion(exc.userId)}
                              style={{ padding: 4 }}
                            >
                              <Text style={{ color: '#DC2626', fontWeight: '900', fontSize: 12 }}>
                                ✕ Quitar
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    <TextInput
                      value={busquedaUsuario}
                      onChangeText={setBusquedaUsuario}
                      placeholder="🔎 Buscar usuario para asignarle un límite propio…"
                      placeholderTextColor={colors.muted}
                      style={{
                        backgroundColor: colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        padding: 8,
                        color: colors.text,
                        fontSize: 12,
                      }}
                    />

                    {busquedaUsuario.trim() ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {usuariosFiltrados.map((u) => {
                          const sel = usuarioExcSel?.id === u.id;
                          return (
                            <TouchableOpacity
                              key={u.id}
                              onPress={() => {
                                setUsuarioExcSel(u);
                                const prev = excepciones[u.id];
                                setExcMaxSolTxt(
                                  prev?.maxSolicitudes !== null && prev?.maxSolicitudes !== undefined
                                    ? String(prev.maxSolicitudes)
                                    : '',
                                );
                                setExcMaxReqTxt(
                                  prev?.maxRequerimientos !== null &&
                                    prev?.maxRequerimientos !== undefined
                                    ? String(prev.maxRequerimientos)
                                    : '',
                                );
                                setExcMaxMontoTxt(
                                  prev?.maxMontoUsd !== null && prev?.maxMontoUsd !== undefined
                                    ? String(prev.maxMontoUsd)
                                    : '',
                                );
                              }}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: radius.pill,
                                backgroundColor: sel ? '#16324F' : colors.surfaceAlt,
                                borderWidth: 1,
                                borderColor: sel ? '#16324F' : colors.border,
                              }}
                            >
                              <Text
                                style={{
                                  color: sel ? '#FFFFFF' : colors.text,
                                  fontWeight: '700',
                                  fontSize: 11.5,
                                }}
                              >
                                {u.full_name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}

                    {usuarioExcSel ? (
                      <View
                        style={{
                          padding: 10,
                          backgroundColor: colors.surfaceAlt,
                          borderRadius: radius.sm,
                          borderWidth: 1,
                          borderColor: '#16324F',
                          gap: 8,
                        }}
                      >
                        <Text style={{ color: '#16324F', fontWeight: '900', fontSize: 12 }}>
                          Configurando a: {usuarioExcSel.full_name} (0 = Sin límite)
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          <View style={{ flex: 1, minWidth: 110 }}>
                            <Text style={{ color: colors.muted, fontSize: 10.5 }}>Máx. Solicitudes</Text>
                            <TextInput
                              value={excMaxSolTxt}
                              onChangeText={setExcMaxSolTxt}
                              keyboardType="numeric"
                              placeholder="Ej. 10 o 0"
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                padding: 6,
                                color: colors.text,
                                fontSize: 12,
                              }}
                            />
                          </View>
                          <View style={{ flex: 1, minWidth: 110 }}>
                            <Text style={{ color: colors.muted, fontSize: 10.5 }}>Máx. Requerimientos</Text>
                            <TextInput
                              value={excMaxReqTxt}
                              onChangeText={setExcMaxReqTxt}
                              keyboardType="numeric"
                              placeholder="Ej. 10 o 0"
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                padding: 6,
                                color: colors.text,
                                fontSize: 12,
                              }}
                            />
                          </View>
                          <View style={{ flex: 1, minWidth: 110 }}>
                            <Text style={{ color: colors.muted, fontSize: 10.5 }}>Máx. USD ($)</Text>
                            <TextInput
                              value={excMaxMontoTxt}
                              onChangeText={setExcMaxMontoTxt}
                              keyboardType="decimal-pad"
                              placeholder="Ej. 2000 o 0"
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                padding: 6,
                                color: colors.text,
                                fontSize: 12,
                              }}
                            />
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                          <TouchableOpacity
                            onPress={() => setUsuarioExcSel(null)}
                            style={{ paddingVertical: 6, paddingHorizontal: 10 }}
                          >
                            <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>
                              Cancelar
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={agregarOActualizarExcepcion}
                            style={{
                              backgroundColor: '#16324F',
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              borderRadius: radius.sm,
                            }}
                          >
                            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>
                              Aplicar a {usuarioExcSel.full_name}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </ScrollView>

            {/* Pie del Modal */}
            <View
              style={{
                padding: spacing.md,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: colors.surface,
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <TouchableOpacity
                onPress={() => setModalOpen(false)}
                style={{
                  paddingVertical: 11,
                  paddingHorizontal: 16,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={guardando}
                onPress={guardarDesdeModal}
                style={{
                  backgroundColor: '#16324F',
                  paddingVertical: 11,
                  paddingHorizontal: 20,
                  borderRadius: radius.md,
                  opacity: guardando ? 0.7 : 1,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 13 }}>
                  {guardando ? 'Guardando…' : '💾 Guardar límite para todos'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

