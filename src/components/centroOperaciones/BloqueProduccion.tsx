// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO · 2) ⚙️ PRODUCCIÓN DE TRITURACIÓN (06-nov-2026).
//
// Pedido de la encargada del CDT: por cada equipo de trituración (Trituradora 1, la 2 de
// Ecosocialismo y el cono, que se activan en ⚙️ Ajustes cuando estén en sitio) ella anota
// las HORAS que trabajó y las TONELADAS POR HORA que ve (dependen de la abertura de la
// mandíbula): horas × t/h = toneladas. Dos modos: 🪨 Triturado mixto (un producto) y
// 🧪 Cribado (sale clasificado en los % que ella ve: polvillo, arrocillo, estéril…). Un
// equipo puede tener varias líneas en el día (6 h de mixto y 4 de cribado, o dos t/h
// distintas si movió la mandíbula), sin pasar de 24 h.
//
// ⭐ NO TOCA LAS SALIDAS: solo registra y reporta. Debajo se compara, solo para informar,
//    lo producido con lo que salió hoy en agregados (el cernidor también produce y no se mide).
// ⭐ La lógica (leer horas «10:30», t/h, % que suman 100, reparto exacto, tope de 24 h,
//    m³ con el factor del material) vive en `lib/centroOperacionesProduccion.ts` (pura y probada).
// ⭐ Permisos (la RLS manda): Lectura ve; Escritura y Full anotan y corrigen; 🗑️ solo Full.
// ⭐ Si la base todavía no tiene las tablas, lo dice en vez de fallar callado.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import type { ItemLista, Movimiento, Sitio } from '../../lib/centroOperaciones';
import { dmy, secuenciaDePedidos } from '../../lib/centroOperacionesCarga';
import {
  FALTA_TABLA_PRODUCCION, borrarProduccion, cargarEquiposTrituracion, cargarProduccion, cargarUltimosCribados, guardarProduccion,
} from '../../lib/centroOperacionesDb';
import {
  MODOS, NOTA_CERNIDOR, PRODUCTO_MIXTO, desglosar, equiposDelDia, factorDeProducto, fmtN, fmtT, formCambio, formDeProduccion,
  formVacio, horasDelEquipo, leerHoras, producidoVsSalido, resumenBloqueProduccion, revisarForm, textoHoras, textoLinea,
  totalesProduccion, ultimoRepartoCribado,
} from '../../lib/centroOperacionesProduccion';
import type { EquipoTrituracion, FormProduccion, Produccion } from '../../lib/centroOperacionesProduccion';
import { pideloAQuienAdministra } from './pantallaParteDiario';

type Props = {
  sitio: Sitio;
  nivel: PermLevel;
  /** La jornada elegida arriba, «YYYY-MM-DD». */
  fecha: string;
  /** Las listas del sitio (los factores t/m³ de los materiales): las carga el Parte diario. */
  listas: ItemLista[];
  /** Lo anotado hoy en el sitio (para comparar, solo informativo, con las salidas de agregados). */
  movimientosDelDia: Movimiento[];
  /** Lo que dice plegado el encabezado del bloque. */
  alResumen?: (r: { texto: string; alerta: boolean }) => void;
  alSinGuardar?: (sinGuardar: boolean) => void;
};

/** El formulario abierto: de qué equipo, si corrige una línea, en qué jornada se guarda y cómo arrancó. */
type Abierto = { equipo: EquipoTrituracion; editando: Produccion | null; fecha: string; f: FormProduccion; base: FormProduccion };

export function BloqueProduccion({ sitio, nivel, fecha, listas, movimientosDelDia, alResumen, alSinGuardar }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeAnotar = levelMeets(nivel, 'escritura');
  const esFull = levelMeets(nivel, 'full');

  const [equipos, setEquipos] = useState<EquipoTrituracion[] | null>(null);
  /** Lo del día y de CUÁL jornada es (mientras llega otra, no se muestra bajo su título). */
  const [delDia, setDelDia] = useState<{ fecha: string; prods: Produccion[] } | null>(null);
  const [cribados, setCribados] = useState<Produccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pedidos = useRef(secuenciaDePedidos()).current;

  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const [intento, setIntento] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const enVuelo = useRef(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  // ── Cargar ──
  const cargar = useCallback(async () => {
    const n = pedidos.nuevo();
    setError(null);
    try {
      const [eqs, prods, crib] = await Promise.all([
        cargarEquiposTrituracion(sitio.id),
        cargarProduccion(sitio.id, fecha, fecha),
        cargarUltimosCribados(sitio.id).catch(() => [] as Produccion[]), // solo propone %: si falla, se arranca con los de siempre
      ]);
      if (!pedidos.vigente(n)) return;
      setEquipos(eqs);
      setDelDia({ fecha, prods });
      setCribados(crib);
    } catch (e: any) {
      if (!pedidos.vigente(n)) return;
      setError(e?.message || 'No se pudo cargar la producción de trituración.');
    } finally {
      if (pedidos.vigente(n)) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, fecha]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const prods = delDia && delDia.fecha === fecha ? delDia.prods : [];
  const listos = !!delDia && delDia.fecha === fecha && equipos !== null;
  const visibles = useMemo(() => equiposDelDia(equipos ?? [], prods, fecha), [equipos, prods, fecha]);
  const faltaTabla = error === FALTA_TABLA_PRODUCCION;

  // ── Al cambiar de jornada: un formulario sin cambios se cierra; uno con cambios se queda (dice su jornada) ──
  useEffect(() => {
    setAbierto((a) => (a && a.fecha !== fecha && !formCambio(a.f, a.base) ? null : a));
  }, [fecha]);

  // ── Lo que dice plegado y el «✏️ sin guardar» ──
  const sucio = !!abierto && formCambio(abierto.f, abierto.base);
  useEffect(() => { alSinGuardar?.(sucio); }, [sucio, alSinGuardar]);
  useEffect(() => {
    if (!alResumen) return;
    if (error) alResumen({ texto: faltaTabla ? '⚠️ Falta activarla en la base' : '⚠️ No se pudo cargar', alerta: true });
    else if (!listos) alResumen({ texto: 'Cargando…', alerta: false });
    else if (!visibles.length) alResumen({ texto: 'Sin equipos activos (se activan en ⚙️ Ajustes)', alerta: false });
    else alResumen({ texto: resumenBloqueProduccion(prods, fecha), alerta: false });
  }, [alResumen, error, faltaTabla, listos, visibles.length, prods, fecha]);

  // ── El formulario ──
  const pedirDescartar = async (): Promise<boolean> => {
    if (!sucio) return true;
    return confirm({ title: 'Hay algo escrito sin guardar', message: 'La producción que estabas escribiendo no se ha guardado. ¿Descartarla?', confirmText: 'Descartar', danger: true });
  };
  const abrirNuevo = async (eq: EquipoTrituracion) => {
    if (!(await pedirDescartar())) return;
    const f = formVacio(eq, ultimoRepartoCribado(cribados, eq.id));
    setAbierto({ equipo: eq, editando: null, fecha, f, base: f });
    setIntento(false); setErrorGuardar(null);
  };
  const abrirEdicion = async (eq: EquipoTrituracion, p: Produccion) => {
    if (abierto?.editando?.id === p.id) return;
    if (!(await pedirDescartar())) return;
    const f = formDeProduccion(p);
    setAbierto({ equipo: eq, editando: p, fecha: p.fecha, f, base: f });
    setIntento(false); setErrorGuardar(null);
  };
  const cerrar = async () => {
    if (!(await pedirDescartar())) return;
    setAbierto(null); setIntento(false); setErrorGuardar(null);
  };
  const cambiar = (patch: Partial<FormProduccion>) => setAbierto((a) => (a ? { ...a, f: { ...a.f, ...patch } } : a));
  const cambiarFila = (i: number, patch: Partial<{ producto: string; pct: string }>) =>
    setAbierto((a) => (a ? { ...a, f: { ...a.f, reparto: a.f.reparto.map((r, j) => (j === i ? { ...r, ...patch } : r)) } } : a));
  const quitarFila = (i: number) => setAbierto((a) => (a ? { ...a, f: { ...a.f, reparto: a.f.reparto.filter((_, j) => j !== i) } } : a));
  const agregarFila = () => setAbierto((a) => (a ? { ...a, f: { ...a.f, reparto: [...a.f.reparto, { producto: '', pct: '' }] } } : a));

  // Las horas que el equipo YA tiene en la jornada de este formulario (sin la línea que se corrige).
  // (En otra jornada no se ven sus líneas: ahí el tope lo revisa la base y lo dice al guardar.)
  const horasOtras = abierto && abierto.fecha === fecha ? horasDelEquipo(prods, abierto.equipo.id, abierto.fecha, abierto.editando?.id) : 0;
  const rev = abierto ? revisarForm(abierto.f, listas, horasOtras, abierto.equipo.nombre) : null;

  const guardar = async () => {
    if (!abierto || !rev || enVuelo.current) return;
    setIntento(true);
    if (!rev.ok || !rev.datos) return;
    enVuelo.current = true; setGuardando(true); setErrorGuardar(null);
    try {
      await guardarProduccion(abierto.editando?.id ?? null, { sitioId: sitio.id, fecha: abierto.fecha, equipo: abierto.equipo, ...rev.datos });
      toast.success(abierto.editando ? 'Corrección guardada.' : `Producción anotada: ${fmtT(rev.toneladas ?? 0)} t.`);
      setAbierto(null); setIntento(false);
    } catch (e: any) {
      // Lo escrito se queda en el formulario para intentar de nuevo.
      setErrorGuardar(e?.message || 'No se guardó la producción.');
    } finally {
      enVuelo.current = false; setGuardando(false);
      cargar(); // por si sí entró (o cambió algo mientras tanto)
    }
  };

  const borrar = async (p: Produccion) => {
    if (!esFull || enVuelo.current) return;
    const si = await confirm({
      title: 'Borrar línea de producción',
      message: `¿Borrar «${textoLinea(p)}» de ${p.equipoNombre} del ${dmy(p.fecha)}? No se puede deshacer (queda en 📜 Auditoría).`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!si) return;
    enVuelo.current = true;
    try {
      await borrarProduccion(p.id);
      toast.success('Línea borrada.');
      if (abierto?.editando?.id === p.id) setAbierto(null);
    } catch (e: any) {
      toast.error(e?.message || 'No se borró la línea.');
    } finally {
      enVuelo.current = false;
      cargar();
    }
  };

  // ── Estilos ──
  const ayuda = { color: colors.muted, fontSize: 12 };
  const etiqueta = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.sm };
  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginTop: 2, fontSize: 16,
  } as const;
  const pastilla = (activa: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
    borderColor: activa ? colors.primary : colors.border, backgroundColor: activa ? colors.primary : colors.surface,
  });
  const botonPrincipal = { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, alignItems: 'center' as const, opacity: guardando ? 0.5 : 1 };
  const botonSecundario = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, alignItems: 'center' as const };
  const reintentar = () => { setCargando(true); cargar(); };

  // ── Estados de carga ──
  if (error) {
    return (
      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '700' }}>⚠️ {error}</Text>
        {!faltaTabla ? (
          <TouchableOpacity onPress={reintentar} disabled={cargando} style={{ alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger }}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{cargando ? 'Cargando…' : '🔄 Reintentar'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }
  if (!listos) return <Text style={ayuda}>Cargando la producción…</Text>;
  if (!visibles.length) {
    return (
      <Text style={ayuda}>
        No hay equipos de trituración activos en este sitio. Se crean y se activan en ⚙️ Ajustes → 🏗️ Equipos de trituración.{pideloAQuienAdministra(nivel)}
      </Text>
    );
  }

  const totalDia = totalesProduccion(prods);
  const vsSalido = prods.length ? producidoVsSalido(prods, movimientosDelDia ?? []) : [];

  // ── El formulario (dentro de la tarjeta del equipo) ──
  const formulario = (a: Abierto) => {
    const r = rev!;
    const h = leerHoras(a.f.horas);
    const hError = h.ok ? null : h;
    const factorMixto = factorDeProducto(PRODUCTO_MIXTO, listas);
    const horasLuego = r.horas !== null ? horasOtras + r.horas : null;
    return (
      <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, gap: 2 }}>
        <Text style={{ color: colors.text, fontWeight: '900' }}>
          {a.editando ? `✏️ Corregir línea del ${dmy(a.fecha)}` : `➕ Anotar producción · ${a.equipo.nombre}`}
        </Text>
        {a.fecha !== fecha ? (
          <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>Se guarda en la jornada del {dmy(a.fecha)} (no en la que ves arriba).</Text>
        ) : null}

        <Text style={etiqueta}>MODO</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 }}>
          {MODOS.map((m) => (
            <TouchableOpacity key={m.key} onPress={() => cambiar({ modo: m.key })} style={pastilla(a.f.modo === m.key)} accessibilityLabel={m.label}>
              <Text style={{ color: a.f.modo === m.key ? colors.primaryContrast : colors.text, fontWeight: '800' }}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={ayuda}>{MODOS.find((m) => m.key === a.f.modo)?.ayuda}</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View style={{ flexGrow: 1, flexBasis: 140 }}>
            <Text style={etiqueta}>HORAS TRABAJADAS {a.f.modo === 'cribado' ? 'CRIBANDO' : 'TRITURANDO'}</Text>
            <TextInput value={a.f.horas} onChangeText={(t) => cambiar({ horas: t })} placeholder="Ej.: 10 · 10,5 · 10:30" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" style={input} />
            <Text style={{ fontSize: 11, marginTop: 2, fontWeight: '700', color: h.ok ? colors.success : intento || !hError?.vacio ? colors.danger : colors.muted }}>
              {h.ok ? `= ${textoHoras(h.valor)}` : hError?.vacio && !intento ? '10:30 = diez horas y media' : `⚠️ ${hError?.error ?? ''}`}
            </Text>
          </View>
          <View style={{ flexGrow: 1, flexBasis: 140 }}>
            <Text style={etiqueta}>TONELADAS POR HORA (t/h)</Text>
            <TextInput value={a.f.tph} onChangeText={(t) => cambiar({ tph: t })} placeholder={a.equipo.thDefecto ? `Por defecto ${fmtN(a.equipo.thDefecto)}` : 'Ej.: 250'} placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={input} />
            <Text style={{ fontSize: 11, marginTop: 2, color: colors.muted }}>
              Lo que ves en sitio (depende de la abertura de la mandíbula){a.equipo.thDefecto ? ` · por defecto ${fmtN(a.equipo.thDefecto)}` : ''}.
            </Text>
          </View>
        </View>

        {/* El resultado en vivo */}
        <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {r.toneladas !== null ? (
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>
              = {fmtT(r.toneladas)} t{a.f.modo === 'mixto' ? `  ≈ ${fmtT(desglosar(r.toneladas, [{ producto: PRODUCTO_MIXTO, pct: 100, factor: factorMixto.factor }])[0]?.m3 ?? 0)} m³` : ''}
            </Text>
          ) : (
            <Text style={ayuda}>Escribe las horas y las t/h: aquí sale el total (horas × t/h).</Text>
          )}
          {a.f.modo === 'mixto' ? (
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              Producto: {PRODUCTO_MIXTO} · factor {fmtN(factorMixto.factor)} t/m³ {factorMixto.deLista ? '(de la lista de materiales)' : '(por defecto; se cambia en ⚙️ Ajustes → Materiales)'}
            </Text>
          ) : null}
          {horasLuego !== null ? (
            <Text style={{ color: horasLuego > 24 ? colors.danger : colors.muted, fontSize: 11, marginTop: 2 }}>
              {a.equipo.nombre}: {fmtN(horasLuego)} de 24 h en la jornada{horasOtras > 0 ? ` (ya tenía ${fmtN(horasOtras)} h)` : ''}.
            </Text>
          ) : null}
        </View>

        {/* El cribado: los % de cada producto */}
        {a.f.modo === 'cribado' ? (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={etiqueta}>¿CÓMO SALIÓ CLASIFICADO? (LOS % QUE VES CON LA PALA)</Text>
            {a.f.reparto.map((fila, i) => {
              const d = r.desglose.find((x) => x.producto.toLowerCase() === fila.producto.trim().toLowerCase());
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
                  <TextInput value={fila.producto} onChangeText={(t) => cambiarFila(i, { producto: t })} placeholder="Producto" placeholderTextColor={colors.muted} style={[input, { flexGrow: 2, flexBasis: 130 }]} />
                  <TextInput value={fila.pct} onChangeText={(t) => cambiarFila(i, { pct: t })} placeholder="%" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={[input, { width: 80 }]} />
                  <Text style={{ color: colors.muted, fontWeight: '800' }}>%</Text>
                  <TouchableOpacity onPress={() => quitarFila(i)} style={{ padding: 6 }} accessibilityLabel={`Quitar ${fila.producto || 'producto'}`}>
                    <Text style={{ color: colors.danger, fontWeight: '900' }}>✕</Text>
                  </TouchableOpacity>
                  {d ? <Text style={{ color: colors.muted, fontSize: 11, flexBasis: '100%' }}>= {fmtT(d.toneladas)} t · {fmtT(d.m3)} m³ (factor {fmtN(d.factor)})</Text> : null}
                </View>
              );
            })}
            <TouchableOpacity onPress={agregarFila} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>➕ Agregar producto</Text>
            </TouchableOpacity>
            {r.reparto ? (
              <Text style={{ marginTop: 4, fontWeight: '900', color: r.reparto.texto.includes('✅') ? colors.success : colors.warning }}>{r.reparto.texto}</Text>
            ) : null}
          </View>
        ) : null}

        <Text style={etiqueta}>NOTA (OPCIONAL)</Text>
        <TextInput value={a.f.nota} onChangeText={(t) => cambiar({ nota: t })} placeholder="Ej.: mandíbula abierta, se paró 1 h por falla" placeholderTextColor={colors.muted} style={input} />

        {intento && r.errores.length ? (
          <View style={{ marginTop: spacing.xs }}>
            {r.errores.map((e, i) => <Text key={i} style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {e}</Text>)}
          </View>
        ) : null}
        {errorGuardar ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>❌ {errorGuardar}</Text> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <TouchableOpacity onPress={guardar} disabled={guardando} style={[botonPrincipal, { flexGrow: 1 }]}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{guardando ? 'Guardando…' : a.editando ? '💾 Guardar corrección' : '💾 Anotar producción'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cerrar} disabled={guardando} style={[botonSecundario, { flexGrow: 1 }]}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={ayuda}>Horas trabajadas × toneladas por hora = toneladas producidas. No descuenta ni limita las salidas.</Text>

      {visibles.map((eq) => {
        const lineas = prods.filter((p) => p.equipoId === eq.id);
        const horasEq = horasDelEquipo(prods, eq.id, fecha);
        const totEq = totalesProduccion(lineas);
        const formAqui = abierto && abierto.equipo.id === eq.id && !abierto.editando ? abierto : null;
        const detalle = [eq.codigo ? `Código ${eq.codigo}` : '', eq.serial ? `Serial ${eq.serial}` : '', eq.thDefecto ? `${fmtN(eq.thDefecto)} t/h por defecto` : 'sin t/h por defecto'].filter(Boolean).join(' · ');
        return (
          <View key={eq.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, flexShrink: 1 }}>{eq.tipo === 'cono' ? '🔺' : '⚙️'} {eq.nombre}</Text>
              {!eq.activo ? <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '800' }}>⏸️ dado de baja</Text> : null}
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{detalle}</Text>

            {lineas.length ? lineas.map((p) => {
              const corrigiendo = abierto?.editando?.id === p.id;
              const piezas = p.modo === 'cribado' ? desglosar(p.toneladas, p.reparto) : [];
              return (
                <View key={p.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{textoLinea(p)}</Text>
                      {piezas.map((d) => (
                        <Text key={d.producto} style={{ color: colors.muted, fontSize: 12 }}>   • {d.producto} {fmtN(d.pct)} % = {fmtT(d.toneladas)} t · {fmtT(d.m3)} m³</Text>
                      ))}
                      {p.modo === 'mixto' && desglosar(p.toneladas, p.reparto)[0] ? (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>   ≈ {fmtT(desglosar(p.toneladas, p.reparto)[0].m3)} m³ de {p.reparto[0]?.producto || PRODUCTO_MIXTO}</Text>
                      ) : null}
                      {p.nota ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>📝 {p.nota}</Text> : null}
                      {p.creadoPor ? <Text style={{ color: colors.muted, fontSize: 10 }}>Anotó {p.creadoPor}{p.editadoPor && p.editadoAt !== p.creadoAt ? ` · corrigió ${p.editadoPor}` : ''}</Text> : null}
                    </View>
                    {puedeAnotar ? (
                      <TouchableOpacity onPress={() => abrirEdicion(eq, p)} disabled={guardando} style={{ padding: 6 }} accessibilityLabel="Corregir línea">
                        <Text style={{ fontSize: 16 }}>✏️</Text>
                      </TouchableOpacity>
                    ) : null}
                    {esFull ? (
                      <TouchableOpacity onPress={() => borrar(p)} disabled={guardando} style={{ padding: 6 }} accessibilityLabel="Borrar línea">
                        <Text style={{ fontSize: 16 }}>🗑️</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {corrigiendo && abierto ? formulario(abierto) : null}
                </View>
              );
            }) : (
              <Text style={[ayuda, { marginTop: spacing.xs }]}>Sin producción anotada en esta jornada.</Text>
            )}

            {lineas.length > 1 ? (
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginTop: spacing.xs }}>
                Total {eq.nombre}: {fmtN(totEq.horas)} h · {fmtT(totEq.toneladas)} t · ≈ {fmtT(totEq.m3)} m³
              </Text>
            ) : null}

            {formAqui ? formulario(formAqui) : null}

            {puedeAnotar && !formAqui ? (
              eq.activo ? (
                horasEq >= 24 ? (
                  <Text style={[ayuda, { marginTop: spacing.xs }]}>Ya tiene 24 h anotadas en esta jornada: corrige una línea si hace falta.</Text>
                ) : (
                  <TouchableOpacity onPress={() => abrirNuevo(eq)} disabled={guardando} style={[botonPrincipal, { marginTop: spacing.sm, alignSelf: 'flex-start' }]}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>➕ Anotar producción</Text>
                  </TouchableOpacity>
                )
              ) : (
                <Text style={[ayuda, { marginTop: spacing.xs }]}>Está dado de baja: para anotarle producción, actívalo en ⚙️ Ajustes.{pideloAQuienAdministra(nivel)}</Text>
              )
            ) : null}
          </View>
        );
      })}

      {/* El total del día y, solo para informar, contra las salidas */}
      {prods.length ? (
        <View style={{ padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '900' }}>
            Total de la jornada: {fmtN(totalDia.horas)} h · {fmtT(totalDia.toneladas)} t · ≈ {fmtT(totalDia.m3)} m³
          </Text>
          {totalDia.porProducto.map((x) => (
            <Text key={x.producto} style={{ color: colors.muted, fontSize: 12 }}>• {x.producto}: {fmtT(x.toneladas)} t · {fmtT(x.m3)} m³</Text>
          ))}
          {vsSalido.some((x) => x.salidoT !== null || x.salidoM3 !== null) ? (
            <View style={{ marginTop: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>Producido vs. salido hoy (agregados):</Text>
              {vsSalido.map((x) => (
                <Text key={x.producto} style={{ color: colors.muted, fontSize: 12 }}>
                  • {x.producto}: produjo {x.producidoT > 0 ? `${fmtT(x.producidoT)} t` : '—'} · salió {x.salidoT !== null ? `${fmtT(x.salidoT)} t` : x.salidoM3 !== null ? `${fmtT(x.salidoM3)} m³` : '—'}
                </Text>
              ))}
              <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>{NOTA_CERNIDOR}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default BloqueProduccion;
