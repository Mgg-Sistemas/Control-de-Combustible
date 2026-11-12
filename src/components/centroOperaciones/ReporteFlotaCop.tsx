// 🏭 CENTRO DE OPERACIONES — 📊 REPORTES · 📋 REPORTE DE LA FLOTA (11-nov-2026).
// Como el reporte de máquinas del Catálogo, pero de la flota de ESTE sitio: filtros por estado,
// categoría, empresa y máquina; columnas y logos que se ponen y se quitan; título y emisión
// editables. SOLO LEE (flota, inspección de las vinculadas y su categoría/empresa del Catálogo).
// La lógica (filas, filtros, papel) es `lib/centroOperacionesFlotaReporte.ts`.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Card } from '../ui';
import { Plegable } from '../Plegable';
import { Toggle } from '../CubicajeTab';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { exportPdf, pdfDocument } from '../../lib/pdf';
import { caracasBusinessToday } from '../../lib/caracasDay';
import type { Sitio, Unidad } from '../../lib/centroOperaciones';
import type { LogosCop } from '../../lib/centroOperacionesPapel';
import { cargarUnidades, cargarEstadoInspeccion, cargarCatalogoDeFlota } from '../../lib/centroOperacionesDb';
import { vinculadasParaInspeccion } from '../../lib/centroOperacionesMaquinariaBloques';
import {
  filasDeFlota, opcionesDeFlota, filtrarFlota, conteoFlota, cuerpoFlota, nombreArchivoFlota,
  COLUMNAS_FLOTA, columnasPorDefecto, ESTADOS_FLOTA, ETIQUETA_ESTADO_FLOTA, CSS_FLOTA,
  type EstadoFlota, type FilaFlota, type InfoCatalogo,
} from '../../lib/centroOperacionesFlotaReporte';

const LOGOS: { k: keyof LogosCop; label: string }[] = [
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];

export function ReporteFlotaCop({ sitio, logosDelSitio }: { sitio: Sitio; logosDelSitio: LogosCop }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaFlota[] | null>(null);
  const [estados, setEstados] = useState<EstadoFlota[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [ids, setIds] = useState<string[] | null>(null);
  const [buscaMaq, setBuscaMaq] = useState('');
  const [columnas, setColumnas] = useState<string[]>(columnasPorDefecto());
  const [logos, setLogos] = useState<LogosCop>(logosDelSitio);
  const [titulo, setTitulo] = useState('');
  const [emitida, setEmitida] = useState('');
  const [generando, setGenerando] = useState(false);

  useEffect(() => { setLogos(logosDelSitio); }, [logosDelSitio]);

  // Se lee SOLO al abrir la tarjeta (o al tocar 🔄): la flota, inspección y el Catálogo.
  const cargar = useCallback(async () => {
    setCargando(true); setError(null); setAviso(null);
    try {
      const unidades: Unidad[] = await cargarUnidades(sitio.id);
      const vinculadas = vinculadasParaInspeccion(unidades);
      let insp: any = null;
      let cat: Record<string, InfoCatalogo> = {};
      try { insp = vinculadas.length ? await cargarEstadoInspeccion(vinculadas) : null; }
      catch { setAviso('No se pudo leer inspección: las máquinas del Catálogo sin marca salen «❔ Sin dato».'); }
      try { cat = await cargarCatalogoDeFlota(vinculadas.map((v) => v.machineryId)); }
      catch { setAviso((a) => `${a ? `${a} ` : ''}No se pudo leer la categoría y la empresa del Catálogo.`); }
      setFilas(filasDeFlota(unidades, insp, cat, Date.now()));
    } catch (e: any) {
      setError(e?.message || 'No se pudo leer la flota.');
    } finally {
      setCargando(false);
    }
  }, [sitio.id]);
  useEffect(() => { if (abierto && filas === null && !cargando) void cargar(); }, [abierto, filas, cargando, cargar]);
  useEffect(() => { setFilas(null); setEstados([]); setCategorias([]); setEmpresas([]); setIds(null); }, [sitio.id]);

  const todas = filas ?? [];
  const opciones = useMemo(() => opcionesDeFlota(todas), [todas]);
  const filtros = { estados, categorias, empresas, ids };
  const elegidas = useMemo(() => filtrarFlota(todas, filtros), [todas, estados, categorias, empresas, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const conteo = useMemo(() => conteoFlota(todas), [todas]);

  const alternar = <T,>(lista: T[], v: T): T[] => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const pill = (on: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface });
  const pillTxt = (on: boolean) => ({ color: on ? colors.primaryContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text } as const;
  const fila = (children: React.ReactNode) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{children}</View>;

  const html = () => pdfDocument({
    title: titulo.trim() || 'Reporte de la flota',
    subtitle: `${sitio.nombre} · ${elegidas.length} máquina(s)`,
    body: cuerpoFlota(elegidas, columnas),
    extraCss: CSS_FLOTA,
    logos,
    marcaTexto: false,
    emitida: emitida.trim() || undefined,
  });

  const generar = async () => {
    if (!elegidas.length) { toast.warn('No hay máquinas con esos filtros.'); return; }
    setGenerando(true);
    try { await exportPdf(html(), nombreArchivoFlota(sitio.nombre, caracasBusinessToday(), filtros)); }
    catch (e: any) { toast.error(e?.message || 'No se pudo generar el PDF.'); }
    finally { setGenerando(false); }
  };

  const maqVisibles = todas.filter((f) => { const q = buscaMaq.trim().toLowerCase(); return !q || [f.codigo, f.placa, f.descripcion, f.serial].some((v) => v.toLowerCase().includes(q)); }).slice(0, 80);

  return (
    <Card>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '900', flex: 1 }}>{abierto ? '▾' : '▸'} 📋 Reporte de la flota del sitio</Text>
        {filas ? <Text style={{ color: colors.muted, fontSize: 12 }}>{elegidas.length} de {todas.length}</Text> : null}
      </TouchableOpacity>
      {abierto ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Las máquinas del sitio con su estado (el mismo del bloque 🚜 del Parte diario). Elige qué sale, con qué columnas y con qué logos. Solo lee: no cambia nada.</Text>
          {cargando ? <Text style={{ color: colors.muted }}>Leyendo la flota…</Text> : null}
          {error ? <Text style={{ color: colors.danger }}>⚠️ {error}</Text> : null}
          {aviso ? <Text style={{ color: colors.warning, fontSize: 12 }}>⚠️ {aviso}</Text> : null}
          {filas ? (
            <>
              {/* Los cubos por estado (como en el Catálogo): tocarlos filtra */}
              {fila(ESTADOS_FLOTA.filter((e) => conteo[e] > 0 || e !== 'sin_dato').map((e) => (
                <TouchableOpacity key={e} onPress={() => setEstados((l) => alternar(l, e))} style={pill(estados.includes(e))}>
                  <Text style={pillTxt(estados.includes(e))}>{ETIQUETA_ESTADO_FLOTA[e]} · {conteo[e]}</Text>
                </TouchableOpacity>
              )))}
              <Plegable titulo="🏷️ Categoría y empresa" resumen={categorias.length + empresas.length ? `${categorias.length + empresas.length} elegida(s)` : 'Todas'}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>CATEGORÍA</Text>
                {fila(opciones.categorias.map((c) => <TouchableOpacity key={c} onPress={() => setCategorias((l) => alternar(l, c))} style={pill(categorias.includes(c))}><Text style={pillTxt(categorias.includes(c))}>{c}</Text></TouchableOpacity>))}
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>EMPRESA</Text>
                {fila(opciones.empresas.map((c) => <TouchableOpacity key={c} onPress={() => setEmpresas((l) => alternar(l, c))} style={pill(empresas.includes(c))}><Text style={pillTxt(empresas.includes(c))}>🏢 {c}</Text></TouchableOpacity>))}
              </Plegable>
              <Plegable titulo="🚜 Máquinas" resumen={ids ? `${ids.length} elegida(s) a mano` : 'Todas'}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
                  <TouchableOpacity onPress={() => setIds(null)} style={pill(ids === null)}><Text style={pillTxt(ids === null)}>Todas</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setIds([])} style={pill(false)}><Text style={pillTxt(false)}>Ninguna (elegir una por una)</Text></TouchableOpacity>
                </View>
                <TextInput value={buscaMaq} onChangeText={setBuscaMaq} placeholder="🔎 Código, placa, descripción…" placeholderTextColor={colors.muted} style={input} />
                {maqVisibles.map((f) => {
                  const on = ids === null || ids.includes(f.id);
                  return (
                    <TouchableOpacity key={f.id} onPress={() => setIds((l) => alternar(l ?? todas.map((x) => x.id), f.id))} style={{ paddingVertical: 4 }}>
                      <Text style={{ color: colors.text, fontSize: 13 }}>{on ? '☑️' : '⬜'} {f.codigo}{f.placa ? ` · ${f.placa}` : ''} <Text style={{ color: colors.muted, fontSize: 11 }}>{ETIQUETA_ESTADO_FLOTA[f.estado]}</Text></Text>
                    </TouchableOpacity>
                  );
                })}
              </Plegable>
              <Plegable titulo="📑 Columnas" resumen={`${columnas.length} de ${COLUMNAS_FLOTA.length}`}>
                {COLUMNAS_FLOTA.map((c) => <Toggle key={c.key} on={columnas.includes(c.key)} label={c.label} onPress={() => setColumnas((l) => (l.includes(c.key) ? l.filter((x) => x !== c.key) : COLUMNAS_FLOTA.map((x) => x.key).filter((k) => k === c.key || l.includes(k))))} />)}
              </Plegable>
              <Plegable titulo="🏷️ Logos" resumen={LOGOS.filter((l) => logos[l.k]).map((l) => l.label.replace(/^\S+\s/, '')).join(', ') || 'Sin logos'}>
                {LOGOS.map((l) => <Toggle key={l.k} on={!!logos[l.k]} label={l.label} onPress={() => setLogos((o) => ({ ...o, [l.k]: !o[l.k] }))} />)}
              </Plegable>
              <Plegable titulo="✏️ Título y emisión" resumen={titulo || 'Reporte de la flota'}>
                <TextInput value={titulo} onChangeText={setTitulo} placeholder="Reporte de la flota" placeholderTextColor={colors.muted} style={input} />
                <TextInput value={emitida} onChangeText={setEmitida} placeholder="Emitida: (vacío = fecha y hora reales)" placeholderTextColor={colors.muted} style={[input, { marginTop: spacing.xs }]} />
              </Plegable>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                <TouchableOpacity disabled={generando || !elegidas.length} onPress={generar} style={[pill(true), { opacity: generando || !elegidas.length ? 0.5 : 1 }]}>
                  <Text style={pillTxt(true)}>{generando ? 'Generando…' : `📄 PDF (${elegidas.length} máquina(s))`}</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={cargando} onPress={() => void cargar()} style={pill(false)}><Text style={pillTxt(false)}>🔄 Actualizar</Text></TouchableOpacity>
                {estados.length || categorias.length || empresas.length || ids ? (
                  <TouchableOpacity onPress={() => { setEstados([]); setCategorias([]); setEmpresas([]); setIds(null); }} style={pill(false)}><Text style={[pillTxt(false), { color: colors.danger }]}>✕ Limpiar filtros</Text></TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default ReporteFlotaCop;
