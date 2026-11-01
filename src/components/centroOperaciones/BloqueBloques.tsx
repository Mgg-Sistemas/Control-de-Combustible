// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO · 🧱 BLOQUES (PD4, 24-oct-2026).
//
// En la cantera (un sitio más del módulo): la PRODUCCIÓN del día, las VENTAS (salidas)
// de bloques y la tarjeta de INVENTARIO.
//
//   · Producción = renglón tipo 'produccion', material «Bloques» (o el material de la
//     lista marcado con «días hasta estar disponible»), `cantidad` en piezas,
//     `unidad_ingresada` 'u' y `disponible_desde` = fecha + los días del material (7 por
//     defecto). No es un viaje: no suma a viajes, toneladas ni m³.
//   · Venta = renglón tipo 'salida', mismo material, `cantidad` en piezas (a quién o a
//     dónde, opcional). Vender más de lo disponible ese día pide confirmación.
//   · Inventario (`inventarioBloques`): disponibles el día elegido, en curado, cuándo se
//     liberan y los avisos (una venta antes de terminar el curado, renglones sin cantidad
//     de ese día). Es un SALDO, pero NO se baja toda la historia del sitio (revisión final
//     A#6): solo las PIEZAS de antes del día (producciones y ventas con cantidad) más lo
//     del día, con la lectura acotada del 📄 Reporte completo (`cargarDatosReporteCompleto`
//     del día). Y solo cuando el sitio trabaja bloques (su lista tiene el material, o hay
//     bloques ese día); si no, un botón lo calcula.
//   · Lo del día se guarda CON su fecha (revisión final B-M1): al cambiar de jornada, lo
//     del día anterior no se ve bajo el título del nuevo (sale «Cargando…» hasta que llega).
//
// ⭐ Las cuentas viven en src/lib/centroOperacionesMaquinariaBloques.ts y
//    src/lib/centroOperacionesMateriales.ts (probadas solas). Esta pantalla pinta.
// ⭐ PERMISOS: Lectura ve; Escritura y Full anotan; 🗑️ borrar solo Full y con confirmación.
//    Si la base rechaza (RLS), el aviso va al toast y queda escrito; lo tecleado no se borra.
// ⭐ UN SOLO ANOTAR A LA VEZ (lote 5 B5): el candado (`enVuelo`) se pone al tocar el botón,
//    ANTES de esperar la historia o la confirmación, y el botón dice «Revisando el
//    inventario…»; la historia que se está bajando se COMPARTE (`historiaEnCurso`): otra
//    carga no la invalida, así no sale un «Inventario sin calcular» falso ni una venta doble.
// ⭐ Va DENTRO del bloque «7 · 🧱 Bloques» del Parte diario: sin tarjeta ni título propios
//    (B18; la del inventario se queda, separa otra cosa); «🔄 Reintentar» junto a cada error
//    (B12); avisa al Parte diario si quedó algo escrito sin anotar (B10).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../ui';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { fechaValida } from '../../lib/centroOperaciones';
import type { ItemLista, Movimiento, Sitio } from '../../lib/centroOperaciones';
import { dmy, secuenciaDePedidos } from '../../lib/centroOperacionesCarga';
import { NO_SE_GUARDO, borrarMovimiento, cargarDatosReporteCompleto, cargarListas, cargarMovimientos, guardarMovimiento } from '../../lib/centroOperacionesDb';
import { inventarioBloques } from '../../lib/centroOperacionesMateriales';
import type { InventarioBloques } from '../../lib/centroOperacionesMateriales';
import {
  avisoVenta, cantidadDeCampo, disponibleDesde, entradaInventario, esDeBloques, materialDeBloques,
} from '../../lib/centroOperacionesMaquinariaBloques';
import { pideloAQuienAdministra } from './pantallaParteDiario';

const fmt = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
const bloques = (n: number): string => `${fmt(n)} ${n === 1 ? 'bloque' : 'bloques'}`;

/** Un renglón del día (producción o venta) en una línea. */
function FilaBloques({ m, onBorrar }: { m: Movimiento; onBorrar?: () => void }) {
  const { colors } = useTheme();
  const cant = typeof m.cantidad === 'number' ? bloques(m.cantidad) : 'sin cantidad';
  const extra = m.tipo === 'produccion'
    ? (m.disponibleDesde ? `se vende desde el ${dmy(m.disponibleDesde)}` : '')
    : (m.destino ? `→ ${m.destino}` : '');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>
          {m.tipo === 'produccion' ? '🧱' : '📤'} {cant}{extra ? <Text style={{ color: colors.muted, fontWeight: '600' }}>  · {extra}</Text> : null}
        </Text>
        {m.observacion ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>📝 {m.observacion}</Text> : null}
        {m.creadoPor ? <Text style={{ color: colors.muted, fontSize: 10 }}>Anotó {m.creadoPor}</Text> : null}
      </View>
      {onBorrar ? (
        <TouchableOpacity onPress={onBorrar} style={{ padding: 6 }}>
          <Text style={{ fontSize: 16 }}>🗑️</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function BloqueBloques({ sitio, nivel, fecha, alSinGuardar }: {
  sitio: Sitio;
  nivel: PermLevel;
  fecha: string;
  /** Avisa si quedó algo escrito sin anotar (el encabezado plegado lo dice, lote 5 B10). */
  alSinGuardar?: (sinGuardar: boolean) => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeAnotar = levelMeets(nivel, 'escritura');
  const esFull = levelMeets(nivel, 'full');

  const [listas, setListas] = useState<ItemLista[]>([]);
  /** Lo del día y de CUÁL jornada es (B-M1: mientras llega otra, no se muestra bajo su título). */
  const [delDia, setDelDia] = useState<{ fecha: string; movs: Movimiento[] } | null>(null);
  /** Las piezas del sitio hasta `fecha` (null = no se cargó: el inventario no se sabe). */
  const [historia, setHistoria] = useState<Movimiento[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoHistoria, setCargandoHistoria] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorHistoria, setErrorHistoria] = useState<string | null>(null);
  /** Ella pidió calcular el inventario (en un sitio que no trabaja bloques a diario). */
  const pidioInventario = useRef(false);
  /** De qué sitio y jornada es la historia cargada: si cambian, la vieja no se muestra. */
  const claveHistoria = useRef('');

  // Lo que se escribe (no se borra si guardar falla).
  const [prodTxt, setProdTxt] = useState('');
  const [prodObs, setProdObs] = useState('');
  const [ventaTxt, setVentaTxt] = useState('');
  const [ventaDestino, setVentaDestino] = useState('');
  const [ventaObs, setVentaObs] = useState('');
  const [guardando, setGuardando] = useState(false);
  /** La venta está revisando el inventario antes de anotar (el botón lo dice). */
  const [revisando, setRevisando] = useState(false);
  /** ⭐ El candado de verdad contra el doble toque (el estado tarda un render en llegar). */
  const enVuelo = useRef(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  // ¿Quedó algo escrito sin anotar? (el encabezado plegado del Parte diario lo dice)
  const sinGuardar = !!(prodTxt.trim() || prodObs.trim() || ventaTxt.trim() || ventaDestino.trim() || ventaObs.trim());
  useEffect(() => { alSinGuardar?.(sinGuardar); }, [sinGuardar, alSinGuardar]);

  const mat = useMemo(() => materialDeBloques(listas), [listas]);

  // ── La historia (para el inventario) ──
  // ⭐ La que se está bajando se COMPARTE (B5): si otra carga (un foco, un refresco o un
  //    segundo toque) pide la MISMA historia, espera esa promesa en vez de pedir otra que la
  //    invalide. Quien la pidió recibe SU historia; en pantalla pinta solo la más nueva.
  const pedidosHistoria = useRef(secuenciaDePedidos()).current;
  const historiaEnCurso = useRef<{ clave: string; promesa: Promise<Movimiento[]> } | null>(null);
  const cargarHistoria = useCallback(async (): Promise<Movimiento[] | null> => {
    if (!fechaValida(fecha)) return null;
    const clave = `${sitio.id}|${fecha}`;
    let promesa = historiaEnCurso.current?.clave === clave ? historiaEnCurso.current.promesa : null;
    if (!promesa) {
      // ⭐ A#6: no toda la historia del sitio. Las PIEZAS de antes del día (producciones y
      //    ventas con cantidad) + lo del día: es lo único que el saldo necesita.
      const p = cargarDatosReporteCompleto(sitio.id, fecha, fecha).then((d) => [...d.anteriores, ...d.movimientos]);
      historiaEnCurso.current = { clave, promesa: p };
      const soltar = () => { if (historiaEnCurso.current?.promesa === p) historiaEnCurso.current = null; };
      p.then(soltar, soltar);
      promesa = p;
    }
    const n = pedidosHistoria.nuevo();
    setCargandoHistoria(true);
    try {
      const movs = await promesa;
      if (pedidosHistoria.vigente(n)) {
        claveHistoria.current = clave;
        setHistoria(movs);
        setErrorHistoria(null);
      }
      return movs;
    } catch (e: any) {
      if (pedidosHistoria.vigente(n)) {
        const msg = e?.message || 'No se pudo calcular el inventario.';
        setErrorHistoria(msg);
        toast.error(msg);
      }
      return null;
    } finally {
      if (pedidosHistoria.vigente(n)) setCargandoHistoria(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, fecha]);

  // ── La lista de materiales y lo del día; si el sitio trabaja bloques, también la historia ──
  // ⭐ Depende del objeto `sitio` y de `fecha`: refresca al entrar, al deslizar y al
  //    cambiar la jornada. Una respuesta vieja se descarta, y lo del día va con su fecha
  //    (B-M1): nunca se ve lo de otro día.
  const pedidos = useRef(secuenciaDePedidos()).current;
  const cargar = useCallback(async () => {
    const n = pedidos.nuevo();
    if (!fechaValida(fecha)) {
      setError('La fecha de la jornada no es válida.');
      setCargando(false);
      return;
    }
    // Otra jornada (u otro sitio): la historia cargada ya no sirve para el inventario de este día.
    if (claveHistoria.current !== `${sitio.id}|${fecha}`) setHistoria(null);
    try {
      const [ls, dia] = await Promise.all([cargarListas(sitio.id), cargarMovimientos(sitio.id, fecha, fecha)]);
      if (!pedidos.vigente(n)) return;
      setListas(ls);
      setDelDia({ fecha, movs: dia });
      setError(null);
      const m = materialDeBloques(ls);
      // El sitio trabaja bloques: su PROPIA lista tiene el material, o hay bloques ese día.
      const conBloques = (!!m.listaId && ls.some((i) => i.id === m.listaId && i.sitioId === sitio.id))
        || dia.some((x) => (x.tipo === 'produccion' || x.tipo === 'salida') && esDeBloques(x, m));
      if (conBloques || pidioInventario.current) cargarHistoria();
    } catch (e: any) {
      if (!pedidos.vigente(n)) return;
      const msg = e?.message || 'No se pudieron cargar los bloques del día.';
      setError(msg);
      toast.error(msg);
    } finally {
      if (pedidos.vigente(n)) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, fecha, cargarHistoria]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // ── Lo del día (solo si es de la jornada elegida: B-M1) ──
  const movsDelDia = delDia && delDia.fecha === fecha ? delDia.movs : null;
  const listoDia = movsDelDia !== null;
  const produccionDia = useMemo(() => (movsDelDia ?? []).filter((m) => m.tipo === 'produccion' && esDeBloques(m, mat)), [movsDelDia, mat]);
  const ventasDia = useMemo(() => (movsDelDia ?? []).filter((m) => m.tipo === 'salida' && esDeBloques(m, mat)), [movsDelDia, mat]);
  const suma = (l: Movimiento[]) => l.reduce((s, m) => s + (typeof m.cantidad === 'number' ? m.cantidad : 0), 0);

  // ── El inventario al día elegido ──
  const calcular = (movs: Movimiento[]): { inv: InventarioBloques; avisos: string[] } => {
    const e = entradaInventario(movs, mat);
    const inv = inventarioBloques(e.producciones, e.salidas, fecha, mat.dias);
    return { inv, avisos: [...e.avisos, ...inv.avisos] };
  };
  const inventario = useMemo(() => (historia ? calcular(historia) : null), [historia, mat, fecha]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lecturas en vivo ──
  const prod = cantidadDeCampo(prodTxt);
  const venta = cantidadDeCampo(ventaTxt);
  const libera = disponibleDesde(fecha, mat.dias);

  /** Guarda un renglón; si falla, lo escrito queda y el aviso también. El candado
   *  (`enVuelo`) y «Guardando…» ya los puso quien llama; acá se sueltan. */
  const anotar = async (datos: Partial<Movimiento>, exito: string, limpiar: () => void) => {
    setErrorGuardar(null);
    try {
      await guardarMovimiento(datos);
    } catch (e: any) {
      const msg = e?.message || NO_SE_GUARDO;
      setErrorGuardar(msg);
      toast.error(msg);
      enVuelo.current = false;
      setGuardando(false);
      // Puede que la base SÍ lo haya guardado y se perdiera la respuesta: que se vea.
      cargar();
      return;
    }
    enVuelo.current = false;
    setGuardando(false);
    limpiar();
    toast.success(exito);
    cargar();
  };

  const anotarProduccion = async () => {
    if (!puedeAnotar || enVuelo.current) return;
    if (prod.error) { toast.error(prod.error); return; }
    if (prod.valor === null) { toast.error('Escribe cuántos bloques se produjeron.'); return; }
    if (!fechaValida(fecha) || !libera) { toast.error('La fecha de la jornada no es válida.'); return; }
    enVuelo.current = true;
    setGuardando(true);
    await anotar({
      sitioId: sitio.id,
      fecha,
      tipo: 'produccion',
      unidadTexto: '',
      material: mat.nombre,
      materialId: mat.listaId,
      cantidad: prod.valor,
      unidadIngresada: 'u',
      disponibleDesde: disponibleDesde(fecha, mat.dias),
      viajes: null,
      estado: 'confirmado',
      observacion: prodObs.trim() || null,
    }, `Producción anotada: ${bloques(prod.valor)} (se venden desde el ${dmy(libera)}).`, () => { setProdTxt(''); setProdObs(''); });
  };

  const anotarVenta = async () => {
    if (!puedeAnotar || enVuelo.current) return;
    if (venta.error) { toast.error(venta.error); return; }
    if (venta.valor === null) { toast.error('Escribe cuántos bloques salieron.'); return; }
    if (!fechaValida(fecha)) { toast.error('La fecha de la jornada no es válida.'); return; }
    const cantidad = venta.valor;
    // ⭐ B5: el candado se pone YA, antes de esperar la historia o la confirmación.
    enVuelo.current = true;
    setGuardando(true);
    setRevisando(true);
    let seguir = true;
    try {
      // Antes de anotar: ¿hay bloques disponibles ese día? (con la historia al día)
      const movs = historia ?? await cargarHistoria();
      if (movs) {
        const aviso = avisoVenta(calcular(movs).inv.disponible, cantidad, fecha);
        if (aviso) {
          seguir = await confirm({ title: 'Más bloques de los disponibles', message: `${aviso}\n\n¿Anotar la venta igual?`, confirmText: 'Anotar igual', danger: true });
        }
      } else {
        seguir = await confirm({
          title: 'Inventario sin calcular',
          message: 'No se pudo revisar cuántos bloques hay disponibles ese día. ¿Anotar la venta igual?',
          confirmText: 'Anotar igual',
        });
      }
    } catch (e: any) {
      // Algo inesperado al revisar: no se anota y el candado se suelta (nunca queda trabado).
      seguir = false;
      toast.error(e?.message || 'No se pudo revisar el inventario.');
    } finally {
      setRevisando(false);
    }
    if (!seguir) { enVuelo.current = false; setGuardando(false); return; }
    await anotar({
      sitioId: sitio.id,
      fecha,
      tipo: 'salida',
      unidadTexto: '',
      material: mat.nombre,
      materialId: mat.listaId,
      cantidad,
      unidadIngresada: 'u',
      destino: ventaDestino.trim().replace(/\s+/g, ' ') || null,
      viajes: null,
      estado: 'confirmado',
      observacion: ventaObs.trim() || null,
    }, `Venta anotada: ${bloques(cantidad)}.`, () => { setVentaTxt(''); setVentaDestino(''); setVentaObs(''); });
  };

  const borrar = async (m: Movimiento) => {
    if (!esFull || enVuelo.current) return;
    const que = m.tipo === 'produccion' ? 'la producción' : 'la venta';
    const si = await confirm({
      title: 'Borrar renglón',
      message: `¿Borrar ${que} de ${typeof m.cantidad === 'number' ? bloques(m.cantidad) : 'bloques'} del ${dmy(m.fecha)}? No se puede deshacer.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!si) return;
    try {
      await borrarMovimiento(m.id);
      toast.success('Renglón borrado.');
    } catch (e: any) {
      toast.error(e?.message || 'No se borró el renglón.');
    }
    cargar();
  };

  const calcularAhora = () => {
    pidioInventario.current = true;
    cargarHistoria();
  };
  /** «🔄 Reintentar» la carga del día (B12): en web deslizar no hace nada. */
  const reintentar = () => { setCargando(true); cargar(); };

  // ── Estilos ──
  const ayuda = { color: colors.muted, fontSize: 12 };
  const etiqueta = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs };
  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginTop: 2,
  } as const;
  const boton = { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' as const, marginTop: spacing.xs, opacity: guardando ? 0.5 : 1 };
  const leido = (l: { valor: number | null; error: string | null }, vacio: string) => (
    <Text style={{ fontSize: 11, marginTop: 2, fontWeight: '700', color: l.error ? colors.danger : l.valor !== null ? colors.success : colors.muted }}>
      {l.error ? `⚠️ ${l.error}` : l.valor !== null ? `= ${bloques(l.valor)}` : vacio}
    </Text>
  );
  const cifraTarjeta = (titulo: string, valor: string, color: string) => (
    <View style={{ flexGrow: 1, flexBasis: 120, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{titulo}</Text>
      <Text style={{ color, fontSize: 20, fontWeight: '900' }}>{valor}</Text>
    </View>
  );

  const botonReintentar = (onPress: () => void, ocupado: boolean) => (
    <TouchableOpacity onPress={onPress} disabled={ocupado}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger, opacity: ocupado ? 0.5 : 1 }}>
      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>{ocupado ? 'Cargando…' : '🔄 Reintentar'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ gap: spacing.sm }}>
      {/* Sin tarjeta ni título propios: ya va dentro del bloque del Parte diario (B18). */}
      <View style={{ gap: spacing.xs }}>
        <Text style={ayuda}>
          Material «{mat.nombre}»: lo producido se vende {mat.dias === 0 ? 'el mismo día' : `${mat.dias} ${mat.dias === 1 ? 'día' : 'días'} después`}
          {mat.diasDeLaLista ? ' (días de la lista de materiales).' : ` (por defecto). Se cambia en ⚙️ Ajustes → Materiales.${pideloAQuienAdministra(nivel)}`}
        </Text>
        {error ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
              ⚠️ No se pudieron cargar los bloques: {error} — toca Reintentar (o desliza hacia abajo en el teléfono).
            </Text>
            {botonReintentar(reintentar, cargando)}
          </View>
        ) : null}

        {/* ── Producción del día ── */}
        <Text style={[etiqueta, { marginTop: spacing.sm }]}>🧱 PRODUCCIÓN DEL DÍA · {bloques(suma(produccionDia))}</Text>
        {!listoDia ? (
          <Text style={ayuda}>{error && !cargando ? 'No se sabe todavía (la carga falló).' : 'Cargando…'}</Text>
        ) : produccionDia.length === 0 ? (
          <Text style={ayuda}>Sin producción anotada ese día.</Text>
        ) : produccionDia.map((m) => <FilaBloques key={m.id} m={m} onBorrar={esFull ? () => borrar(m) : undefined} />)}
        {puedeAnotar ? (
          <View style={{ marginTop: spacing.xs }}>
            <TextInput value={prodTxt} onChangeText={setProdTxt} placeholder="¿Cuántos bloques se produjeron?" placeholderTextColor={colors.muted} keyboardType="number-pad" style={input} />
            {leido(prod, 'Sin dato')}
            {libera ? <Text style={{ color: colors.muted, fontSize: 11 }}>Lo producido el {dmy(fecha)} se vende desde el {dmy(libera)}.</Text> : null}
            <TextInput value={prodObs} onChangeText={setProdObs} placeholder="Observación (opcional)" placeholderTextColor={colors.muted} style={input} />
            <TouchableOpacity disabled={guardando} onPress={anotarProduccion} style={boton}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{guardando ? 'Guardando…' : '💾 Anotar producción'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Ventas / salidas del día ── */}
        <Text style={[etiqueta, { marginTop: spacing.md }]}>📤 VENTAS Y SALIDAS DEL DÍA · {bloques(suma(ventasDia))}</Text>
        {!listoDia ? null : ventasDia.length === 0 ? (
          <Text style={ayuda}>Sin ventas anotadas ese día.</Text>
        ) : ventasDia.map((m) => <FilaBloques key={m.id} m={m} onBorrar={esFull ? () => borrar(m) : undefined} />)}
        {puedeAnotar ? (
          <View style={{ marginTop: spacing.xs }}>
            <TextInput value={ventaTxt} onChangeText={setVentaTxt} placeholder="¿Cuántos bloques salieron?" placeholderTextColor={colors.muted} keyboardType="number-pad" style={input} />
            {leido(venta, 'Sin dato')}
            <TextInput value={ventaDestino} onChangeText={setVentaDestino} placeholder="A quién o a dónde (opcional)" placeholderTextColor={colors.muted} style={input} />
            <TextInput value={ventaObs} onChangeText={setVentaObs} placeholder="Observación (opcional)" placeholderTextColor={colors.muted} style={input} />
            <TouchableOpacity disabled={guardando} onPress={anotarVenta} style={boton}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{revisando ? 'Revisando el inventario…' : guardando ? 'Guardando…' : '💾 Anotar venta'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>Solo quien tiene Escritura o Full anota la producción y las ventas.</Text>
        )}
        {errorGuardar ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>⚠️ {errorGuardar}</Text> : null}
      </View>

      {/* ── Inventario ── */}
      <Card>
        <Text style={{ color: colors.brandText, fontSize: 15, fontWeight: '900' }}>📦 Inventario de bloques al {dmy(fecha)}</Text>
        <Text style={ayuda}>Solo cuenta para la venta lo que ya terminó el curado. Se calcula con todo lo anotado en este sitio hasta ese día.</Text>
        {errorHistoria ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1, minWidth: 180 }}>
              ⚠️ No se pudo calcular el inventario: {errorHistoria} — toca Reintentar (o desliza hacia abajo en el teléfono).
            </Text>
            {botonReintentar(calcularAhora, cargandoHistoria)}
          </View>
        ) : null}
        {cargandoHistoria ? (
          <Text style={[ayuda, { marginTop: spacing.xs }]}>Calculando el inventario…</Text>
        ) : !inventario ? (
          <TouchableOpacity onPress={calcularAhora} style={[boton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>📦 Calcular el inventario</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {cifraTarjeta('✅ Disponibles para la venta', fmt(inventario.inv.disponible), colors.success)}
              {cifraTarjeta('⏳ En curado', fmt(inventario.inv.enCurado), colors.warning)}
            </View>
            <Text style={[ayuda, { marginTop: spacing.xs }]}>
              Producidos {fmt(inventario.inv.producido)} · vendidos {fmt(inventario.inv.vendido)} (hasta el {dmy(fecha)}).
            </Text>
            <Text style={etiqueta}>🗓️ PRÓXIMAS LIBERACIONES</Text>
            {inventario.inv.proximos.length === 0 ? (
              <Text style={ayuda}>Nada en curado.</Text>
            ) : inventario.inv.proximos.map((p) => (
              <Text key={p.fecha} style={{ color: colors.text, fontSize: 13 }}>• {dmy(p.fecha)}: {bloques(p.cantidad)}</Text>
            ))}
            {inventario.avisos.length > 0 ? (
              <View style={{ marginTop: spacing.xs, borderWidth: 1, borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm, gap: 2 }}>
                {inventario.avisos.map((a, i) => (
                  <Text key={i} style={{ color: colors.warningSoftText, fontSize: 12, fontWeight: '700' }}>⚠️ {a}</Text>
                ))}
              </View>
            ) : null}
          </>
        )}
      </Card>
    </View>
  );
}

export default BloqueBloques;
