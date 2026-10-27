// 🏭 CENTRO DE OPERACIONES — 📋 REGISTROS (24-oct-2026).
//
// Buscar, filtrar, corregir y exportar los renglones del sitio:
//   · rango con pastillas (hoy / semana desde el lunes / mes) o desde–hasta con
//     el calendario; la fecha es la de JORNADA (7am a 7am);
//   · filtros por tipo, estado, unidad, transportista, origen, destino y material,
//     más un buscador;
//   · totales con `totalesDe` y `textoViajes` (los «(+N pendiente)» salen igual
//     que en los papeles);
//   · ✏️ abre ✍️ Cargar con el renglón (Escritura o Full); 🗑️ solo Full, con
//     confirmación; selección múltiple + «Vincular a unidad» (la fase 2 solo
//     pagará renglones vinculados);
//   · 📥 Excel con `buildXlsx` (en web se descarga).
//
// ⭐ UNA SOLA BASE: los renglones del período (`base`) van IGUALES a
//    `filtrarMovimientos`, a `opcionesUnidad` y a todo lo demás. De qué unidad es
//    cada renglón lo decide `unidadDeLosRenglones` dentro de la librería: esta
//    pantalla no tiene regla propia, así que el listado y el corte por unidad no
//    pueden contradecirse.
//
// Sin tiempo real: carga al entrar, al deslizar, al cambiar el rango y con 🔄.
//
// ⭐ REVISIÓN FINAL (25-oct-2026):
//   · B-I3: lo cargado guarda DE QUÉ RANGO es (`baseLista`). Mientras no sea el pedido (tocó
//     «Este mes» y todavía está lo de hoy) o si la carga falló, la lista dice «Cargando…» (o
//     el error), los totales se apagan y el 📥 Excel espera: antes bajaba «… 01 a 31.xlsx»
//     solo con lo de hoy;
//   · A#1: lo anotado en el 📅 Parte diario se corrige allá (`dondeSeCorrige`);
//   · B-M2: «← Volver a los registros» con algo sin guardar pregunta antes de tirarlo.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { Plegable } from '../Plegable';
import { DateField } from '../DateField';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import { cmpText, norm } from '../../lib/text';
import { buildXlsx } from '../../lib/xlsx';
import { cmpMovimientoJornada, filtrarMovimientos, textoViajes, totalesDe } from '../../lib/centroOperaciones';
import type { EstadoMov, FiltrosCop, Movimiento, Sitio, TipoMov, Unidad } from '../../lib/centroOperaciones';
import {
  ESTADOS_MOV,
  TIPOS_FILTRO,
  RangoRapido,
  baseLista,
  bloquesDe,
  dmy,
  filasExcel,
  mensajeVincular,
  normalizarPlaca,
  opcionesTexto,
  opcionesUnidad,
  rangoRapido,
  resumenVincular,
  secuenciaDePedidos,
  textoBloques,
  textoDeUnidad,
} from '../../lib/centroOperacionesCarga';
import type { BaseDelRango } from '../../lib/centroOperacionesCarga';
import { borrarMovimiento, cargarMovimientos, cargarUnidades, vincularUnidad } from '../../lib/centroOperacionesDb';
import { CargarTab, FilaMovimiento } from './CargarTab';
import { dondeSeCorrige } from './salidasParteDiario';

type Props = { sitio: Sitio; nivel: PermLevel };

/** Sin base lista (otro rango o error): ninguna fila. Fuera del componente: misma referencia siempre. */
const SIN_RENGLONES: Movimiento[] = [];

/** Renglones que se pintan por tanda (un mes puede traer cientos). */
const TANDA = 100;

const fmt = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

/** Descarga bytes como archivo en web (copia de la de InventarioScreen). */
function downloadBytes(filename: string, data: Uint8Array | string, mime: string) {
  if (Platform.OS !== 'web') return;
  const g: any = globalThis as any;
  const parts = typeof data === 'string' ? ['﻿' + data] : [data];
  const blob = new g.Blob(parts, { type: mime });
  const url = g.URL.createObjectURL(blob);
  const a = g.document.createElement('a');
  a.href = url; a.download = filename;
  g.document.body.appendChild(a); a.click(); a.remove();
  g.URL.revokeObjectURL(url);
}

/** Agrega o quita un valor de una lista de filtro. */
function alternar<T>(lista: T[] | undefined, v: T): T[] {
  const l = lista ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
}

type CampoTexto = 'transportistas' | 'origenes' | 'destinos' | 'materiales';
const CAMPOS_TEXTO: { key: CampoTexto; campo: 'transportista' | 'origen' | 'destino' | 'material'; label: string }[] = [
  { key: 'transportistas', campo: 'transportista', label: 'Transportista' },
  { key: 'origenes', campo: 'origen', label: 'Origen' },
  { key: 'destinos', campo: 'destino', label: 'Destino' },
  { key: 'materiales', campo: 'material', label: 'Material' },
];

export function RegistrosTab({ sitio, nivel }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeEditar = levelMeets(nivel, 'escritura');
  const esFull = nivel === 'full';

  const [rapido, setRapido] = useState<RangoRapido | 'otro'>('hoy');
  const [rango, setRango] = useState(() => rangoRapido('hoy', caracasBusinessToday()));
  /** Lo cargado y DE QUÉ RANGO es (B-I3): solo sirve si es el rango pedido (`baseLista`). */
  const [delRango, setDelRango] = useState<BaseDelRango | null>(null);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtros, setFiltros] = useState<FiltrosCop>({});
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(TANDA);

  const [editando, setEditando] = useState<Movimiento | null>(null);
  /** ¿El ✏️ abierto tiene algo escrito sin guardar? Lo dice CargarTab (B-M2). */
  const edicionSucia = useRef(false);
  const marcarEdicion = useCallback((sucia: boolean) => { edicionSucia.current = sucia; }, []);
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [vinculando, setVinculando] = useState(false);
  const [buscaUnidad, setBuscaUnidad] = useState('');
  const [guardandoVinculo, setGuardandoVinculo] = useState(false);

  // ── Carga: los renglones del período y la flota ──
  // ⭐ Una respuesta vieja (otro rango, otra recarga) no pisa a la nueva.
  const pedidos = useRef(secuenciaDePedidos()).current;
  const recargar = useCallback(async () => {
    const n = pedidos.nuevo();
    const { desde, hasta } = rango;
    setCargando(true);
    setError(null);
    try {
      const [movs, flota] = await Promise.all([cargarMovimientos(sitio.id, desde, hasta), cargarUnidades(sitio.id)]);
      if (!pedidos.vigente(n)) return;
      // En el orden de la JORNADA (así sale el Excel); la lista lo pinta al revés.
      setDelRango({ desde, hasta, movs: [...movs].sort(cmpMovimientoJornada) });
      setUnidades(flota);
      // Lo seleccionado que ya no está en el período deja de estarlo.
      setSeleccion((s) => s.filter((id) => movs.some((m) => m.id === id)));
    } catch (e: any) {
      if (!pedidos.vigente(n)) return;
      const msg = e?.message || 'No se pudieron cargar los registros.';
      setError(msg);
      toast.error(msg);
    } finally {
      if (pedidos.vigente(n)) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, rango.desde, rango.hasta]);
  // ⭐ Al entrar, al deslizar (la pantalla recrea el objeto `sitio`: por eso la carga
  //    depende de él y no de `sitio.id`) y al cambiar el rango. Spec §8.
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));

  const elegirRapido = (q: RangoRapido) => {
    setRapido(q);
    setRango(rangoRapido(q, caracasBusinessToday()));
    setLimite(TANDA);
  };
  const cambiarDesde = (d: string) => { setRapido('otro'); setRango((r) => ({ desde: d, hasta: r.hasta < d ? d : r.hasta })); setLimite(TANDA); };
  const cambiarHasta = (h: string) => { setRapido('otro'); setRango((r) => ({ desde: r.desde > h ? h : r.desde, hasta: h })); setLimite(TANDA); };

  // ── La base: SOLO la del rango pedido (B-I3). Mientras no lo sea, o si la carga falló,
  //    no hay filas ni totales ni Excel: nada de otro rango bajo el título de este. ──
  const listo = baseLista(delRango, rango, error);
  const base = listo && delRango ? delRango.movs : SIN_RENGLONES;

  // ── Filtrar (la MISMA base para todo) ──
  const filtrados = useMemo(
    () => filtrarMovimientos(base, rango, { ...filtros, texto: busca }),
    [base, rango, filtros, busca],
  );
  const totales = useMemo(() => totalesDe(filtrados), [filtrados]);
  // Por tipo, también la 🧱 Producción (lote 5 A4): con sus piezas, no «0 viajes».
  const porTipo = useMemo(
    () => TIPOS_FILTRO.map((t) => ({ t, tot: totalesDe(filtrados.filter((m) => m.tipo === t.key)), bloques: bloquesDe(filtrados.filter((m) => m.tipo === t.key)) }))
      .filter((x) => x.tot.renglones > 0),
    [filtrados],
  );
  const opsUnidad = useMemo(() => opcionesUnidad(base, unidades), [base, unidades]);
  const opsTexto = useMemo(() => {
    const r = {} as Record<CampoTexto, string[]>;
    for (const c of CAMPOS_TEXTO) r[c.key] = opcionesTexto(base, c.campo);
    return r;
  }, [base]);

  const cuantosFiltros = (filtros.tipos?.length ?? 0) + (filtros.estados?.length ?? 0) + (filtros.unidadIds?.length ?? 0)
    + CAMPOS_TEXTO.reduce((s, c) => s + (filtros[c.key]?.length ?? 0), 0);
  const filtrado = cuantosFiltros > 0 || !!busca.trim();

  // Lo más reciente arriba (la base viene en el orden de la jornada: acá al revés, así la
  // madrugada queda encima de las 23:00); se pinta por tandas.
  const visibles = useMemo(() => [...filtrados].reverse().slice(0, limite), [filtrados, limite]);

  // ── Acciones ──
  /** ✏️ abre ✍️ Cargar con el renglón. Lo anotado en el 📅 Parte diario no (una producción
   *  o una venta de bloques —lote 5 A4— o una salida con vehículo —revisión final A#1—):
   *  se corrige allá, en su bloque (la fila lo dice en vez del ✏️). */
  const editar = (m: Movimiento) => {
    if (dondeSeCorrige(m)) return;
    edicionSucia.current = false;
    setEditando(m);
  };

  /** «← Volver a los registros»: con algo escrito sin guardar, pregunta antes (B-M2). */
  const volver = async () => {
    if (edicionSucia.current && !(await confirm({
      title: 'Descartar lo escrito',
      message: 'Lo que cambiaste en este renglón no se ha guardado. ¿Descartarlo?',
      confirmText: 'Descartar',
      cancelText: 'Seguir aquí',
      danger: true,
    }))) return;
    edicionSucia.current = false;
    setEditando(null);
  };

  const borrar = async (m: Movimiento) => {
    if (nivel !== 'full') return;
    const ok = await confirm({
      title: 'Borrar renglón',
      message: `¿Borrar el renglón de ${(m.unidadTexto || m.placa || 'sin unidad').trim()} del ${dmy(m.fecha)}? No se puede deshacer.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    try {
      await borrarMovimiento(m.id);
      toast.success('Renglón borrado.');
      recargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se borró el renglón.');
      // Si ya no existía, que la lista lo diga (si no, el renglón fantasma sigue ahí).
      recargar();
    }
  };

  const vincular = async (u: Unidad) => {
    if (!puedeEditar || !seleccion.length || guardandoVinculo) return;
    // Con la base de otro rango (o sin base), los avisos de abajo contarían mal (B-I3).
    if (!listo) { toast.info('Espera a que carguen los registros del rango.'); return; }
    // ⭐ Antes de confirmar se dice cuántos YA eran de otra unidad (se les cambia el
    //    vínculo) y cuántos no se ven con los filtros de ahora.
    const r = resumenVincular(seleccion, base, filtrados, u.id);
    const ok = await confirm({
      title: 'Vincular a unidad',
      message: mensajeVincular(r, `${textoDeUnidad(u)}${u.placa ? ` (${u.placa})` : ''}`),
      confirmText: 'Vincular',
      danger: r.deOtraUnidad > 0 || r.ocultos > 0,
    });
    if (!ok) return;
    setGuardandoVinculo(true);
    const pedidos = seleccion.length;
    try {
      const n = await vincularUnidad(seleccion, u.id);
      if (n < pedidos) {
        // Entraron menos de los pedidos: otro equipo borró alguno, o la base no dejó.
        toast.info(`${n} de ${pedidos} renglones vinculados a ${textoDeUnidad(u)}: los demás no (puede que alguien los haya borrado). Revisa la lista.`);
      } else {
        toast.success(`${n} ${n === 1 ? 'renglón vinculado' : 'renglones vinculados'} a ${textoDeUnidad(u)}.`);
      }
      setSeleccion([]);
      setVinculando(false);
      setSeleccionando(false);
      recargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se guardó el vínculo.');
      // Puede haber quedado a medias (lotes): que la lista muestre el 🔗 de los que sí.
      recargar();
    } finally {
      setGuardandoVinculo(false);
    }
  };

  const exportar = () => {
    if (Platform.OS !== 'web') {
      toast.info('El Excel se descarga desde la computadora (la versión web).');
      return;
    }
    // ⭐ B-I3: solo con la base del rango pedido, ya cargada (nunca la de otro rango).
    if (!listo || cargando) {
      toast.info(error ? 'No se pudieron cargar los registros del rango: toca 🔄 Actualizar y vuelve a intentar.' : 'Espera a que carguen los registros del rango.');
      return;
    }
    if (!filtrados.length) { toast.info('No hay renglones que exportar en este rango.'); return; }
    // Los filtros no van DENTRO del archivo: van en su nombre.
    const nombre = `Registros ${sitio.nombre} ${rango.desde} a ${rango.hasta}${filtrado ? ' (filtrado)' : ''}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
    downloadBytes(nombre, buildXlsx(filasExcel(filtrados), 'Registros'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  // ── Estilos ──
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const pastilla = (on: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface,
  });
  const textoPastilla = (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const etiqueta = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs };
  const boton = (fondo: string) => ({ backgroundColor: fondo, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md });

  /** Una fila de pastillas para un filtro de varios valores. Lo elegido que ya no
   *  aparece en el período se sigue mostrando, para poder quitarlo. */
  const filaChips = (opciones: { clave: string; etiqueta: string }[], elegidos: string[] | undefined, onToggle: (clave: string) => void) => {
    const todas = [...opciones];
    for (const e of elegidos ?? []) if (!todas.some((o) => o.clave === e)) todas.push({ clave: e, etiqueta: e });
    if (!todas.length) return <Text style={{ color: colors.muted, fontSize: 11 }}>Nada en este período.</Text>;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
        {todas.map((o) => {
          const on = (elegidos ?? []).includes(o.clave);
          return (
            <TouchableOpacity key={o.clave} onPress={() => onToggle(o.clave)} style={pastilla(on)}>
              <Text style={textoPastilla(on)}>{o.etiqueta}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ── ✏️ Editando: la tarjeta de Cargar con el renglón, en lugar de la lista ──
  if (editando) {
    return (
      <View style={{ gap: spacing.sm }}>
        <TouchableOpacity onPress={volver}>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>← Volver a los registros</Text>
        </TouchableOpacity>
        <CargarTab
          key={editando.id}
          sitio={sitio}
          nivel={nivel}
          movimientoAEditar={editando}
          alSinGuardar={marcarEdicion}
          onTerminado={(guardado) => { edicionSucia.current = false; setEditando(null); if (guardado) recargar(); }}
        />
      </View>
    );
  }

  const activas = unidades.filter((u) => u.activo).sort((a, b) => cmpText(textoDeUnidad(a), textoDeUnidad(b)));
  const qUnidad = norm(buscaUnidad.trim());
  const pUnidad = normalizarPlaca(buscaUnidad);
  const unidadesVincular = activas.filter((u) => !qUnidad
    || norm([u.codigo, u.descripcion, u.placa, u.dueno].join(' ')).includes(qUnidad)
    || (!!pUnidad && normalizarPlaca(u.placa).includes(pUnidad)));

  return (
    <View style={{ gap: spacing.sm }}>
      {/* ── RANGO ── */}
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes']] as [RangoRapido, string][]).map(([q, label]) => (
            <TouchableOpacity key={q} onPress={() => elegirRapido(q)} style={pastilla(rapido === q)}>
              <Text style={textoPastilla(rapido === q)}>{label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={recargar} style={pastilla(false)}>
            <Text style={textoPastilla(false)}>🔄 Actualizar</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={etiqueta}>DESDE</Text>
            <View style={{ marginTop: 4 }}><DateField value={rango.desde} onChange={cambiarDesde} /></View>
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={etiqueta}>HASTA</Text>
            <View style={{ marginTop: 4 }}><DateField value={rango.hasta} onChange={cambiarHasta} minISO={rango.desde} /></View>
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 11 }}>Fechas de jornada: cada día va de 7am a 7am.</Text>
      </Card>

      {/* ── BUSCADOR Y FILTROS ── */}
      <TextInput value={busca} onChangeText={(v) => { setBusca(v); setLimite(TANDA); }} placeholder="🔎 Buscar unidad, placa, transportista, origen, destino, material u observación…" placeholderTextColor={colors.muted} style={input} />
      <Plegable titulo="🎛️ Filtros" resumen={cuantosFiltros ? `${cuantosFiltros} activo(s)` : 'Sin filtros'}>
        <Text style={etiqueta}>TIPO</Text>
        {filaChips(TIPOS_FILTRO.map((t) => ({ clave: t.key, etiqueta: `${t.ico} ${t.label}` })), filtros.tipos,
          (k) => setFiltros((f) => ({ ...f, tipos: alternar(f.tipos, k as TipoMov) })))}
        <Text style={etiqueta}>ESTADO</Text>
        {filaChips(ESTADOS_MOV.map((e) => ({ clave: e.key, etiqueta: `${e.ico} ${e.label}` })), filtros.estados,
          (k) => setFiltros((f) => ({ ...f, estados: alternar(f.estados, k as EstadoMov) })))}
        <Text style={etiqueta}>UNIDAD</Text>
        {filaChips(opsUnidad, filtros.unidadIds, (k) => setFiltros((f) => ({ ...f, unidadIds: alternar(f.unidadIds, k) })))}
        {CAMPOS_TEXTO.map((c) => (
          <View key={c.key}>
            <Text style={etiqueta}>{c.label.toUpperCase()}</Text>
            {filaChips(opsTexto[c.key].map((t) => ({ clave: t, etiqueta: t })), filtros[c.key],
              (k) => setFiltros((f) => ({ ...f, [c.key]: alternar(f[c.key], k) })))}
          </View>
        ))}
        {cuantosFiltros ? (
          <TouchableOpacity onPress={() => setFiltros({})} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>✕ Quitar los filtros</Text>
          </TouchableOpacity>
        ) : null}
      </Plegable>

      {/* ── TOTALES ── */}
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {/* B-I3: sin la base del rango pedido, los totales se apagan («—»): no son de este rango. */}
          {[
            ['🚛 Viajes', listo ? textoViajes(totales) : '—'],
            ['⚖️ Toneladas', listo ? fmt(totales.toneladas) : '—'],
            ['📦 m³', listo ? fmt(totales.m3) : '—'],
            ['📊 t/viaje (entradas)', !listo || totales.promedioTonViaje === null ? '—' : fmt(totales.promedioTonViaje)],
            ['🧾 Renglones', listo ? fmt(totales.renglones) : '—'],
          ].map(([t, v]) => (
            <View key={t} style={{ flex: 1, minWidth: 110, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>{t}</Text>
              <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 16 }}>{v}</Text>
            </View>
          ))}
        </View>
        {porTipo.length > 1 ? porTipo.map(({ t, tot, bloques }) => (
          <Text key={t.key} style={{ color: colors.muted, fontSize: 12 }}>
            {t.ico} {t.label}: {t.key === 'produccion'
              ? `${fmt(tot.renglones)} ${tot.renglones === 1 ? 'renglón' : 'renglones'} · ${textoBloques(bloques)}`
              : `${textoViajes(tot)} viajes · ${fmt(tot.toneladas)} t · ${fmt(tot.m3)} m³${bloques > 0 ? ` · ${textoBloques(bloques)}` : ''}`}
          </Text>
        )) : null}
      </Card>

      {/* ── ACCIONES ── */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <TouchableOpacity onPress={exportar} style={boton(colors.primary)}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>📥 Excel</Text>
        </TouchableOpacity>
        {puedeEditar ? (
          <TouchableOpacity
            onPress={() => { setSeleccionando((s) => !s); setSeleccion([]); setVinculando(false); }}
            style={boton(seleccionando ? colors.brand : colors.surfaceAlt)}
          >
            <Text style={{ color: seleccionando ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>
              {seleccionando ? '✕ Terminar selección' : '☑️ Seleccionar'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {seleccionando && puedeEditar ? (
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{seleccion.length} seleccionado(s)</Text>
            <TouchableOpacity onPress={() => setSeleccion(filtrados.map((m) => m.id))}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Todo lo filtrado ({filtrados.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSeleccion([])}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Ninguno</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => setVinculando((v) => !v)}
            disabled={!seleccion.length}
            style={[boton(colors.accent), { opacity: seleccion.length ? 1 : 0.5, alignSelf: 'flex-start', marginTop: spacing.xs }]}
          >
            <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 13 }}>🔗 Vincular a unidad ({seleccion.length})</Text>
          </TouchableOpacity>
          {vinculando && seleccion.length ? (
            <View style={{ marginTop: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 11 }}>Elige la unidad de la flota (activas). El texto escrito de cada renglón no cambia.</Text>
              <TextInput value={buscaUnidad} onChangeText={setBuscaUnidad} placeholder="Buscar por código, placa o dueño" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
              {unidadesVincular.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                  {unidadesVincular.slice(0, 30).map((u) => (
                    <TouchableOpacity key={u.id} onPress={() => vincular(u)} disabled={guardandoVinculo} style={pastilla(false)}>
                      <Text style={textoPastilla(false)}>🚛 {textoDeUnidad(u)}{u.placa && norm(u.placa) !== norm(textoDeUnidad(u)) ? ` · ${u.placa}` : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                  {activas.length ? 'Ninguna unidad activa coincide.' : 'La flota del sitio está vacía: agrégala en 🚛 Flota.'}
                </Text>
              )}
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* ── LOS RENGLONES ── */}
      <Card>
        {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error} Toca 🔄 Actualizar.</Text> : null}
        {!listo ? (
          // B-I3: lo de otro rango no se muestra mientras carga este (ni si la carga falló).
          error ? null : <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
        ) : !filtrados.length ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {base.length ? 'Ningún renglón cumple los filtros.' : `Sin registros del ${dmy(rango.desde)} al ${dmy(rango.hasta)}.`}
          </Text>
        ) : (
          <>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {filtrados.length} {filtrados.length === 1 ? 'renglón' : 'renglones'} del {dmy(rango.desde)} al {dmy(rango.hasta)} · lo más reciente arriba
            </Text>
            {visibles.map((m) => (
              <FilaMovimiento
                key={m.id}
                m={m}
                mostrarFecha
                seleccionado={seleccion.includes(m.id)}
                onSeleccionar={seleccionando && puedeEditar ? () => setSeleccion((s) => alternar(s, m.id)) : undefined}
                onEditar={levelMeets(nivel, 'escritura') ? () => editar(m) : undefined}
                onBorrar={esFull ? () => borrar(m) : undefined}
              />
            ))}
            {filtrados.length > visibles.length ? (
              <TouchableOpacity onPress={() => setLimite((l) => l + TANDA)} style={{ alignSelf: 'center', marginTop: spacing.sm }}>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>Mostrar {Math.min(TANDA, filtrados.length - visibles.length)} más ({filtrados.length - visibles.length} sin mostrar)</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </Card>
    </View>
  );
}

export default RegistrosTab;
