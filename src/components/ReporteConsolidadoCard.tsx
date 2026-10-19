// 💰 REPORTE CONSOLIDADO DE PAGOS — la pestaña de Reportes (19-oct-2026).
//
// Junta los CUATRO pagos (jornadas, horómetros, viajes y peso) en un papel para
// el jefe. «No inventa nada»: cada monto sale de su motor de siempre —
// jornadas con la receta exacta de Control de Pagos (src/lib/pagoJornadas.ts),
// horómetros con filasPagoHorometro (cierres incluidos), viajes con
// calcularPagoViajes y peso con calcularPagoPeso. Acá solo se carga, se junta
// (src/lib/reporteConsolidado.ts, pura) y se pinta.
//
// ⭐ VIVE EN SU PROPIO ARCHIVO a propósito: scripts/test-pago-viajes.mjs
//    prohíbe que ReportsScreen.tsx nombre pagoViajes.
//
// QUIÉN LO VE: solo con el módulo «control_pagos» (nace cerrado): son montos de
// facturación. Reportes está abierto a casi todos los roles y no sirve de candado.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { Toggle } from './CubicajeTab';
import { DateField } from './DateField';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { LOGOS_POR_DEFECTO, type LogosReporte } from '../lib/cubicaje';
import { supabase, selectAllRows } from '../lib/supabase';
import { cargarHistorialPrecios } from '../lib/precioHistorialDb';
import { montosJornadaPorMaquina, weekStartISO, addDaysISO, periodStartISO, periodEndISO, type RondaJornada } from '../lib/pagoJornadas';
import { filasPagoHorometro } from '../lib/pagoHorometro';
import { cargarMaquinasPagoHorometro, cargarPreciosHorometro, cargarAjustesHorometro, cargarCierresHorometro, cargarCambiosHorometro } from '../lib/pagoHorometroDb';
import { cargarLecturasHorometro } from '../lib/horometroTrabajoDb';
import { calcularPagoViajes, viajesEnRango, indexarModos, indexarMarcas } from '../lib/pagoViajes';
import { cargarDatosPagoViajes, } from '../lib/pagoViajesDb';
import { calcularPagoPeso, viajesPesoEnRango, indexarMarcasPeso, renglonesPorCamionPeso } from '../lib/pagoPeso';
import { cargarDatosPagoPeso } from '../lib/pagoPesoDb';
import {
  FUENTES_META, FUENTES_ORDEN, OPCIONES_CONSOLIDADO_POR_DEFECTO, CSS_CONSOLIDADO,
  cuerpoConsolidado, subtituloConsolidado, nombreArchivoConsolidado, totalesConsolidado,
  usd, cantTexto, type FilaConsolidada, type OpcionesConsolidado, type FuenteKey, type ModoFuente,
} from '../lib/reporteConsolidado';
import { EDICION_RESUMEN_VACIA, edicionAlCambiarDeDia, type EdicionResumen, type TarjetaPropia } from '../lib/frentesReporte';
import { caracasBusinessToday } from '../lib/caracasDay';

const LOGOS: [keyof LogosReporte, string][] = [
  ['bcv', 'BCV'], ['sos', 'SOS La Guaira'], ['golden', 'Golden Touch'],
  ['renace', 'Plan Venezuela Renace'], ['jhenzaen', 'Jhenzaen 2.012 C.A'],
];

/** El resumen que la pantalla deja ocultar/editar (claves de resumenConsolidado). */
const TARJETAS_EDITABLES: { k: string; label: string }[] = [
  { k: 'total', label: '💰 Total general' },
  { k: 'maquinas', label: '🚜 Máquinas' },
  { k: 'promedio_dia', label: '📅 Promedio por día' },
  { k: 'comparacion', label: '📊 vs período anterior' },
];

export function ReporteConsolidadoCard() {
  const { colors } = useTheme();
  const toast = useToast();
  const { moduleLevel } = useAuth();
  const puedeVer = levelMeets(moduleLevel('control_pagos'), 'lectura');

  const hoy = caracasBusinessToday();
  const [desde, setDesde] = useState(weekStartISO(hoy));
  const [hasta, setHasta] = useState(addDaysISO(weekStartISO(hoy), 6));
  const [op, setOp] = useState<OpcionesConsolidado>({ ...OPCIONES_CONSOLIDADO_POR_DEFECTO });
  const [logos, setLogos] = useState<LogosReporte>({ ...LOGOS_POR_DEFECTO, bcv: false, sos: false });
  const [edicion, setEdicion] = useState<EdicionResumen>({ ...EDICION_RESUMEN_VACIA });
  const [filas, setFilas] = useState<FilaConsolidada[] | null>(null);
  const [filasAnt, setFilasAnt] = useState<FilaConsolidada[] | null>(null);
  const [rangoCalculado, setRangoCalculado] = useState<{ desde: string; hasta: string } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [buscaMaq, setBuscaMaq] = useState('');
  const [verMaquinas, setVerMaquinas] = useState(false);
  const [propiaTitulo, setPropiaTitulo] = useState('');
  const [propiaValor, setPropiaValor] = useState('');

  const setFuente = (k: FuenteKey) => {
    // Tres posiciones en rueda: suma → muestra (sin sumar) → oculta → suma.
    const orden: ModoFuente[] = ['suma', 'muestra', 'oculta'];
    setOp((p) => ({ ...p, fuentes: { ...p.fuentes, [k]: orden[(orden.indexOf(p.fuentes[k]) + 1) % 3] } }));
  };

  const calcular = async () => {
    if (cargando) return;
    if (!desde || !hasta || hasta < desde) { toast.error('Revisa el rango de fechas.'); return; }
    setCargando(true);
    setAvisos([]);
    try {
      const dias = Math.round((Date.parse(`${hasta}T12:00Z`) - Date.parse(`${desde}T12:00Z`)) / 86400000) + 1;
      const antHasta = addDaysISO(desde, -1);
      const antDesde = addDaysISO(antHasta, -(dias - 1));
      // Jornadas: el select EXACTO de Control de Pagos, en semanas completas
      // (el precio por rango es semanal) cubriendo también el período anterior.
      const rondasDesde = periodStartISO(antDesde);
      const rondasHasta = periodEndISO(periodStartISO(hasta));
      const [rounds, hist, vDatos, pDatos, maqsH, lecturas, precios, ajustes, cierres, cambios] = await Promise.all([
        selectAllRows('machine_rounds',
          'round_date, round_no, hours_stopped, overtime_hours, day_hours, night_hours, status, frozen_price, machinery:machinery_id(id, code, serial, plate, tipo, price_per_hour, company:company_id(id, name))',
          (q: any) => q.gte('round_date', rondasDesde).lte('round_date', rondasHasta)),
        cargarHistorialPrecios(),
        cargarDatosPagoViajes(),
        cargarDatosPagoPeso(),
        cargarMaquinasPagoHorometro(),
        cargarLecturasHorometro(antDesde, hasta),
        cargarPreciosHorometro(),
        cargarAjustesHorometro(antDesde, hasta),
        cargarCierresHorometro(),
        cargarCambiosHorometro(antDesde, hasta),
      ]);
      void supabase;
      const nuevosAvisos: string[] = [];
      if (precios.error || precios.missing) nuevosAvisos.push('⚙️ Horómetros: no se pudieron leer los precios — esa columna puede salir incompleta.');
      if (pDatos.faltaSql) nuevosAvisos.push('⚖️ Peso: falta el SQL de tarifas por peso — esa columna sale en $0.');
      if (dias > 92) nuevosAvisos.push('⚙️ Horómetros solo cubre hasta 92 días por rango.');

      const fichasV = (vDatos as any).fichas as Map<string, any> | undefined;
      const fichasP = (pDatos as any).fichas as Map<string, any> | undefined;
      const nombresEmpresa = (id: string | null | undefined, deViajes: boolean): string => {
        const m = deViajes ? (vDatos as any).empresas : (pDatos as any).empresas;
        return (id && m?.get?.(id)) || 'Sin empresa';
      };

      const armar = (d1: string, d2: string): FilaConsolidada[] => {
        const porId = new Map<string, FilaConsolidada>();
        const fila = (id: string, code: string, placa: string, empresa: string, marca?: string | null, modelo?: string | null): FilaConsolidada => {
          const f = porId.get(id) ?? { id, code, placa, empresa, marca: marca ?? null, modelo: modelo ?? null, montos: {} };
          if (!porId.has(id)) porId.set(id, f);
          if (empresa && f.empresa === 'Sin empresa') f.empresa = empresa;
          if (!f.marca && marca) f.marca = marca;
          if (!f.modelo && modelo) f.modelo = modelo;
          return f;
        };
        const suma = (f: FilaConsolidada, k: FuenteKey, v: number, cant?: number) => {
          f.montos[k] = Math.round(((f.montos[k] ?? 0) + v) * 100) / 100;
          if (cant) {
            f.cant = f.cant ?? {};
            f.cant[k] = Math.round(((f.cant[k] ?? 0) + cant) * 100) / 100;
          }
        };

        // 🕐 Jornadas (receta de Control de Pagos) — el respaldo son sus HORAS
        for (const j of montosJornadaPorMaquina({ rounds: rounds as unknown as RondaJornada[], hist, desde: d1, hasta: d2 })) {
          suma(fila(j.id, j.code, j.placa, j.empresa), 'jornadas', j.monto, j.horas);
        }
        // ⚙️ Horómetros (con cierres: lo cerrado sale de la foto, como el panel) — HORAS
        for (const h of filasPagoHorometro({ maquinas: maqsH, lecturas, precios: precios.precios, desde: d1, hasta: d2, ajustes: ajustes.ajustes, cierres: cierres.cierres, cambios: cambios.cambios })) {
          if (h.monto === 0 && h.horas === 0) continue;
          suma(fila(h.maquina.id, h.maquina.code, h.maquina.placa, h.maquina.empresa, (h.maquina as any).marca, (h.maquina as any).modelo), 'horometros', h.monto, h.horas);
        }
        // 🚛 Viajes (un solo grupo por empresa con semanaDe fija, como la tarjeta del módulo)
        const grupos = calcularPagoViajes({
          viajes: viajesEnRango((vDatos as any).viajes, d1, d2),
          modos: indexarModos((vDatos as any).modos),
          tarifas: (vDatos as any).tarifas,
          marcas: indexarMarcas((vDatos as any).marcas),
          semanaDe: () => 'rango',
          desde: d1,
        });
        grupos.forEach((g: any) => {
          const empresa = nombresEmpresa(g.companyId, true);
          for (const c of g.porCamion ?? []) {
            if (!c.monto) continue;
            const ficha = fichasV?.get(c.machineryId);
            // El respaldo son los VIAJES CON TARIFA (los que hicieron el monto)
            suma(fila(c.machineryId, c.code, c.placa ?? ficha?.placa ?? '', empresa, ficha?.marca, ficha?.modelo), 'viajes', c.monto, c.pagados);
          }
        });
        // ⚖️ Peso (todos los camiones; el solape con viajes lo marca el papel)
        const lineasPeso = calcularPagoPeso({ viajes: viajesPesoEnRango((pDatos as any).viajes, d1, d2), tarifas: (pDatos as any).tarifas, marcas: indexarMarcasPeso((pDatos as any).marcas) });
        for (const r of renglonesPorCamionPeso(lineasPeso, (pDatos as any).fichas, (pDatos as any).empresas)) {
          if (!r.monto) continue;
          const ficha = fichasP?.get(r.machineryId);
          // El respaldo son los KG pagados (el papel los pinta en toneladas)
          suma(fila(r.machineryId, r.code, r.placa ?? ficha?.placa ?? '', r.empresa || 'Sin empresa', ficha?.marca, ficha?.modelo), 'peso', r.monto, r.kg);
        }
        return Array.from(porId.values());
      };

      setFilas(armar(desde, hasta));
      setFilasAnt(armar(antDesde, antHasta));
      setRangoCalculado({ desde, hasta });
      setAvisos(nuevosAvisos);
      setEdicion((e) => edicionAlCambiarDeDia(e)); // los valores a mano no viajan a otro rango
    } catch (e: any) {
      toast.error(`No se pudo calcular: ${String(e?.message ?? e)}`);
      setFilas(null);
    } finally {
      setCargando(false);
    }
  };

  const generarPdf = async () => {
    if (!filas || !rangoCalculado || pdfBusy) return;
    setPdfBusy(true);
    try {
      const filtrado = (op.soloMaquinas ?? []).length > 0;
      const html = pdfDocument({
        title: 'Reporte consolidado de pagos',
        subtitle: subtituloConsolidado(rangoCalculado, op, filtrado),
        extraCss: CSS_CONSOLIDADO,
        body: cuerpoConsolidado({ filas, filasAnterior: filasAnt, desde: rangoCalculado.desde, hasta: rangoCalculado.hasta }, op, edicion),
        logos,
        marcaTexto: false,
      });
      await exportPdf(html, nombreArchivoConsolidado(rangoCalculado.desde, rangoCalculado.hasta, op));
    } catch (e: any) {
      toast.error(`No se pudo generar el PDF: ${String(e?.message ?? e)}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const t = useMemo(() => (filas ? totalesConsolidado(filas, op) : null), [filas, op]);
  const maqSel = new Set(op.soloMaquinas ?? []);
  const q = buscaMaq.trim().toLowerCase();
  const maquinasLista = useMemo(() => (filas ?? [])
    .filter((f) => !q || `${f.code} ${f.placa} ${f.empresa}`.toLowerCase().includes(q))
    .slice().sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })), [filas, q]);

  const Pastilla = ({ on, label, onPress, warn }: { on: boolean; label: string; onPress: () => void; warn?: boolean }) => (
    <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? (warn ? colors.warning : colors.primary) : colors.border, backgroundColor: on ? (warn ? colors.warning : colors.primary) : 'transparent' }}>
      <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontWeight: '700', fontSize: 11 }}>{label}</Text>
    </TouchableOpacity>
  );

  if (!puedeVer) {
    return (
      <View style={{ padding: spacing.md }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          💰 El consolidado junta los montos de facturación. Hace falta el permiso de Control de pagos (se da en Usuarios).
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>💰 Reporte consolidado de pagos</Text>
      <Text style={{ color: colors.muted, fontSize: 11.5 }}>
        Jornadas + horómetros + viajes + peso en un solo papel, con resumen ejecutivo. No inventa nada: cada monto sale de su propio control.
      </Text>

      {/* Rango */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <DateField value={desde} onChange={setDesde} />
        <Text style={{ color: colors.muted }}>→</Text>
        <DateField value={hasta} onChange={setHasta} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
        <Pastilla on={false} label="📅 Esta semana" onPress={() => { const w = weekStartISO(hoy); setDesde(w); setHasta(addDaysISO(w, 6)); }} />
        <Pastilla on={false} label="📅 Semana pasada" onPress={() => { const w = addDaysISO(weekStartISO(hoy), -7); setDesde(w); setHasta(addDaysISO(w, 6)); }} />
        <TouchableOpacity disabled={cargando} onPress={calcular} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, opacity: cargando ? 0.6 : 1 }}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{cargando ? 'Calculando…' : '🔄 Calcular'}</Text>
        </TouchableOpacity>
      </View>
      {avisos.map((a, i) => <Text key={`av-${i}`} style={{ color: '#92400E', fontSize: 11 }}>{a}</Text>)}

      {/* Fuentes: 3 posiciones */}
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>QUÉ FUENTES ENTRAN (toca para rotar: suma → sin sumar → oculta)</Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
        {FUENTES_ORDEN.map((k) => {
          const modo = op.fuentes[k];
          const label = `${FUENTES_META[k].icon} ${FUENTES_META[k].label}${modo === 'muestra' ? ' (sin sumar)' : modo === 'oculta' ? ' (oculta)' : ''}`;
          return <Pastilla key={k} on={modo !== 'oculta'} warn={modo === 'muestra'} label={label} onPress={() => setFuente(k)} />;
        })}
      </View>

      {/* Agrupar */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: colors.muted, fontSize: 11 }}>Agrupar:</Text>
        <Pastilla on={op.agruparPor === 'empresa'} label="🏢 Por empresa" onPress={() => setOp((p) => ({ ...p, agruparPor: 'empresa' }))} />
        <Pastilla on={op.agruparPor === 'maquina'} label="🚜 Por máquina" onPress={() => setOp((p) => ({ ...p, agruparPor: 'maquina' }))} />
        <Pastilla on={op.agruparPor === 'global'} label="📋 Global" onPress={() => setOp((p) => ({ ...p, agruparPor: 'global' }))} />
      </View>

      {/* Totales en vivo */}
      {t ? (
        <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>💰 {usd(t.total)}</Text>
          <Text style={{ color: colors.muted, fontSize: 11.5 }}>
            {FUENTES_ORDEN.filter((k) => op.fuentes[k] !== 'oculta').map((k) => {
              const respaldo = cantTexto(k, t.cantPorFuente[k]);
              return `${FUENTES_META[k].icon} ${usd(t.porFuente[k])}${respaldo ? ` (${respaldo})` : ''}${op.fuentes[k] === 'muestra' ? ' (no suma)' : ''}`;
            }).join(' · ')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{t.maquinas} máquina(s) · {t.empresas} empresa(s) · del {rangoCalculado?.desde} al {rangoCalculado?.hasta}</Text>
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Elige el rango y toca 🔄 Calcular.</Text>
      )}

      {/* Quitar máquinas */}
      {filas?.length ? (
        <View>
          <TouchableOpacity onPress={() => setVerMaquinas((v) => !v)}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
              🚜 Elegir máquinas {maqSel.size ? `(solo ${maqSel.size} — FILTRADO)` : '(todas)'} {verMaquinas ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
          {verMaquinas ? (
            <View style={{ marginTop: spacing.xs }}>
              <TextInput value={buscaMaq} onChangeText={setBuscaMaq} placeholder="🔎 Buscar por código, placa o empresa…" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} autoCorrect={false} />
              {maqSel.size ? (
                <TouchableOpacity onPress={() => setOp((p) => ({ ...p, soloMaquinas: [] }))}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11, marginTop: 4 }}>✕ Limpiar (volver a todas)</Text></TouchableOpacity>
              ) : null}
              <ScrollView style={{ maxHeight: 220, marginTop: spacing.xs }} nestedScrollEnabled>
                {maquinasLista.map((f) => {
                  const on = maqSel.has(f.id);
                  return (
                    <TouchableOpacity key={f.id} onPress={() => setOp((p) => { const s = new Set(p.soloMaquinas ?? []); on ? s.delete(f.id) : s.add(f.id); return { ...p, soloMaquinas: Array.from(s) }; })}
                      style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ width: 24, fontSize: 13 }}>{on ? '☑️' : '⬜'}</Text>
                      <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>{f.code}{f.placa ? ` · ${f.placa}` : ''} <Text style={{ color: colors.muted }}>· {f.empresa}</Text></Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={{ color: colors.muted, fontSize: 10 }}>Marcar máquinas SÍ cambia el total: el papel sale FILTRADO.</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Qué sale en el papel */}
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>🖨️ QUÉ SALE EN EL PAPEL</Text>
      <Toggle on={op.resumen} label="📊 Resumen ejecutivo (todo el bloque)" onPress={() => setOp((p) => ({ ...p, resumen: !p.resumen }))} />
      {op.resumen ? (
        <View style={{ paddingLeft: spacing.md }}>
          <Toggle on={op.tarjetasFuente} label="Tarjetas por fuente (con su % del total)" onPress={() => setOp((p) => ({ ...p, tarjetasFuente: !p.tarjetasFuente }))} />
          <Toggle on={op.cuadroEmpresas && !op.sinEmpresas} label="🏢 Cuánto se le paga a cada empresa" onPress={() => setOp((p) => ({ ...p, cuadroEmpresas: !p.cuadroEmpresas }))} />
          <Toggle on={op.top5} label="🏆 Las 5 máquinas más costosas" onPress={() => setOp((p) => ({ ...p, top5: !p.top5 }))} />
          <Toggle on={op.solapes} label="⚠️ Cobran por dos fuentes a la vez" onPress={() => setOp((p) => ({ ...p, solapes: !p.solapes }))} />
          <Toggle on={op.comparacion} label="📊 Comparación con el período anterior" onPress={() => setOp((p) => ({ ...p, comparacion: !p.comparacion }))} />
          <Toggle on={op.promedioDia} label="📅 Promedio por día" onPress={() => setOp((p) => ({ ...p, promedioDia: !p.promedioDia }))} />
          {/* Ocultar tarjetas una por una (como el resumen de frentes) */}
          <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>Ocultar tarjetas sueltas:</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 2 }}>
            {TARJETAS_EDITABLES.map((tj) => {
              const oculta = (edicion.ocultos ?? []).includes(tj.k);
              return <Pastilla key={tj.k} on={oculta} warn label={`🚫 ${tj.label}`} onPress={() => setEdicion((e) => ({ ...e, ocultos: oculta ? (e.ocultos ?? []).filter((x) => x !== tj.k) : [...(e.ocultos ?? []), tj.k] }))} />;
            })}
          </View>
          {/* Tarjetas propias (ej. «menos anticipo: −$2.000») */}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, alignItems: 'center' }}>
            <TextInput value={propiaTitulo} onChangeText={setPropiaTitulo} placeholder="Tarjeta propia: título…" placeholderTextColor={colors.muted}
              style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text, fontSize: 12 }} />
            <TextInput value={propiaValor} onChangeText={setPropiaValor} placeholder="Valor…" placeholderTextColor={colors.muted}
              style={{ width: 110, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xs, color: colors.text, fontSize: 12 }} />
            <TouchableOpacity disabled={!propiaTitulo.trim() || !propiaValor.trim()} onPress={() => {
              const nueva: TarjetaPropia = { titulo: propiaTitulo.trim(), valor: propiaValor.trim() };
              setEdicion((e) => ({ ...e, propias: [...(e.propias ?? []), nueva] }));
              setPropiaTitulo(''); setPropiaValor('');
            }} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, opacity: propiaTitulo.trim() && propiaValor.trim() ? 1 : 0.5 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>➕</Text>
            </TouchableOpacity>
          </View>
          {(edicion.propias ?? []).map((pp, i) => (
            <View key={`pp-${i}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 11, flex: 1 }}>➕ {pp.titulo}: {pp.valor} <Text style={{ fontStyle: 'italic' }}>(a mano, solo este papel)</Text></Text>
              <TouchableOpacity onPress={() => setEdicion((e) => ({ ...e, propias: (e.propias ?? []).filter((_, j) => j !== i) }))}>
                <Text style={{ color: colors.danger, fontWeight: '800' }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <Toggle on={!op.sinCantidades} label="📏 Lo que respalda cada monto (horas, viajes, toneladas)" onPress={() => setOp((p) => ({ ...p, sinCantidades: !p.sinCantidades }))} />
      <Toggle on={!op.sinPlaca} label="🔢 Placa / serial" onPress={() => setOp((p) => ({ ...p, sinPlaca: !p.sinPlaca }))} />
      <Toggle on={!op.sinMarcaModelo} label="🏷️ Marca y modelo (nace apagada)" onPress={() => setOp((p) => ({ ...p, sinMarcaModelo: !p.sinMarcaModelo }))} />
      <Toggle on={!op.sinEmpresas} label="🏢 Nombres de empresa" ayuda="Apagado, no salen por ninguna parte (ni el cuadro por empresa)." onPress={() => setOp((p) => ({ ...p, sinEmpresas: !p.sinEmpresas }))} />

      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>🏷️ QUÉ LOGOS LLEVA EL MEMBRETE</Text>
      {LOGOS.map(([k, label]) => <Toggle key={`lg-${k}`} on={logos[k]} label={label} onPress={() => setLogos((p) => ({ ...p, [k]: !p[k] }))} />)}

      <TouchableOpacity disabled={!filas || pdfBusy} onPress={generarPdf}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: !filas || pdfBusy ? 0.5 : 1, marginTop: spacing.xs }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{pdfBusy ? 'Generando…' : '🖨️ Generar PDF del consolidado'}</Text>
      </TouchableOpacity>
      <Text style={{ color: colors.muted, fontSize: 10 }}>
        Solo lee: no cambia precios, cierres ni viajes. Lo oculto no deja rastro en el papel; el nombre del archivo sí dice lo cambiado.
      </Text>
    </View>
  );
}
