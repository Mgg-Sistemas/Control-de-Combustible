// ⚖️ REPORTE DE TARAS POR CAMIÓN — el botón y sus opciones completas.
//
// Permite personalizar al 100% el reporte PDF:
// - Colocar o quitar CUALQUIER columna (N°, Equipo, Placa, Marca/Modelo, Empresa,
//   Tara, Combustible, Chofer, Clasificación, Estado, Quién cargó, Firma).
// - Colocar o quitar CUALQUIER logo (BCV, SOS, Golden Touch, Renace, Jhenzaen) o ninguno.
// - Activar/desactivar tarjetas de resumen (KPIs), totales al pie, notas, membrete y marcas.
// - Las opciones se guardan localmente para recordar siempre la preferencia del usuario.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { Toggle } from './CubicajeTab';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { LOGOS_POR_DEFECTO, type LogosReporte } from '../lib/cubicaje';
import { UNIDADES_PESO } from '../lib/viajesPeso';
import { caracasBusinessToday } from '../lib/caracasDay';
import { listOperatorAssignments } from '../lib/machineOperators';
import {
  OPCIONES_TARAS_POR_DEFECTO, cuerpoReporteTaras, resumenTaras, resumenCombustibleTaras, subtituloReporteTaras,
  nombreArchivoTaras, CSS_REPORTE_TARAS, litrosTexto,
  type CamionParaTara, type TaraParaReporte, type OpcionesReporteTaras,
} from '../lib/reporteTaras';

const CLAVE = 'reporteTaras.opciones.v2';
const CLAVE_LEGACY = 'reporteTaras.opciones.v1';

const LOGOS: [keyof LogosReporte, string][] = [
  ['bcv', '🏛️ Banco Central de Venezuela (BCV)'],
  ['sos', '🌴 SOS La Guaira'],
  ['golden', '✨ Golden Touch'],
  ['renace', '🇻🇪 Plan Venezuela Renace'],
  ['jhenzaen', '🏢 Jhenzaen 2.012 C.A'],
];

export function ReporteTarasBox({ camiones, taras, fechaCombustible }: {
  camiones: CamionParaTara[];
  taras: Map<string, TaraParaReporte>;
  fechaCombustible?: string;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [op, setOpState] = useState<OpcionesReporteTaras>(OPCIONES_TARAS_POR_DEFECTO);
  const [logos, setLogos] = useState<LogosReporte>(LOGOS_POR_DEFECTO);
  const [generando, setGenerando] = useState(false);
  const [empresaUnicaOn, setEmpresaUnicaOn] = useState(false);

  useEffect(() => {
    // Intentar leer v2, o migrar de v1
    AsyncStorage.getItem(CLAVE).then((raw) => {
      if (raw) {
        const g = JSON.parse(raw);
        if (g?.op) setOpState({ ...OPCIONES_TARAS_POR_DEFECTO, ...g.op });
        if (g?.logos) setLogos({ ...LOGOS_POR_DEFECTO, ...g.logos });
      } else {
        AsyncStorage.getItem(CLAVE_LEGACY).then((rawV1) => {
          if (!rawV1) return;
          const g = JSON.parse(rawV1);
          if (g?.op) setOpState({ ...OPCIONES_TARAS_POR_DEFECTO, ...g.op });
          if (g?.logos) setLogos({ ...LOGOS_POR_DEFECTO, ...g.logos });
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const guardar = (o: OpcionesReporteTaras, l: LogosReporte) => {
    AsyncStorage.setItem(CLAVE, JSON.stringify({ op: o, logos: l })).catch(() => {});
  };

  const setOp = <K extends keyof OpcionesReporteTaras>(k: K, v: OpcionesReporteTaras[K]) => {
    setOpState((prev) => { const n = { ...prev, [k]: v }; guardar(n, logos); return n; });
  };

  const setLogo = (k: keyof LogosReporte, v: boolean) => {
    setLogos((prev) => { const n = { ...prev, [k]: v }; guardar(op, n); return n; });
  };

  // Presets de columnas
  const activarTodasColumnas = () => {
    const n: OpcionesReporteTaras = {
      ...op,
      numeracion: true,
      equipo: true,
      placa: true,
      marcaModelo: true,
      clasificacion: true,
      chofer: true,
      empresa: true,
      tara: true,
      combustible: true,
      estado: true,
      cargadaPor: true,
      firma: true,
    };
    setOpState(n);
    guardar(n, logos);
    toast.success('Todas las columnas activadas.');
  };

  const columnasPredeterminadas = () => {
    const n: OpcionesReporteTaras = {
      ...op,
      numeracion: true,
      equipo: true,
      placa: true,
      marcaModelo: true,
      clasificacion: false,
      chofer: false,
      empresa: true,
      tara: true,
      combustible: true,
      estado: true,
      cargadaPor: true,
      firma: false,
    };
    setOpState(n);
    guardar(n, logos);
    toast.success('Columnas restauradas a predeterminadas.');
  };

  const soloColumnasBasicas = () => {
    const n: OpcionesReporteTaras = {
      ...op,
      numeracion: true,
      equipo: true,
      placa: true,
      marcaModelo: false,
      clasificacion: false,
      chofer: false,
      empresa: false,
      tara: true,
      combustible: true,
      estado: false,
      cargadaPor: false,
      firma: false,
    };
    setOpState(n);
    guardar(n, logos);
    toast.success('Solo columnas esenciales activas.');
  };

  // Presets de logos
  const aplicarPresetLogos = (tipo: 'todos' | 'ninguno' | 'jhenzaen' | 'sos' | 'bcv' | 'bcv_sos') => {
    let n: LogosReporte;
    if (tipo === 'todos') {
      n = { bcv: true, sos: true, golden: true, renace: true, jhenzaen: true };
    } else if (tipo === 'ninguno') {
      n = { bcv: false, sos: false, golden: false, renace: false, jhenzaen: false };
    } else if (tipo === 'jhenzaen') {
      n = { bcv: false, sos: false, golden: false, renace: false, jhenzaen: true };
    } else if (tipo === 'sos') {
      n = { bcv: false, sos: true, golden: false, renace: false, jhenzaen: false };
    } else if (tipo === 'bcv') {
      n = { bcv: true, sos: false, golden: false, renace: false, jhenzaen: false };
    } else {
      n = { bcv: true, sos: true, golden: false, renace: false, jhenzaen: false };
    }
    setLogos(n);
    guardar(op, n);
    toast.success('Logos del membrete actualizados.');
  };

  const r = resumenTaras(camiones, taras);
  const rComb = resumenCombustibleTaras(camiones, taras, op.alcance);
  const fechaCombDmy = fechaCombustible && /^\d{4}-\d{2}-\d{2}$/.test(fechaCombustible)
    ? `${fechaCombustible.slice(8, 10)}/${fechaCombustible.slice(5, 7)}/${fechaCombustible.slice(0, 4)}`
    : null;

  const generar = async () => {
    if (op.alcance === 'conTara' && r.conTara === 0) {
      toast.error('Todavía no hay camiones con tara cargada. Usa «Toda la flota» para ver cuáles faltan.');
      return;
    }
    setGenerando(true);
    try {
      let camionesPdf = camiones;
      if (op.chofer === true) {
        const { rows } = await listOperatorAssignments();
        const dia = new Map<string, string>();
        const noche = new Map<string, string>();
        rows.forEach((a) => (a.shift === 'night' ? noche : dia).set(a.machinery_id, a.operator_name));
        camionesPdf = camiones.map((c) => ({ ...c, choferDia: dia.get(c.id) ?? null, choferNoche: noche.get(c.id) ?? null }));
      }
      const subBase = subtituloReporteTaras(r, op.alcance, op);
      const subComb = op.combustible !== false && rComb.totalLitros > 0
        ? ` · Combustible${fechaCombDmy ? ` (${fechaCombDmy})` : ''}: ${litrosTexto(rComb.totalLitros)}`
        : '';
      const html = pdfDocument({
        title: (op.tituloPersonalizado ?? '').trim() || 'Reporte de taras',
        subtitle: op.verSubtitulo !== false ? ((op.subtituloPersonalizado ?? '').trim() || `${subBase}${subComb}`) : '',
        body: cuerpoReporteTaras(camionesPdf, taras, { ...op, fechaCombustible }),
        extraCss: CSS_REPORTE_TARAS,
        logos,
        marcaTexto: op.verMarcaTexto === true,
        verEmitida: op.verFechaEmision !== false,
      });
      await exportPdf(html, nombreArchivoTaras(op.alcance, caracasBusinessToday(), op));
    } catch (e: any) {
      toast.error(`No se pudo generar el reporte: ${e?.message ?? e}`);
    } finally {
      setGenerando(false);
    }
  };

  const Pastilla = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }}
    >
      <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontWeight: '700', fontSize: 11 }}>{label}</Text>
    </TouchableOpacity>
  );

  const BotonAccion = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{label}</Text>
    </TouchableOpacity>
  );

  // Conteo de elementos activos
  const numColsActivas = [
    op.numeracion !== false,
    op.equipo !== false,
    op.placa !== false,
    op.marcaModelo !== false,
    op.clasificacion === true,
    op.chofer === true,
    op.empresa !== false,
    op.tara !== false,
    op.combustible !== false,
    op.alcance === 'todos' && op.estado !== false,
    op.cargadaPor !== false,
    op.firma === true,
  ].filter(Boolean).length;

  const numLogosActivos = Object.values(logos).filter(Boolean).length;

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt }}>
      {/* Barra superior con resumen y botón generar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📄 Reporte de taras</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1 }}>
            {r.conTara} de {r.flota} camión(es) con tara cargada{r.exentos > 0 ? ` · ${r.exentos} no pasan por romana` : ''}
            {rComb.totalLitros > 0 ? ` · ⛽ ${rComb.conCombustible} con combustible (${litrosTexto(rComb.totalLitros)})` : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={generar}
          disabled={generando}
          style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.primary, opacity: generando ? 0.6 : 1 }}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{generando ? 'Generando…' : '🖨️ Generar PDF'}</Text>
        </TouchableOpacity>
      </View>

      {/* Botón destacado para abrir/cerrar la personalización */}
      <TouchableOpacity
        onPress={() => setAbierto((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.xs,
          paddingVertical: 6,
          paddingHorizontal: spacing.sm,
          backgroundColor: abierto ? colors.surfaceAlt : colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: abierto ? colors.primary : colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            ⚙️ QUÉ SALE EN EL REPORTE
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            ({numColsActivas} columnas · {numLogosActivos} logos)
          </Text>
        </View>
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
          {abierto ? '▲ Ocultar opciones' : '▼ Personalizar todo'}
        </Text>
      </TouchableOpacity>

      {/* Panel completo desplegable */}
      {abierto ? (
        <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>

          {/* ── 1. COLUMNAS DE LA TABLA ── */}
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, flexWrap: 'wrap', gap: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                📊 COLUMNAS DE LA TABLA ({numColsActivas} activas)
              </Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <BotonAccion label="✓ Todas" onPress={activarTodasColumnas} />
                <BotonAccion label="↺ Predeterminadas" onPress={columnasPredeterminadas} />
                <BotonAccion label="⚡ Esenciales" onPress={soloColumnasBasicas} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              <Toggle on={op.numeracion !== false} label="1️⃣ Numeración (N°)" onPress={() => setOp('numeracion', op.numeracion === false)} />
              <Toggle on={op.equipo !== false} label="🚜 Equipo (Código)" onPress={() => setOp('equipo', op.equipo === false)} />
              <Toggle on={op.placa !== false} label="🔢 Placa / serial" onPress={() => setOp('placa', op.placa === false)} />
              <Toggle on={op.marcaModelo !== false} label="🏷️ Marca y modelo" onPress={() => setOp('marcaModelo', op.marcaModelo === false)} />
              <Toggle
                on={op.empresa !== false}
                label="🏢 Empresa"
                ayuda="Apagada, el nombre de la empresa no aparece en ninguna parte del PDF."
                onPress={() => setOp('empresa', op.empresa === false)}
              />
              <Toggle on={op.tara !== false} label="⚖️ Tara (Kg/Ton)" onPress={() => setOp('tara', op.tara === false)} />
              <Toggle
                on={op.combustible !== false}
                label="⛽ Combustible (L)"
                ayuda="Muestra la columna de litros de combustible asignados a cada maquinaria para el día seleccionado."
                onPress={() => setOp('combustible', op.combustible === false)}
              />
              <Toggle
                on={op.chofer === true}
                label="👤 Chofer"
                ayuda="El chofer asignado al camión en «👤 Choferes por camión». Si el de día y el de noche son distintos, salen los dos (☀️/🌙)."
                onPress={() => setOp('chofer', op.chofer !== true)}
              />
              <Toggle
                on={op.clasificacion === true}
                label="◆ Clasificación por capacidad"
                ayuda="Compacto, media o gran capacidad, según los m³ de la tolva."
                onPress={() => setOp('clasificacion', op.clasificacion !== true)}
              />
              {op.alcance === 'todos' ? (
                <Toggle on={op.estado !== false} label="⚙️ Estado en romana" onPress={() => setOp('estado', op.estado === false)} />
              ) : null}
              <Toggle on={op.cargadaPor !== false} label="👤 Quién cargó la tara y cuándo" onPress={() => setOp('cargadaPor', op.cargadaPor === false)} />
              <Toggle
                on={op.firma === true}
                label="✍️ Columna de firma / recibido"
                ayuda="Agrega una columna con espacio rayado para visto bueno o firma en papel físico."
                onPress={() => setOp('firma', op.firma !== true)}
              />
            </View>
          </View>

          {/* ── 2. LOGOS DEL MEMBRETE ── */}
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, flexWrap: 'wrap', gap: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
                🏷️ LOGOS DEL MEMBRETE ({numLogosActivos} activos)
              </Text>
              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                <BotonAccion label="✓ Todos" onPress={() => aplicarPresetLogos('todos')} />
                <BotonAccion label="✕ Ninguno" onPress={() => aplicarPresetLogos('ninguno')} />
                <BotonAccion label="Solo Jhenzaen" onPress={() => aplicarPresetLogos('jhenzaen')} />
                <BotonAccion label="Solo SOS" onPress={() => aplicarPresetLogos('sos')} />
                <BotonAccion label="BCV + SOS" onPress={() => aplicarPresetLogos('bcv_sos')} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {LOGOS.map(([k, label]) => (
                <Toggle key={`rtl-${k}`} on={logos[k]} label={label} onPress={() => setLogo(k, !logos[k])} />
              ))}
            </View>

            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Encabezado institucional y fecha:</Text>
              <Toggle
                on={op.verMarcaTexto === true}
                label="📝 Marca institucional de texto («Banco Central de Venezuela / SOS La Guaira»)"
                onPress={() => setOp('verMarcaTexto', op.verMarcaTexto !== true)}
              />
              <Toggle
                on={op.verFechaEmision !== false}
                label="📅 Mostrar fecha y hora de emisión («Emitida: ...»)"
                onPress={() => setOp('verFechaEmision', op.verFechaEmision === false)}
              />
            </View>
          </View>

          {/* ── 3. RESUMEN, TARJETAS Y TOTALES ── */}
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginBottom: spacing.xs }}>
              📈 RESUMEN, TARJETAS Y NOTAS
            </Text>

            <Toggle
              on={op.kpis !== false}
              label="📊 Resumen superior (tarjetas de estadísticas)"
              ayuda="Muestra las tarjetas superiores con métricas clave de la flota."
              onPress={() => setOp('kpis', op.kpis === false)}
            />

            {op.kpis !== false ? (
              <View style={{ paddingLeft: spacing.md, marginVertical: 2, gap: 2 }}>
                <Toggle on={op.kpiCamiones !== false} label="• Tarjeta: Total Camiones" onPress={() => setOp('kpiCamiones', op.kpiCamiones === false)} />
                <Toggle on={op.kpiPromedio !== false} label="• Tarjeta: Tara Promedio" onPress={() => setOp('kpiPromedio', op.kpiPromedio === false)} />
                <Toggle on={op.kpiMayor !== false} label="• Tarjeta: Tara Mayor" onPress={() => setOp('kpiMayor', op.kpiMayor === false)} />
                <Toggle on={op.kpiMenor !== false} label="• Tarjeta: Tara Menor" onPress={() => setOp('kpiMenor', op.kpiMenor === false)} />
                <Toggle on={op.kpiCombustible !== false} label="• Tarjeta: Total Combustible (L)" onPress={() => setOp('kpiCombustible', op.kpiCombustible === false)} />
              </View>
            ) : null}

            <Toggle
              on={op.totalesPie !== false}
              label="🔢 Fila de totales al pie de la tabla"
              ayuda="Calcula y muestra los totales acumulados (combustible y promedio) en la última fila."
              onPress={() => setOp('totalesPie', op.totalesPie === false)}
            />

            <Toggle
              on={op.notaPie !== false}
              label="📝 Nota al pie explicativa («La tara es el peso del camión vacío...»)"
              onPress={() => setOp('notaPie', op.notaPie === false)}
            />

            <Toggle
              on={op.verSubtitulo !== false}
              label="📄 Mostrar subtítulo del reporte"
              onPress={() => setOp('verSubtitulo', op.verSubtitulo === false)}
            />
          </View>

          {/* ── 4. FILTROS, ALCANCE Y EMPRESA ── */}
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginBottom: spacing.xs }}>
              ⚙️ FILTROS Y PERSONALIZACIÓN DE TEXTO
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginBottom: 6 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>Camiones a incluir:</Text>
              <Pastilla on={op.alcance === 'conTara'} label="Solo con tara cargada" onPress={() => setOp('alcance', 'conTara')} />
              <Pastilla on={op.alcance === 'todos'} label="Toda la flota (incluye sin tara)" onPress={() => setOp('alcance', 'todos')} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginBottom: 6 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>⚖️ Unidades de peso:</Text>
              {UNIDADES_PESO.map((u) => (
                <Pastilla key={`rtu-${u.k}`} on={op.unidad === u.k} label={u.label} onPress={() => setOp('unidad', u.k)} />
              ))}
            </View>

            {/* Empresa única opcional */}
            {op.empresa !== false ? (
              <View style={{ marginTop: 4 }}>
                <Toggle
                  on={!!(op.empresaUnica ?? '').trim() || empresaUnicaOn}
                  label="🏙 Toda la flota a nombre de una sola empresa"
                  ayuda="En la columna Empresa sale el mismo nombre para cada camión (ej. Jhenzaen 2.012 C.A). Solo en el papel."
                  onPress={() => {
                    const encendida = !!(op.empresaUnica ?? '').trim() || empresaUnicaOn;
                    if (encendida) { setEmpresaUnicaOn(false); setOp('empresaUnica', ''); }
                    else setEmpresaUnicaOn(true);
                  }}
                />
                {(empresaUnicaOn || !!(op.empresaUnica ?? '').trim()) ? (
                  <TextInput
                    value={op.empresaUnica ?? ''}
                    onChangeText={(t) => setOp('empresaUnica', t)}
                    placeholder="Escribe el nombre de la empresa (ej. Jhenzaen 2.012 C.A)"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: 4, marginBottom: 4 }}
                    autoCorrect={false}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Título y subtítulo personalizables */}
            <View style={{ marginTop: 6, gap: 4 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>✏️ Título propio del documento (opcional):</Text>
              <TextInput
                value={op.tituloPersonalizado ?? ''}
                onChangeText={(t) => setOp('tituloPersonalizado', t)}
                placeholder="Por defecto: Reporte de taras"
                placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 12 }}
              />

              {op.verSubtitulo !== false ? (
                <>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 4 }}>📄 Subtítulo propio (opcional):</Text>
                  <TextInput
                    value={op.subtituloPersonalizado ?? ''}
                    onChangeText={(t) => setOp('subtituloPersonalizado', t)}
                    placeholder="Por defecto: se genera automáticamente según la fecha y flota"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 12 }}
                  />
                </>
              ) : null}
            </View>
          </View>

        </View>
      ) : null}
    </View>
  );
}
