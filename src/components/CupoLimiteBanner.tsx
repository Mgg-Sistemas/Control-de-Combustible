// ============================================================================
// 📊 COMPONENTE DE LÍMITE DE ÍTEMS (COSAS / RENGLONES) EN SOLICITUDES Y
//    REQUERIMIENTOS — ADAPTADO A TELÉFONO (< 768px) Y PC (>= 768px)
//
// Incluye:
//  1) `CupoLimiteBanner`: Barra superior de la pantalla con el máximo de ítems
//     permitido por Solicitud o por Requerimiento, pastillas de ajuste rápido
//     en 1 toque para el administrador (`3`, `5`, `10`, `15`, `20`, `30`, `50`,
//     `∞ Sin límite`), selector de tarjetas visibles y modal completo.
//  2) `ContadorLimiteItemsBar`: Barra en vivo DENTRO de los formularios donde
//     se agregan cosas/ítems (Paso 3 y modales de Pedir Material, Editar
//     Solicitud y Nuevo/Editar Requerimiento), con barra de progreso y botones
//     inline para que el administrador suba o cambie el máximo al instante sin
//     salir del formulario ni abrir modales anidados.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from './ToastProvider';
import {
  CONFIG_LIMITES_COMPRAS_DEFAULT,
  ConfigLimitesCompras,
  EstadoCupoOperativo,
  ExcepcionLimiteUsuario,
  OPCIONES_RAPIDAS_TOPE,
  OPCIONES_TARJETAS_VISIBLES,
  calcularTopeEfectivoItems,
  normalizarTopeEntero,
  normalizarTopeMontoUsd,
  obtenerConfigLimitesCompras,
  resolverLimitesParaUsuario,
} from '../lib/limitesCompras';
import { guardarConfigLimitesComprasEnDB } from '../lib/limitesComprasStorage';

export interface UsuarioSimpleLimite {
  id: string;
  full_name: string;
  username?: string | null;
  role?: string | null;
}

export interface CupoLimiteBannerProps {
  cupo: EstadoCupoOperativo;
  config: ConfigLimitesCompras;
  onChangeConfig: (nueva: ConfigLimitesCompras) => void;
  puedeConfigurar: boolean;
  userId?: string | null;
  usuarios?: UsuarioSimpleLimite[];
  totalFiltrados?: number;
  visiblesCount?: number;
  limiteTarjetasActual?: number;
  onChangeLimiteTarjetas?: (nuevoLimite: number) => void;
  onVerMisSolicitudes?: () => void;
}

export interface ContadorLimiteItemsBarProps {
  tipo: 'solicitud' | 'requerimiento';
  cantidadActual?: number;
  itemsActuales?: number;
  esEdicion?: boolean;
  cantidadOriginal?: number;
  cantidadItemsOriginales?: number;
  config?: ConfigLimitesCompras;
  cfg?: ConfigLimitesCompras;
  onChangeConfig?: (nueva: ConfigLimitesCompras) => void;
  puedeConfigurar: boolean;
  exentoPorRol?: boolean;
  isAdmin?: boolean;
  userId?: string | null;
  usuariosDisponibles?: UsuarioSimpleLimite[];
  etiquetaPlural?: string;
}

const CHIPS_RAPIDOS_BANNER = [3, 5, 10, 15, 20, 30, 50, 0] as const;

export function ContadorLimiteItemsBar({
  tipo,
  cantidadActual: cantidadActualProp,
  itemsActuales,
  esEdicion = false,
  cantidadOriginal: cantidadOriginalProp,
  cantidadItemsOriginales,
  config: configProp,
  cfg,
  onChangeConfig,
  puedeConfigurar,
  exentoPorRol: exentoProp,
  isAdmin = false,
  userId,
  etiquetaPlural = 'ítems / productos',
}: ContadorLimiteItemsBarProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const [guardando, setGuardando] = useState(false);
  const [ajustarInlineOpen, setAjustarInlineOpen] = useState(false);

  const config = configProp ?? cfg ?? obtenerConfigLimitesCompras();
  const cantidadActual = cantidadActualProp ?? itemsActuales ?? 0;
  const cantidadOriginal = cantidadOriginalProp ?? cantidadItemsOriginales ?? 0;
  const exentoPorRol = exentoProp ?? Boolean(isAdmin && !config.aplicarAAdmins);
  const limResuelto = resolverLimitesParaUsuario(config, userId, isAdmin);

  const maxConfigurado =
    tipo === 'solicitud'
      ? limResuelto.maxItemsSolicitud
      : limResuelto.maxItemsRequerimiento;
  const maxActivo = config.activo ? maxConfigurado : 0;
  const topeEfectivo = calcularTopeEfectivoItems(maxActivo, esEdicion, cantidadOriginal);

  const [inputManual, setInputManual] = useState(
    maxConfigurado > 0 ? String(maxConfigurado) : '0',
  );

  useEffect(() => {
    setInputManual(maxConfigurado > 0 ? String(maxConfigurado) : '0');
  }, [maxConfigurado]);

  const enTope = maxActivo > 0 && cantidadActual >= topeEfectivo && !exentoPorRol;
  const cercaDelTope =
    maxActivo > 0 &&
    !enTope &&
    topeEfectivo > 0 &&
    cantidadActual / topeEfectivo >= 0.8;
  const porcentaje =
    topeEfectivo > 0 ? Math.min(100, Math.round((cantidadActual / topeEfectivo) * 100)) : 0;
  const disponibles =
    topeEfectivo > 0 ? Math.max(0, topeEfectivo - cantidadActual) : Number.POSITIVE_INFINITY;

  const docNombre = tipo === 'solicitud' ? 'solicitud' : 'requerimiento';
  const campoConfig =
    tipo === 'solicitud' ? 'maxItemsPorSolicitud' : 'maxItemsPorRequerimiento';

  const aplicarNuevoMaximo = async (nuevoVal: number, etiquetaToast: string) => {
    if (!puedeConfigurar || guardando) return;
    const limpio = normalizarTopeEntero(nuevoVal, 500);
    setGuardando(true);
    try {
      const res = await guardarConfigLimitesComprasEnDB(
        {
          activo: true,
          [campoConfig]: limpio,
        },
        userId,
      );
      if (!res.ok) {
        toast.error(res.error || 'No se pudo actualizar el límite de ítems.');
        return;
      }
      onChangeConfig?.(res.config);
      toast.success(etiquetaToast);
    } finally {
      setGuardando(false);
    }
  };

  const icono = enTope ? '🛑' : cercaDelTope ? '🟡' : '📦';
  const colorBorde = enTope ? '#EF4444' : cercaDelTope ? '#F59E0B' : colors.border;
  const colorFondo = enTope
    ? '#FEF2F2'
    : cercaDelTope
    ? '#FFFBEB'
    : colors.surfaceAlt;
  const colorTexto = enTope ? '#991B1B' : cercaDelTope ? '#92400E' : colors.text;

  return (
    <View
      style={{
        backgroundColor: colorFondo,
        borderColor: colorBorde,
        borderWidth: enTope ? 1.5 : 1,
        borderRadius: radius.md,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginBottom: spacing.xs,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, flex: 1 }}>
          <Text style={{ fontSize: 14 }}>{icono}</Text>
          <Text style={{ color: colorTexto, fontWeight: '900', fontSize: 12.5 }}>
            {topeEfectivo > 0
              ? `Ítems en esta ${docNombre}: ${cantidadActual} de ${topeEfectivo} máx.`
              : `Ítems en esta ${docNombre}: ${cantidadActual} · Sin límite (∞)`}
          </Text>
          {topeEfectivo > 0 ? (
            <View
              style={{
                backgroundColor: enTope ? '#FEE2E2' : cercaDelTope ? '#FEF3C7' : '#DCFCE7',
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: radius.pill,
              }}
            >
              <Text
                style={{
                  color: enTope ? '#991B1B' : cercaDelTope ? '#92400E' : '#166534',
                  fontSize: 10.5,
                  fontWeight: '800',
                }}
              >
                {enTope
                  ? exentoPorRol
                    ? 'Tope superado (Admin exento)'
                    : 'Límite alcanzado'
                  : `Disponibles: ${disponibles}`}
              </Text>
            </View>
          ) : null}
          {esEdicion && maxActivo > 0 && cantidadOriginal > maxActivo ? (
            <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700' }}>
              (Respetando los {cantidadOriginal} ítems que ya tenía)
            </Text>
          ) : null}
        </View>

        {puedeConfigurar ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
            {maxActivo > 0 ? (
              <>
                <TouchableOpacity
                  onPress={() =>
                    aplicarNuevoMaximo(
                      maxConfigurado + 1,
                      `Máximo subido a ${maxConfigurado + 1} ${etiquetaPlural} por ${docNombre}.`,
                    )
                  }
                  disabled={guardando}
                  style={{
                    backgroundColor: '#2563EB',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>+1 ítem</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    aplicarNuevoMaximo(
                      maxConfigurado + 5,
                      `Máximo subido a ${maxConfigurado + 5} ${etiquetaPlural} por ${docNombre}.`,
                    )
                  }
                  disabled={guardando}
                  style={{
                    backgroundColor: '#059669',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>+5 ítems</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity
              onPress={() => setAjustarInlineOpen((v) => !v)}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.brand,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: radius.pill,
              }}
            >
              <Text style={{ color: colors.brandText, fontSize: 10.5, fontWeight: '800' }}>
                ⚙️ {ajustarInlineOpen ? 'Cerrar ajuste' : 'Cambiar máx.'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {topeEfectivo > 0 ? (
        <View
          style={{
            height: 5,
            backgroundColor: 'rgba(0,0,0,0.08)',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.min(100, porcentaje)}%`,
              height: '100%',
              backgroundColor: enTope ? '#DC2626' : cercaDelTope ? '#D97706' : '#10B981',
            }}
          />
        </View>
      ) : null}

      {enTope ? (
        <Text style={{ color: '#7F1D1D', fontSize: 11.5, lineHeight: 16 }}>
          Ya agregaste el máximo de {topeEfectivo} {etiquetaPlural} permitidos en una sola {docNombre}.{' '}
          {puedeConfigurar
            ? 'Pulsa "+1 ítem", "+5 ítems" o "⚙️ Cambiar máx." arriba para ampliarlo al instante sin perder lo escrito.'
            : `Quita un renglón si deseas cambiarlo o envía esta ${docNombre} y crea otra.`}
        </Text>
      ) : null}

      {/* Panel inline para que el Administrador manipule el máximo sin abrir otro Modal */}
      {puedeConfigurar && ajustarInlineOpen ? (
        <View
          style={{
            marginTop: 4,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            gap: 8,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>
            🎯 Elegir máximo de ítems permitidos dentro de cada {docNombre}:
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {OPCIONES_RAPIDAS_TOPE.map((op) => {
              const sel = maxConfigurado === op;
              return (
                <TouchableOpacity
                  key={op}
                  onPress={() =>
                    aplicarNuevoMaximo(
                      op,
                      op === 0
                        ? `Límite de ítems por ${docNombre} puesto en Sin límite (∞).`
                        : `Máximo fijado en ${op} ítems por ${docNombre}.`,
                    )
                  }
                  disabled={guardando}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                    backgroundColor: sel ? colors.brand : colors.surface,
                    borderWidth: 1,
                    borderColor: sel ? colors.brand : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: sel ? colors.brandContrast : colors.text,
                      fontSize: 11,
                      fontWeight: '800',
                    }}
                  >
                    {op === 0 ? '♾️ Sin límite' : `${op} ítems`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
              O escribe el máximo exacto:
            </Text>
            <TextInput
              value={inputManual}
              onChangeText={setInputManual}
              keyboardType="numeric"
              placeholder="Ej. 8"
              placeholderTextColor={colors.muted}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.sm,
                paddingHorizontal: 10,
                paddingVertical: 4,
                width: 72,
                textAlign: 'center',
                color: colors.text,
                fontWeight: '900',
                fontSize: 13,
              }}
            />
            <TouchableOpacity
              onPress={() => {
                const n = normalizarTopeEntero(inputManual, 500);
                aplicarNuevoMaximo(
                  n,
                  n === 0
                    ? `Límite de ítems por ${docNombre} puesto en Sin límite (∞).`
                    : `Máximo fijado en ${n} ítems por ${docNombre}.`,
                );
                setAjustarInlineOpen(false);
              }}
              disabled={guardando}
              style={{
                backgroundColor: '#059669',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: radius.sm,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11.5, fontWeight: '900' }}>
                💾 Guardar máximo
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
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
}: CupoLimiteBannerProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const esMovil = width < 768;

  const [modalOpen, setModalOpen] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Estados del modal de configuración enfocada en Ítems por Solicitud / Requerimiento
  const [activo, setActivo] = useState<boolean>(config.activo);
  const [maxItemsSolTxt, setMaxItemsSolTxt] = useState<string>(
    String(config.maxItemsPorSolicitud || 0),
  );
  const [maxItemsReqTxt, setMaxItemsReqTxt] = useState<string>(
    String(config.maxItemsPorRequerimiento || 0),
  );
  const [sincronizarAmbos, setSincronizarAmbos] = useState<boolean>(
    config.maxItemsPorSolicitud === config.maxItemsPorRequerimiento,
  );
  const [maxMontoReqTxt, setMaxMontoReqTxt] = useState<string>(
    config.maxMontoUsdRequerimiento > 0 ? String(config.maxMontoUsdRequerimiento) : '0',
  );
  const [maxTarjetas, setMaxTarjetas] = useState<number>(config.maxTarjetasVisibles ?? 50);
  const [aplicarAAdmins, setAplicarAAdmins] = useState<boolean>(config.aplicarAAdmins);
  const [excepciones, setExcepciones] = useState<Record<string, ExcepcionLimiteUsuario>>(
    config.excepcionesPorUsuario || {},
  );

  // Buscador de usuario para excepción individual de ítems
  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [usuarioExcSel, setUsuarioExcSel] = useState<UsuarioSimpleLimite | null>(null);
  const [excMaxItemsSolTxt, setExcMaxItemsSolTxt] = useState('');
  const [excMaxItemsReqTxt, setExcMaxItemsReqTxt] = useState('');
  const [excMaxMontoTxt, setExcMaxMontoTxt] = useState('');

  useEffect(() => {
    if (!modalOpen) {
      setActivo(config.activo);
      setMaxItemsSolTxt(String(config.maxItemsPorSolicitud || 0));
      setMaxItemsReqTxt(String(config.maxItemsPorRequerimiento || 0));
      setSincronizarAmbos(config.maxItemsPorSolicitud === config.maxItemsPorRequerimiento);
      setMaxMontoReqTxt(
        config.maxMontoUsdRequerimiento > 0 ? String(config.maxMontoUsdRequerimiento) : '0',
      );
      setMaxTarjetas(config.maxTarjetasVisibles ?? 50);
      setAplicarAAdmins(config.aplicarAAdmins);
      setExcepciones(config.excepcionesPorUsuario || {});
    }
  }, [config, modalOpen]);

  const abrirModal = () => {
    setActivo(config.activo);
    setMaxItemsSolTxt(String(config.maxItemsPorSolicitud || 0));
    setMaxItemsReqTxt(String(config.maxItemsPorRequerimiento || 0));
    setSincronizarAmbos(config.maxItemsPorSolicitud === config.maxItemsPorRequerimiento);
    setMaxMontoReqTxt(
      config.maxMontoUsdRequerimiento > 0 ? String(config.maxMontoUsdRequerimiento) : '0',
    );
    setMaxTarjetas(config.maxTarjetasVisibles ?? 50);
    setAplicarAAdmins(config.aplicarAAdmins);
    setExcepciones(config.excepcionesPorUsuario || {});
    setUsuarioExcSel(null);
    setBusquedaUsuario('');
    setModalOpen(true);
  };

  const aplicarCambioRapido = async (
    parcial: Partial<ConfigLimitesCompras>,
    mensajeExito: string,
  ) => {
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
    const nuevoMaxItemsSol = normalizarTopeEntero(maxItemsSolTxt, 500);
    const nuevoMaxItemsReq = sincronizarAmbos
      ? nuevoMaxItemsSol
      : normalizarTopeEntero(maxItemsReqTxt, 500);
    const nuevoMaxMontoReq = normalizarTopeMontoUsd(maxMontoReqTxt);

    setGuardando(true);
    try {
      const res = await guardarConfigLimitesComprasEnDB(
        {
          activo,
          maxItemsPorSolicitud: nuevoMaxItemsSol,
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
      toast.success(
        `Límite actualizado: Solicitudes (${
          nuevoMaxItemsSol > 0 ? `${nuevoMaxItemsSol} ítems máx.` : 'Sin límite'
        }) · Requerimientos (${
          nuevoMaxItemsReq > 0 ? `${nuevoMaxItemsReq} ítems máx.` : 'Sin límite'
        }).`,
      );
    } finally {
      setGuardando(false);
    }
  };

  const agregarOActualizarExcepcion = () => {
    if (!usuarioExcSel) return;
    const ms =
      excMaxItemsSolTxt.trim() === '' ? null : normalizarTopeEntero(excMaxItemsSolTxt, 500);
    const mr =
      excMaxItemsReqTxt.trim() === '' ? null : normalizarTopeEntero(excMaxItemsReqTxt, 500);
    const mm = excMaxMontoTxt.trim() === '' ? null : normalizarTopeMontoUsd(excMaxMontoTxt);
    if (ms === null && mr === null && mm === null) {
      toast.error('Indica al menos un límite de ítems personalizado para este usuario.');
      return;
    }
    setExcepciones((prev) => ({
      ...prev,
      [usuarioExcSel.id]: {
        userId: usuarioExcSel.id,
        userName: usuarioExcSel.full_name,
        maxItemsSolicitud: ms,
        maxItemsRequerimiento: mr,
        maxSolicitudes: ms,
        maxRequerimientos: mr,
        maxMontoUsd: mm,
      },
    }));
    setUsuarioExcSel(null);
    setExcMaxItemsSolTxt('');
    setExcMaxItemsReqTxt('');
    setExcMaxMontoTxt('');
    setBusquedaUsuario('');
  };

  const quitarExcepcion = (uidExc: string) => {
    setExcepciones((prev) => {
      const next = { ...prev };
      delete next[uidExc];
      return next;
    });
  };

  const usuariosFiltrados = useMemo(() => {
    const q = busquedaUsuario.trim().toLowerCase();
    if (!q) return usuarios.slice(0, 8);
    return usuarios
      .filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [usuarios, busquedaUsuario]);

  const campoItemsActual =
    cupo.tipo === 'solicitud' ? 'maxItemsPorSolicitud' : 'maxItemsPorRequerimiento';
  const etiquetaDoc = cupo.tipo === 'solicitud' ? 'solicitud' : 'requerimiento';
  const topeItemsActual =
    cupo.tipo === 'solicitud'
      ? config.maxItemsPorSolicitud
      : config.maxItemsPorRequerimiento;

  const ajustarStepper = (
    valorActualTxt: string,
    setter: (v: string) => void,
    delta: number,
    esSol = false,
  ) => {
    const actual = normalizarTopeEntero(valorActualTxt, 500);
    const siguiente = Math.max(0, Math.min(500, actual + delta));
    setter(String(siguiente));
    if (esSol && sincronizarAmbos) {
      setMaxItemsReqTxt(String(siguiente));
    }
  };

  return (
    <View style={{ marginBottom: spacing.sm, gap: 6 }}>
      {/* FRANJA SUPERIOR: LÍMITE DE ÍTEMS POR SOLICITUD / REQUERIMIENTO + PASTILLAS RÁPIDAS */}
      <View
        style={{
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
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
            <Text style={{ fontSize: 14 }}>📦</Text>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 12.5 }}>
              {cupo.maxItems > 0
                ? `Máximo de ítems por ${etiquetaDoc}: ${cupo.maxItems} ${
                    cupo.maxItems === 1 ? 'ítem / cosa' : 'ítems / cosas'
                  }`
                : `Máximo de ítems por ${etiquetaDoc}: Sin límite (∞)`}
            </Text>
            {cupo.tipo === 'requerimiento' && cupo.maxMontoUsd > 0 ? (
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                · 💵 Tope: ${cupo.maxMontoUsd.toLocaleString('en-US')} USD
              </Text>
            ) : null}
            {cupo.tieneExcepcionPersonal ? (
              <View
                style={{
                  backgroundColor: '#FEF3C7',
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ color: '#92400E', fontSize: 10, fontWeight: '800' }}>
                  Cupo personalizado
                </Text>
              </View>
            ) : null}
            {cupo.exentoPorRol && cupo.maxItems > 0 ? (
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
            {/* Selector de tarjetas visibles en la bandeja */}
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

            {/* Botón directo para que el Administrador manipule el máximo de ítems */}
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
                  Límite máximo ({topeItemsActual > 0 ? `${topeItemsActual} ítems` : '∞'}) · Ajustar
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* FILA DE AJUSTE RÁPIDO EN 1 TOQUE PARA EL ADMINISTRADOR (Teléfono y PC) */}
        {puedeConfigurar ? (
          <ScrollView
            horizontal={esMovil}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: esMovil ? 'nowrap' : 'wrap',
              gap: 5,
              paddingTop: 2,
            }}
          >
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginRight: 2 }}>
              ⚡ Tope rápido de ítems:
            </Text>
            {CHIPS_RAPIDOS_BANNER.map((op) => {
              const activoChip = config.activo && topeItemsActual === op;
              return (
                <TouchableOpacity
                  key={op}
                  onPress={() =>
                    aplicarCambioRapido(
                      {
                        activo: true,
                        [campoItemsActual]: op,
                      },
                      op === 0
                        ? `Máximo de ítems por ${etiquetaDoc}: Sin límite (∞).`
                        : `Máximo actualizado a ${op} ítems por ${etiquetaDoc}.`,
                    )
                  }
                  disabled={guardando}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3.5,
                    borderRadius: radius.pill,
                    backgroundColor: activoChip ? '#16324F' : colors.surface,
                    borderWidth: 1,
                    borderColor: activoChip ? '#16324F' : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: activoChip ? '#fff' : colors.text,
                      fontSize: 10.5,
                      fontWeight: '800',
                    }}
                  >
                    {op === 0 ? '∞ Sin límite' : `${op} ítems`}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {topeItemsActual > 0 ? (
              <>
                <TouchableOpacity
                  onPress={() =>
                    aplicarCambioRapido(
                      {
                        activo: true,
                        [campoItemsActual]: topeItemsActual + 1,
                      },
                      `Máximo subido a ${topeItemsActual + 1} ítems por ${etiquetaDoc}.`,
                    )
                  }
                  disabled={guardando}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3.5,
                    borderRadius: radius.pill,
                    backgroundColor: '#2563EB',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>+1</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    aplicarCambioRapido(
                      {
                        activo: true,
                        [campoItemsActual]: topeItemsActual + 5,
                      },
                      `Máximo subido a ${topeItemsActual + 5} ítems por ${etiquetaDoc}.`,
                    )
                  }
                  disabled={guardando}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3.5,
                    borderRadius: radius.pill,
                    backgroundColor: '#059669',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>+5</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </View>

      {/* MODAL DE AJUSTE COMPLETO DE ÍTEMS POR SOLICITUD Y POR REQUERIMIENTO */}
      <Modal
        visible={modalOpen}
        transparent
        animationType={esMovil ? 'slide' : 'fade'}
        onRequestClose={() => setModalOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            justifyContent: esMovil ? 'flex-end' : 'center',
            alignItems: 'center',
            padding: esMovil ? 0 : spacing.md,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: esMovil ? '100%' : 620,
              maxHeight: esMovil ? '92%' : '88%',
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              borderBottomLeftRadius: esMovil ? 0 : radius.lg,
              borderBottomRightRadius: esMovil ? 0 : radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            {/* Cabecera del Modal */}
            <View
              style={{
                backgroundColor: '#16324F',
                paddingHorizontal: spacing.md,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#EAB308', fontSize: 11, fontWeight: '900' }}>
                  ⚙️ CONTROL DE COMPRAS Y SOLICITUDES
                </Text>
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '900', marginTop: 2 }}>
                  Límite Máximo de Ítems (Cosas) por Solicitud y Requerimiento
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalOpen(false)}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✕ Cerrar</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Interruptor maestro */}
              <View
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                    Activar límite de ítems para los usuarios
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                    Controla cuántas cosas (productos o repuestos) puede meter un usuario dentro de una misma solicitud o requerimiento.
                  </Text>
                </View>
                <Switch value={activo} onValueChange={setActivo} />
              </View>

              {/* BLOQUE 1: ÍTEMS DENTRO DE CADA SOLICITUD */}
              <View
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.md,
                  gap: 10,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>
                  📥 1. Cantidad máxima de cosas / ítems dentro de una Solicitud
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                  Aplica en «📦 Pedir Material / Repuestos» y en «🛒 Compras → Solicitudes». Pon 0 para Sin límite (∞).
                </Text>

                {/* Steppers grandes + campo numérico */}
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => ajustarStepper(maxItemsSolTxt, setMaxItemsSolTxt, -5, true)}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>−5</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => ajustarStepper(maxItemsSolTxt, setMaxItemsSolTxt, -1, true)}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>−1</Text>
                  </TouchableOpacity>

                  <TextInput
                    value={maxItemsSolTxt}
                    onChangeText={(t) => {
                      setMaxItemsSolTxt(t);
                      if (sincronizarAmbos) setMaxItemsReqTxt(t);
                    }}
                    keyboardType="numeric"
                    placeholder="0 = Sin límite"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1.5,
                      borderColor: colors.brand,
                      borderRadius: radius.md,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      color: colors.text,
                      fontWeight: '900',
                      fontSize: 16,
                      minWidth: 95,
                      textAlign: 'center',
                    }}
                  />

                  <TouchableOpacity
                    onPress={() => ajustarStepper(maxItemsSolTxt, setMaxItemsSolTxt, 1, true)}
                    style={{
                      backgroundColor: '#2563EB',
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => ajustarStepper(maxItemsSolTxt, setMaxItemsSolTxt, 5, true)}
                    style={{
                      backgroundColor: '#059669',
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>+5</Text>
                  </TouchableOpacity>

                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800' }}>
                    {normalizarTopeEntero(maxItemsSolTxt) === 0
                      ? '♾️ Sin límite de ítems'
                      : `Máx. ${normalizarTopeEntero(maxItemsSolTxt)} ítems por solicitud`}
                  </Text>
                </View>

                {/* Chips rápidos */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {OPCIONES_RAPIDAS_TOPE.map((op) => {
                    const sel = normalizarTopeEntero(maxItemsSolTxt) === op;
                    return (
                      <TouchableOpacity
                        key={op}
                        onPress={() => {
                          setMaxItemsSolTxt(String(op));
                          if (sincronizarAmbos) setMaxItemsReqTxt(String(op));
                        }}
                        style={{
                          paddingHorizontal: 11,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: sel ? colors.brand : colors.surface,
                          borderWidth: 1,
                          borderColor: sel ? colors.brand : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: sel ? colors.brandContrast : colors.text,
                            fontWeight: '800',
                            fontSize: 12,
                          }}
                        >
                          {op === 0 ? '♾️ Sin límite (0)' : `${op} ítems`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Switch para mantener el mismo tope en Solicitudes y Requerimientos */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 6,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                      🔗 Usar este mismo máximo de ítems también en Requerimientos
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      Recomendado para que al convertir una Solicitud en Requerimiento calcen con el mismo tope.
                    </Text>
                  </View>
                  <Switch
                    value={sincronizarAmbos}
                    onValueChange={(v) => {
                      setSincronizarAmbos(v);
                      if (v) setMaxItemsReqTxt(maxItemsSolTxt);
                    }}
                  />
                </View>
              </View>

              {/* BLOQUE 2: ÍTEMS DENTRO DE CADA REQUERIMIENTO */}
              <View
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.md,
                  gap: 10,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>
                  📝 2. Cantidad máxima de cosas / ítems dentro de un Requerimiento
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                  Aplica al armar un «➕ Nuevo requerimiento» en «🛒 Compras → Requerimientos».
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setSincronizarAmbos(false);
                      ajustarStepper(maxItemsReqTxt, setMaxItemsReqTxt, -5, false);
                    }}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>−5</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setSincronizarAmbos(false);
                      ajustarStepper(maxItemsReqTxt, setMaxItemsReqTxt, -1, false);
                    }}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>−1</Text>
                  </TouchableOpacity>

                  <TextInput
                    value={sincronizarAmbos ? maxItemsSolTxt : maxItemsReqTxt}
                    onChangeText={(t) => {
                      setSincronizarAmbos(false);
                      setMaxItemsReqTxt(t);
                    }}
                    keyboardType="numeric"
                    placeholder="0 = Sin límite"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1.5,
                      borderColor: colors.brand,
                      borderRadius: radius.md,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      color: colors.text,
                      fontWeight: '900',
                      fontSize: 16,
                      minWidth: 95,
                      textAlign: 'center',
                    }}
                  />

                  <TouchableOpacity
                    onPress={() => {
                      setSincronizarAmbos(false);
                      ajustarStepper(maxItemsReqTxt, setMaxItemsReqTxt, 1, false);
                    }}
                    style={{
                      backgroundColor: '#2563EB',
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>+1</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setSincronizarAmbos(false);
                      ajustarStepper(maxItemsReqTxt, setMaxItemsReqTxt, 5, false);
                    }}
                    style={{
                      backgroundColor: '#059669',
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: radius.md,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>+5</Text>
                  </TouchableOpacity>

                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800' }}>
                    {normalizarTopeEntero(sincronizarAmbos ? maxItemsSolTxt : maxItemsReqTxt) === 0
                      ? '♾️ Sin límite de ítems'
                      : `Máx. ${normalizarTopeEntero(
                          sincronizarAmbos ? maxItemsSolTxt : maxItemsReqTxt,
                        )} ítems por requerimiento`}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {OPCIONES_RAPIDAS_TOPE.map((op) => {
                    const valActual = normalizarTopeEntero(
                      sincronizarAmbos ? maxItemsSolTxt : maxItemsReqTxt,
                    );
                    const sel = valActual === op;
                    return (
                      <TouchableOpacity
                        key={op}
                        onPress={() => {
                          setSincronizarAmbos(false);
                          setMaxItemsReqTxt(String(op));
                        }}
                        style={{
                          paddingHorizontal: 11,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: sel ? colors.brand : colors.surface,
                          borderWidth: 1,
                          borderColor: sel ? colors.brand : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: sel ? colors.brandContrast : colors.text,
                            fontWeight: '800',
                            fontSize: 12,
                          }}
                        >
                          {op === 0 ? '♾️ Sin límite (0)' : `${op} ítems`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ marginTop: 4 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>
                    💵 Monto máximo en USD por Requerimiento (opcional, 0 = sin tope)
                  </Text>
                  <TextInput
                    value={maxMontoReqTxt}
                    onChangeText={setMaxMontoReqTxt}
                    keyboardType="numeric"
                    placeholder="0 = Sin límite"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      color: colors.text,
                      fontWeight: '800',
                      fontSize: 13,
                      maxWidth: 200,
                    }}
                  />
                </View>
              </View>

              {/* BLOQUE 3: TARJETAS VISIBLES Y ALCANCE ADMIN */}
              <View
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.md,
                  gap: 10,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5 }}>
                  👁️ 3. Cantidad de tarjetas visibles en las listas y Administradores
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {OPCIONES_TARJETAS_VISIBLES.map((op) => {
                    const sel = maxTarjetas === op;
                    return (
                      <TouchableOpacity
                        key={op}
                        onPress={() => setMaxTarjetas(op)}
                        style={{
                          paddingHorizontal: 11,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: sel ? colors.brand : colors.surface,
                          borderWidth: 1,
                          borderColor: sel ? colors.brand : colors.border,
                        }}
                      >
                        <Text
                          style={{
                            color: sel ? colors.brandContrast : colors.text,
                            fontWeight: '800',
                            fontSize: 12,
                          }}
                        >
                          {op === 0 ? 'Todas (sin recorte)' : `${op} tarjetas`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 4,
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>
                      Aplicar límite de ítems también a Administradores
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      Si está apagado (recomendado), los administradores pueden meter más ítems en casos de emergencia.
                    </Text>
                  </View>
                  <Switch value={aplicarAAdmins} onValueChange={setAplicarAAdmins} />
                </View>
              </View>

              {/* BLOQUE 4: EXCEPCIONES POR USUARIO ESPECÍFICO */}
              {usuarios.length > 0 ? (
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: spacing.md,
                    gap: 8,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5 }}>
                    👤 4. Excepciones individuales de ítems por usuario (Opcional)
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                    Si necesitas darle un máximo distinto de ítems a un usuario puntual (o 0 = Sin límite para esa persona), búscalo aquí:
                  </Text>

                  {Object.values(excepciones).length > 0 ? (
                    <View style={{ gap: 6, marginBottom: 4 }}>
                      {Object.values(excepciones).map((exc) => (
                        <View
                          key={exc.userId}
                          style={{
                            backgroundColor: colors.surface,
                            borderRadius: radius.sm,
                            borderWidth: 1,
                            borderColor: colors.border,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                              👤 {exc.userName || exc.userId}
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>
                              Ítems Solicitud:{' '}
                              {exc.maxItemsSolicitud == null
                                ? 'General'
                                : exc.maxItemsSolicitud === 0
                                ? '∞'
                                : exc.maxItemsSolicitud}{' '}
                              · Ítems Req.:{' '}
                              {exc.maxItemsRequerimiento == null
                                ? 'General'
                                : exc.maxItemsRequerimiento === 0
                                ? '∞'
                                : exc.maxItemsRequerimiento}
                              {exc.maxMontoUsd != null
                                ? ` · Tope $: ${
                                    exc.maxMontoUsd === 0 ? '∞' : `$${exc.maxMontoUsd}`
                                  }`
                                : ''}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => quitarExcepcion(exc.userId)}
                            style={{
                              backgroundColor: '#FEE2E2',
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              borderRadius: radius.sm,
                            }}
                          >
                            <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '800' }}>
                              Quitar
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <TextInput
                    value={busquedaUsuario}
                    onChangeText={setBusquedaUsuario}
                    placeholder="🔎 Buscar usuario por nombre o usuario…"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      color: colors.text,
                      fontSize: 12.5,
                    }}
                  />

                  {busquedaUsuario.trim().length > 0 || usuarioExcSel ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {usuariosFiltrados.map((u) => {
                        const sel = usuarioExcSel?.id === u.id;
                        return (
                          <TouchableOpacity
                            key={u.id}
                            onPress={() => {
                              setUsuarioExcSel(u);
                              const prev = excepciones[u.id];
                              setExcMaxItemsSolTxt(
                                prev?.maxItemsSolicitud != null
                                  ? String(prev.maxItemsSolicitud)
                                  : '',
                              );
                              setExcMaxItemsReqTxt(
                                prev?.maxItemsRequerimiento != null
                                  ? String(prev.maxItemsRequerimiento)
                                  : '',
                              );
                              setExcMaxMontoTxt(
                                prev?.maxMontoUsd != null ? String(prev.maxMontoUsd) : '',
                              );
                            }}
                            style={{
                              paddingHorizontal: 9,
                              paddingVertical: 5,
                              borderRadius: radius.pill,
                              backgroundColor: sel ? colors.brand : colors.surface,
                              borderWidth: 1,
                              borderColor: sel ? colors.brand : colors.border,
                            }}
                          >
                            <Text
                              style={{
                                color: sel ? colors.brandContrast : colors.text,
                                fontSize: 11.5,
                                fontWeight: '700',
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
                        backgroundColor: colors.surface,
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderColor: colors.brand,
                        padding: spacing.sm,
                        gap: 8,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                        Configurar excepción de ítems para: {usuarioExcSel.full_name}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        <View style={{ flex: 1, minWidth: 125 }}>
                          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700' }}>
                            Máx. Ítems Solicitud (0=∞)
                          </Text>
                          <TextInput
                            value={excMaxItemsSolTxt}
                            onChangeText={setExcMaxItemsSolTxt}
                            keyboardType="numeric"
                            placeholder="Vacío = General"
                            placeholderTextColor={colors.muted}
                            style={{
                              backgroundColor: colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              color: colors.text,
                              fontSize: 12,
                              marginTop: 2,
                            }}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 125 }}>
                          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700' }}>
                            Máx. Ítems Req. (0=∞)
                          </Text>
                          <TextInput
                            value={excMaxItemsReqTxt}
                            onChangeText={setExcMaxItemsReqTxt}
                            keyboardType="numeric"
                            placeholder="Vacío = General"
                            placeholderTextColor={colors.muted}
                            style={{
                              backgroundColor: colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              color: colors.text,
                              fontSize: 12,
                              marginTop: 2,
                            }}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 125 }}>
                          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700' }}>
                            Máx. USD Req. (0=∞)
                          </Text>
                          <TextInput
                            value={excMaxMontoTxt}
                            onChangeText={setExcMaxMontoTxt}
                            keyboardType="numeric"
                            placeholder="Vacío = General"
                            placeholderTextColor={colors.muted}
                            style={{
                              backgroundColor: colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              color: colors.text,
                              fontSize: 12,
                              marginTop: 2,
                            }}
                          />
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setUsuarioExcSel(null)}
                          style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                        >
                          <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>
                            Cancelar
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={agregarOActualizarExcepcion}
                          style={{
                            backgroundColor: colors.brand,
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: radius.sm,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.brandContrast,
                              fontWeight: '800',
                              fontSize: 12,
                            }}
                          >
                            ✓ Aplicar a este usuario
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            {/* Pie del Modal */}
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.border,
                padding: spacing.md,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                backgroundColor: colors.surface,
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  setActivo(true);
                  setMaxItemsSolTxt('0');
                  setMaxItemsReqTxt('0');
                  setSincronizarAmbos(true);
                  setMaxMontoReqTxt('0');
                  setMaxTarjetas(CONFIG_LIMITES_COMPRAS_DEFAULT.maxTarjetasVisibles);
                  setAplicarAAdmins(false);
                }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12 }}>
                  ♾️ Dejar todo Sin límite
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setModalOpen(false)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceAlt,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                    Cancelar
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={guardarDesdeModal}
                  disabled={guardando}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 9,
                    borderRadius: radius.md,
                    backgroundColor: '#059669',
                    opacity: guardando ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>
                    {guardando ? 'Guardando…' : '💾 Guardar límite de ítems'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
