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
// ⛏️ El frente VIGENTE de maquinaria (pegajoso desde el 19-oct): para agrupar
//    el consolidado por frente de trabajo (20-oct-2026, a pedido).
// 20-oct-2026, a pedido: «esos frentes que maneja solo camiones deberían
// sincronizarse con los frentes de reportes que se enlazan al consolidado» —
// también se lee la asignación de VIAJES (diaria) para los camiones.
import { listAsignacionesHasta, listFrentes, FRENTES_MAQUINARIA, FRENTES_VIAJES } from '../lib/camionViajes';
import { vigentesAlDia } from '../lib/frentesReporte';
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
  usd, cantTexto, categoriaDe, frenteDe, encargadoDe, type FilaConsolidada, type OpcionesConsolidado, type FuenteKey, type ModoFuente,
  type ViajeToneladas, type DiaCrudoConsolidado, MAX_DIAS_GRAFICO_CONSOLIDADO,
  indiceFrentesConsolidado, camionesConPeso,
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
  // ⚖️🕐 21-oct-2026, a pedido del jefe: el costo por tonelada y la hora promedio.
  { k: 'costo_ton', label: '⚖️ Costo por tonelada' },
  { k: 'hora_prom', label: '🕐 Hora promedio' },
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
  // ⚖️ Los viajes del rango cargado (frente + peso), para el costo por tonelada.
  const [viajesTon, setViajesTon] = useState<ViajeToneladas[]>([]);
  // 📅 El día por día del rango (21-oct-2026, a pedido): las filas de CADA día,
  //    armadas con los mismos motores. Vacío = la sección no sale.
  const [porDia, setPorDia] = useState<DiaCrudoConsolidado[]>([]);
  // ⛏️ Los nombres de los frentes que EXISTEN (los dos catálogos): para juntar
  //    los nombres repetidos sin arriesgar (ver indiceFrentesConsolidado).
  const [catalogoFrentes, setCatalogoFrentes] = useState<string[]>([]);
  const [rangoCalculado, setRangoCalculado] = useState<{ desde: string; hasta: string } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [buscaMaq, setBuscaMaq] = useState('');
  const [verMaquinas, setVerMaquinas] = useState(false);
  const [propiaTitulo, setPropiaTitulo] = useState('');
  const [propiaValor, setPropiaValor] = useState('');

  // Las opciones del usuario MÁS el catálogo de frentes (que no es una opción
  // suya: es el dato con el que se juntan los nombres repetidos).
  const opFull = useMemo(() => ({ ...op, catalogoFrentes }), [op, catalogoFrentes]);

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
      const [rounds, hist, vDatos, pDatos, maqsH, lecturas, precios, ajustes, cierres, cambios, catalogo, asigsFrente, asigsFrenteViajes, frentesMaq, frentesVia] = await Promise.all([
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
        // 🏷️👤⚙️ La clasificación, encargado y estado del catálogo (filtrar y agrupar).
        selectAllRows('machinery', 'id, clasificacion, encargado, operational, en_espera, active, transferida').catch(() => [] as any[]),
        // ⛏️ El frente vigente a la fecha FINAL del rango (si falta el SQL de
        //    frentes, el papel sale todo en «Sin frente» y nada revienta).
        listAsignacionesHasta(hasta, FRENTES_MAQUINARIA).catch(() => ({ asignaciones: [], missing: true })),
        // ⛏️🚛 …y la de VIAJES (diaria): los camiones se asignan allá, y este
        //    papel debe verlos con SU frente, no todos en «Sin frente».
        listAsignacionesHasta(hasta, FRENTES_VIAJES).catch(() => ({ asignaciones: [], missing: true })),
        // ⛏️ LOS DOS CATÁLOGOS DE FRENTES (21-oct-2026): con la lista de los
        //    frentes que EXISTEN, el papel junta «RES. CORAL» (congelado en un
        //    viaje) con «RESIDENCIAS CORAL» sin arriesgarse a meter un frente
        //    de verdad dentro de otro parecido. Si no se pueden leer, la lib se
        //    pone prudente y junta menos — nunca de más.
        listFrentes(FRENTES_MAQUINARIA).catch(() => ({ frentes: [], missing: true })),
        listFrentes(FRENTES_VIAJES).catch(() => ({ frentes: [], missing: true })),
      ]);
      void supabase;
      const nuevosAvisos: string[] = [];
      if (precios.error || precios.missing) nuevosAvisos.push('⚙️ Horómetros: no se pudieron leer los precios — esa columna puede salir incompleta.');
      if (pDatos.faltaSql) nuevosAvisos.push('⚖️ Peso: falta el SQL de tarifas por peso — esa columna sale en $0.');
      if (dias > 92) nuevosAvisos.push('⚙️ Horómetros solo cubre hasta 92 días por rango.');

      // id → clasificación del catálogo, id → encargado, id → estado, y id → frente vigente al final del rango.
      const catPorId = new Map<string, string>((catalogo as any[]).map((m) => [String(m.id), String(m.clasificacion ?? '').trim()]));
      const encargadoPorId = new Map<string, string>((catalogo as any[]).map((m) => [String(m.id), String(m.encargado ?? '').trim()]));
      const estadoDe = (m: any): string => {
        if (m.active === false) return 'Inactiva';
        if (m.en_espera === true) return 'En espera';
        if (m.operational === false) return m.transferida === true ? 'Transferida' : 'Inoperativa / Parada';
        return 'Operativa';
      };
      const estadoPorId = new Map<string, string>((catalogo as any[]).map((m) => [String(m.id), estadoDe(m)]));
      const frentePorId = new Map<string, string>(
        vigentesAlDia((asigsFrente as any).asignaciones ?? [], hasta).map((a: any) => [String(a.machineryId), String(a.frenteNombre ?? '').trim()]),
      );
      // Los camiones de viajes: su asignación es DIARIA, así que «vigente» acá
      // es la última anotada hasta el final del rango. La de maquinaria (si un
      // mismo id tuviera las dos) manda, porque es la de Reportes → ⛏️ Frentes.
      for (const a of vigentesAlDia((asigsFrenteViajes as any).asignaciones ?? [], hasta)) {
        const id = String((a as any).machineryId);
        if (!frentePorId.get(id)) frentePorId.set(id, String((a as any).frenteNombre ?? '').trim());
      }
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
        // 🏷️⛏️👤⚙️ A cada fila se le pega su categoría, su frente, su encargado y su estado (vacío =
        //    «Sin clasificación» / «Sin frente» / «Sin encargado» / «Operativa», lo resuelve la lib).
        return Array.from(porId.values()).map((f) => ({
          ...f,
          categoria: catPorId.get(f.id) || null,
          frente: frentePorId.get(f.id) || null,
          encargado: encargadoPorId.get(f.id) || fichasV?.get(f.id)?.encargado || fichasP?.get(f.id)?.encargado || null,
          estado: estadoPorId.get(f.id) || 'Operativa',
        }));
      };

      const filasNuevas = armar(desde, hasta);
      setFilas(filasNuevas);
      setFilasAnt(armar(antDesde, antHasta));
      // 🕐 Lo elegido «por jornada» solo vale para camiones CON PESO de este rango:
      //    los que ya no están se sueltan (no se cuentan en el nombre del archivo).
      const conPesoIds = new Set(camionesConPeso(filasNuevas).map((f) => f.id));
      setOp((p) => ({ ...p, camionesPorJornada: (p.camionesPorJornada ?? []).filter((id) => conPesoIds.has(id)) }));
      // ⚖️ Los viajes del rango (frente congelado + peso de romana) para el costo
      //    por tonelada: TODOS los viajes, con o sin tarifa — misma regla del
      //    informe operativo (el que no se pesó cuenta y suma 0 t).
      setViajesTon(viajesEnRango((vDatos as any).viajes, desde, hasta)
        .map((v: any) => ({ frente_nombre: v.frente_nombre ?? null, peso_neto_kg: v.peso_neto_kg ?? null })));
      // 📅 EL DÍA POR DÍA (21-oct-2026, a pedido: «una tabla operativa diaria
      //    con un desglose del estilo del de viajes de camiones, y la gráfica»):
      //    se corre LA MISMA `armar` con el rango de UN SOLO día — ni una
      //    consulta nueva y ni una receta duplicada. El tope es el del gráfico:
      //    más allá serían barras ilegibles y recalcular 90 veces congelaría la
      //    pantalla por nada.
      const porDiaNuevo: DiaCrudoConsolidado[] = [];
      if (dias <= MAX_DIAS_GRAFICO_CONSOLIDADO) {
        for (let i = 0; i < dias; i += 1) {
          const dd = addDaysISO(desde, i);
          porDiaNuevo.push({
            jornada: dd,
            filas: armar(dd, dd),
            viajes: viajesEnRango((vDatos as any).viajes, dd, dd)
              .map((v: any) => ({ frente_nombre: v.frente_nombre ?? null, peso_neto_kg: v.peso_neto_kg ?? null })),
          });
        }
      } else {
        nuevosAvisos.push(`📅 El día por día (tabla y gráfico) sale hasta ${MAX_DIAS_GRAFICO_CONSOLIDADO} días por rango.`);
      }
      setPorDia(porDiaNuevo);
      setCatalogoFrentes(Array.from(new Set([
        ...(((frentesMaq as any).frentes ?? []) as any[]).map((f) => String(f?.nombre ?? '').trim()),
        ...(((frentesVia as any).frentes ?? []) as any[]).map((f) => String(f?.nombre ?? '').trim()),
      ].filter(Boolean))));
      setRangoCalculado({ desde, hasta });
      setAvisos(nuevosAvisos);
      setEdicion((e) => edicionAlCambiarDeDia(e)); // los valores a mano no viajan a otro rango
    } catch (e: any) {
      toast.error(`No se pudo calcular: ${String(e?.message ?? e)}`);
      setFilas(null);
      setViajesTon([]); // sin viajes pegados de un cálculo anterior
      setPorDia([]);
    } finally {
      setCargando(false);
    }
  };

  const generarPdf = async () => {
    if (!filas || !rangoCalculado || pdfBusy) return;
    setPdfBusy(true);
    try {
      const filtrado = (op.soloMaquinas ?? []).length > 0 || (op.soloEmpresas ?? []).length > 0
        || (op.soloCategorias ?? []).length > 0 || (op.soloFrentes ?? []).length > 0
        || (op.soloEncargados ?? []).length > 0;
      const html = pdfDocument({
        title: 'Reporte consolidado de pagos',
        subtitle: subtituloConsolidado(rangoCalculado, op, filtrado),
        extraCss: CSS_CONSOLIDADO,
        body: cuerpoConsolidado({ filas, filasAnterior: filasAnt, desde: rangoCalculado.desde, hasta: rangoCalculado.hasta, viajesTon, dias: porDia }, opFull, edicion),
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

  const t = useMemo(() => (filas ? totalesConsolidado(filas, opFull, porDia) : null), [filas, opFull, porDia]);
  const maqSel = new Set(op.soloMaquinas ?? []);
  const q = buscaMaq.trim().toLowerCase();
  // ⛏️ UNA PASTILLA POR FRENTE, NO POR NOMBRE (21-oct-2026, a pedido: «me salen
  //    repetidos»): «RES. CORAL» (congelado en los viajes) y «RESIDENCIAS
  //    CORAL» (el catálogo) son el mismo frente, así que sale UNA sola pastilla
  //    con el nombre más completo — y marcarla alcanza a los dos.
  const frentesParaPastillas = useMemo(() => {
    const idx = indiceFrentesConsolidado(filas ?? [], viajesTon, opFull);
    const vistos = new Map<string, string>();
    for (const f of filas ?? []) {
      const n = frenteDe(f);
      const k = idx.clave(n);
      if (!vistos.has(k)) vistos.set(k, idx.nombre(n));
    }
    return Array.from(vistos.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [filas, viajesTon, opFull]);
  const maquinasLista = useMemo(() => (filas ?? [])
    .filter((f) => !q || `${f.code} ${f.placa} ${f.empresa}`.toLowerCase().includes(q))
    .slice().sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })), [filas, q]);
  // 🚛⚖️ Los camiones que facturan por peso: se puede pasar cada uno a jornada.
  const camionesPeso = useMemo(() => camionesConPeso(filas), [filas]);
  const porJornadaSel = new Set(op.camionesPorJornada ?? []);

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
      {/* 🏗️🚛 22-oct-2026, a pedido: en el PAPEL solo dos columnas, Maquinaria
          (jornadas + horómetros) y Acarreo (viajes + peso). Las 4 pastillas de
          arriba siguen mandando qué entra en cada columna. */}
      <Toggle on={op.columnasPorGrupo} label="🏗️🚛 En el papel: columnas Maquinaria (jornadas + horómetros) y Acarreo (viajes + peso)" ayuda="Apagado, sale una columna por cada fuente, como antes." onPress={() => setOp((p) => ({ ...p, columnasPorGrupo: !p.columnasPorGrupo }))} />

      {/* Agrupar */}
      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: colors.muted, fontSize: 11 }}>Agrupar:</Text>
        <Pastilla on={op.agruparPor === 'empresa'} label="🏢 Por empresa" onPress={() => setOp((p) => ({ ...p, agruparPor: 'empresa' }))} />
        <Pastilla on={op.agruparPor === 'maquina'} label="🚜 Por máquina" onPress={() => setOp((p) => ({ ...p, agruparPor: 'maquina' }))} />
        <Pastilla on={op.agruparPor === 'categoria'} label="🏷️ Por categoría" onPress={() => setOp((p) => ({ ...p, agruparPor: 'categoria' }))} />
        <Pastilla on={op.agruparPor === 'frente'} label="⛏️ Por frente" onPress={() => setOp((p) => ({ ...p, agruparPor: 'frente' }))} />
        <Pastilla on={op.agruparPor === 'encargado'} label="👤 Por encargado" onPress={() => setOp((p) => ({ ...p, agruparPor: 'encargado' }))} />
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

      {/* 🏢 Solo una (o varias) empresas (19-oct-2026, a pedido: «necesito poder
          sacarlo para una sola empresa»). Filtrar SÍ cambia el total: el papel
          sale FILTRADO y, con una sola, el archivo dice CUÁL. */}
      {filas?.length ? (
        <View>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>🏢 SOLO ESTAS EMPRESAS (vacío = todas)</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <Pastilla on={(op.soloEmpresas ?? []).length === 0} label="⬛ Todas" onPress={() => setOp((p) => ({ ...p, soloEmpresas: [] }))} />
            {Array.from(new Set(filas.map((f) => f.empresa))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map((e) => {
              const on = (op.soloEmpresas ?? []).includes(e);
              return (
                <Pastilla key={`emp-${e}`} on={on} label={`${on ? '☑️' : '⬜'} ${e}`} onPress={() =>
                  setOp((p) => {
                    const s = new Set(p.soloEmpresas ?? []);
                    on ? s.delete(e) : s.add(e);
                    return { ...p, soloEmpresas: Array.from(s) };
                  })} />
              );
            })}
          </View>
          {(op.soloEmpresas ?? []).length ? (
            <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>Filtrar SÍ cambia el total: el papel sale FILTRADO y el archivo dice de quién es.</Text>
          ) : null}
        </View>
      ) : null}

      {/* 🏷️ Solo una (o varias) categorías (20-oct-2026, a pedido: «para solo una
          categoría en específico»). Misma regla: filtrar cambia el total → FILTRADO. */}
      {filas?.length ? (
        <View>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>🏷️ SOLO ESTAS CATEGORÍAS (vacío = todas)</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <Pastilla on={(op.soloCategorias ?? []).length === 0} label="⬛ Todas" onPress={() => setOp((p) => ({ ...p, soloCategorias: [] }))} />
            {Array.from(new Set(filas.map((f) => categoriaDe(f)))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map((c) => {
              const on = (op.soloCategorias ?? []).includes(c);
              return (
                <Pastilla key={`cat-${c}`} on={on} label={`${on ? '☑️' : '⬜'} ${c}`} onPress={() =>
                  setOp((p) => {
                    const s = new Set(p.soloCategorias ?? []);
                    on ? s.delete(c) : s.add(c);
                    return { ...p, soloCategorias: Array.from(s) };
                  })} />
              );
            })}
          </View>
        </View>
      ) : null}

      {/* ⛏️ Solo uno (o varios) frentes (20-oct-2026, a pedido: «poder seleccionar
          un frente o varios»). Es el frente VIGENTE al final del rango; «Sin
          frente» también se puede marcar. Filtrar cambia el total → FILTRADO. */}
      {filas?.length ? (
        <View>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>⛏️ SOLO ESTOS FRENTES (vacío = todos)</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <Pastilla on={(op.soloFrentes ?? []).length === 0} label="⬛ Todos" onPress={() => setOp((p) => ({ ...p, soloFrentes: [] }))} />
            {frentesParaPastillas.map((fr) => {
              const on = (op.soloFrentes ?? []).includes(fr);
              return (
                <Pastilla key={`fr-${fr}`} on={on} label={`${on ? '☑️' : '⬜'} ${fr}`} onPress={() =>
                  setOp((p) => {
                    const s = new Set(p.soloFrentes ?? []);
                    on ? s.delete(fr) : s.add(fr);
                    return { ...p, soloFrentes: Array.from(s) };
                  })} />
              );
            })}
          </View>
        </View>
      ) : null}

      {/* 👤 Solo uno (o varios) encargados (22-oct-2026, a pedido: «poder agrupar o
          sacarlo por encargado»). Filtrar cambia el total → FILTRADO. */}
      {filas?.length ? (
        <View>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>👤 SOLO ESTOS ENCARGADOS (vacío = todos)</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <Pastilla on={(op.soloEncargados ?? []).length === 0} label="⬛ Todos" onPress={() => setOp((p) => ({ ...p, soloEncargados: [] }))} />
            {Array.from(new Set(filas.map((f) => encargadoDe(f)))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map((enc) => {
              const on = (op.soloEncargados ?? []).includes(enc);
              return (
                <Pastilla key={`enc-${enc}`} on={on} label={`${on ? '☑️' : '⬜'} ${enc}`} onPress={() =>
                  setOp((p) => {
                    const s = new Set(p.soloEncargados ?? []);
                    on ? s.delete(enc) : s.add(enc);
                    return { ...p, soloEncargados: Array.from(s) };
                  })} />
              );
            })}
          </View>
        </View>
      ) : null}

      {/* ⚙️ Solo uno (o varios) estados: Operativa, En espera, Inoperativa / Parada, Inactiva. Filtrar cambia el total → FILTRADO. */}
      {filas?.length ? (
        <View>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>⚙️ SOLO ESTOS ESTADOS (vacío = todos)</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <Pastilla on={(op.soloEstados ?? []).length === 0} label="⬛ Todos" onPress={() => setOp((p) => ({ ...p, soloEstados: [] }))} />
            {Array.from(new Set(filas.map((f) => String(f.estado ?? 'Operativa')))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map((est) => {
              const on = (op.soloEstados ?? []).includes(est);
              return (
                <Pastilla key={`est-${est}`} on={on} label={`${on ? '☑️' : '⬜'} ${est}`} onPress={() =>
                  setOp((p) => {
                    const s = new Set(p.soloEstados ?? []);
                    on ? s.delete(est) : s.add(est);
                    return { ...p, soloEstados: Array.from(s) };
                  })} />
              );
            })}
          </View>
        </View>
      ) : null}

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
                      <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>{f.code}{f.placa ? ` · ${f.placa}` : ''} <Text style={{ color: colors.muted }}>· {f.empresa}{f.estado ? ` · ${f.estado}` : ''}</Text></Text>
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
          {/* ⚖️🕐 21-oct-2026, a pedido del jefe: maquinaria ÷ toneladas del acarreo
              (global y frente por frente) y el costo de la hora facturada. */}
          <Toggle on={op.costoTonelada} label="⚖️ Costo maquinaria por tonelada (y por frente)" onPress={() => setOp((p) => ({ ...p, costoTonelada: !p.costoTonelada }))} />
          {/* ⚖️ 22-oct-2026, a pedido: la maquinaria de cada frente ÷ TODO el acarreo del rango. */}
          <Toggle on={op.costoTonAcarreoTotal} label="⚖️ Costo por tonelada sobre TODO el acarreo (maquinaria de cada frente ÷ toneladas del rango)" onPress={() => setOp((p) => ({ ...p, costoTonAcarreoTotal: !p.costoTonAcarreoTotal }))} />
          <Toggle on={op.horaPromedio} label="🕐 Hora promedio de maquinaria" onPress={() => setOp((p) => ({ ...p, horaPromedio: !p.horaPromedio }))} />
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
      {/* 📅📈 21-oct-2026, a pedido: «que tenga una tabla operativa diaria con un
          desglose del estilo del de viajes de camiones, y la gráfica también».
          El día por día usa los mismos motores con el rango de un solo día, y
          respeta la decisión 🤖 del rango (si no, no sumaría el mismo total). */}
      <Toggle on={op.tablaDiaria} label="📅 Tabla operativa diaria (día por día, fuente por fuente)" onPress={() => setOp((p) => ({ ...p, tablaDiaria: !p.tablaDiaria }))} />
      {op.tablaDiaria ? (
        <View style={{ paddingLeft: spacing.md }}>
          <Toggle on={!op.sinDiaSemana} label="Día de la semana" onPress={() => setOp((p) => ({ ...p, sinDiaSemana: !p.sinDiaSemana }))} />
          <Toggle on={!op.sinMaquinasDia} label="🚜 Máquinas que facturaron ese día" onPress={() => setOp((p) => ({ ...p, sinMaquinasDia: !p.sinMaquinasDia }))} />
          <Toggle on={!op.sinToneladasDia} label="⚖️ Toneladas del acarreo ese día" onPress={() => setOp((p) => ({ ...p, sinToneladasDia: !p.sinToneladasDia }))} />
          <Toggle on={!op.sinCostoTonDia} label="$/t del día" onPress={() => setOp((p) => ({ ...p, sinCostoTonDia: !p.sinCostoTonDia }))} />
        </View>
      ) : null}
      <Toggle on={op.graficoDiario} label="📈 Gráfico del día por día (barras = lo facturado, línea = toneladas)" ayuda={`Con más de ${MAX_DIAS_GRAFICO_CONSOLIDADO} días no sale: serían barras ilegibles.`} onPress={() => setOp((p) => ({ ...p, graficoDiario: !p.graficoDiario }))} />
      {/* 🤖 21-oct-2026, decisión del jefe: en ESTE papel, jornada y horómetro son
          uno u otro por máquina — manda el horómetro. Apagarlo vuelve a sumar los
          dos (y lo dice el nombre del archivo, porque cambia la plata). */}
      <Toggle on={op.seleccionAutomatica} label="🤖 Selección automática (⚖️ el peso manda en el camión; ⚙️ el horómetro sobre la jornada)" onPress={() => setOp((p) => ({ ...p, seleccionAutomatica: !p.seleccionAutomatica }))} />
      {/* 🚛⚖️🕐 22-oct-2026, a pedido: «que si quiero que esos camiones que tienen
          peso los quiero en jornada o peso, pueda seleccionar todos o uno por
          uno». Solo con la selección automática y el peso sumando (si no, nada
          se descarta y no hay qué elegir). */}
      {op.seleccionAutomatica && op.fuentes.peso === 'suma' && camionesPeso.length ? (
        <View style={{ paddingLeft: spacing.md }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
            🚛 CAMIONES CON PESO: ¿POR PESO O POR JORNADA? ({porJornadaSel.size ? `${porJornadaSel.size} por jornada` : 'todos por peso'})
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <Pastilla on={porJornadaSel.size === 0} label="⚖️ Todos por peso" onPress={() => setOp((p) => ({ ...p, camionesPorJornada: [] }))} />
            <Pastilla on={porJornadaSel.size === camionesPeso.length} label="🕐 Todos por jornada" onPress={() => setOp((p) => ({ ...p, camionesPorJornada: camionesPeso.map((f) => f.id) }))} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            {camionesPeso.map((f) => {
              const jor = porJornadaSel.has(f.id);
              return (
                <Pastilla key={`cpj-${f.id}`} on={jor} label={`${jor ? '🕐' : '⚖️'} ${f.code}${f.placa ? ` · ${f.placa}` : ''}`} onPress={() =>
                  setOp((p) => {
                    const s = new Set(p.camionesPorJornada ?? []);
                    jor ? s.delete(f.id) : s.add(f.id);
                    return { ...p, camionesPorJornada: Array.from(s) };
                  })} />
              );
            })}
          </View>
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>
            Toca un camión para pasarlo entre ⚖️ peso y 🕐 jornada. Por jornada: su peso y sus viajes no se suman. Cambia la plata: el nombre del archivo lo dice.
          </Text>
        </View>
      ) : null}
      {/* 🤖 21-oct-2026, a pedido: «que tome lo del horómetro pero que no me salga
          esa información si no quiero» — apaga el cuadro «Mandó el horómetro» y la
          cola de «fuera del cuadro: … sin toneladas». La regla sigue aplicando. */}
      {op.seleccionAutomatica ? (
        <Toggle on={op.desgloseAutomatico} label="🧾 El desglose de lo descartado (cuadro «Mandó el horómetro» y «sin toneladas»)" onPress={() => setOp((p) => ({ ...p, desgloseAutomatico: !p.desgloseAutomatico }))} />
      ) : null}
      {/* ⚠️🔁 22-oct-2026, a pedido («ese cambio tiene sentido y debería ser
          así, correcto?»): un día sin horómetro no se nota — la jornada de
          TODO el rango se descarta por la regla uno-u-otro, y ese día
          específico queda en $0 por los dos lados. Avisa (⚠️, nace prendido)
          y, si se quiere, lo rellena solo con la jornada de ESE día (🔁, nace
          apagado — la corrección de la casa sigue siendo 🔁 Cambio de
          horómetro, a mano y con motivo). */}
      {op.seleccionAutomatica ? (
        <>
          <Toggle on={op.avisoHuecosHorometro} label="⚠️ Avisar días sin horómetro que la jornada sí cubriría" onPress={() => setOp((p) => ({ ...p, avisoHuecosHorometro: !p.avisoHuecosHorometro }))} />
          <Toggle on={op.rellenoAutomaticoDia} label="🔁 Rellenar esos días automáticamente con su jornada" onPress={() => setOp((p) => ({ ...p, rellenoAutomaticoDia: !p.rellenoAutomaticoDia }))} />
        </>
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
