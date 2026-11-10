// ⛏️ TABLERO DE FRENTES (10-nov-2026). La vista nueva de la asignación, arriba de todo en
// «Frentes de trabajo» (Viajes de camiones y Reportes usan la MISMA pantalla).
//   · «⚠️ Sin frente» siempre arriba; una caja por frente con su color y su contador.
//   · Todo arranca PLEGADO: se despliega tocando el título (o «Desplegar todos»).
//   · Toca un equipo → se abre la ventana «Mover a:» con 🔎 buscador de frentes.
//   · Filtros: empresa, estado y categoría; 🔎 buscar equipo y 🔎 buscar frente.
//   · Las cajas plegadas van en una CUADRÍCULA pareja (columnas iguales en PC, una sola en
//     el teléfono); la que se despliega ocupa todo el ancho, así nada se descuadra.
// No guarda nada por su cuenta: le pide a la pantalla que MUEVA (`onMover`), y la pantalla lo
// hace con las mismas funciones de siempre. La lógica de qué sale dónde: lib/frentesTablero.ts.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { DateField } from './DateField';
import { armarTablero, etiquetaEquipo, frentesQueCoinciden, COLORES_FRENTES } from '../lib/frentesTablero';
import type { AsignacionTablero, EquipoTablero, FrenteTablero } from '../lib/frentesTablero';

type Props = {
  equipos: EquipoTablero[];
  asignaciones: AsignacionTablero[];
  frentes: FrenteTablero[];
  esMaq: boolean;
  /** «camión»/«equipo», «camiones»/«equipos». */
  singular: string;
  plural: string;
  editable: boolean;
  guardando: boolean;
  fecha: string;
  onFecha: (f: string) => void;
  /** Mueve los equipos a `destino` (null = quitarles el frente). `ademas`: camiones, sin quitar los otros. */
  onMover: (ids: string[], destino: string | null, ademas: boolean) => Promise<void>;
  /** 📋 Repetir el día anterior (si se puede). */
  onRepetirAnterior?: () => void;
};

const MAX_SIN_FRENTE = 80;
/** Ancho mínimo de una caja plegada: con eso se calcula cuántas columnas caben. */
const ANCHO_CAJA = 260;

export function FrentesTablero({ equipos, asignaciones, frentes, esMaq, singular, plural, editable, guardando, fecha, onFecha, onMover, onRepetirAnterior }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [frenteQuery, setFrenteQuery] = useState('');
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [verFiltros, setVerFiltros] = useState(false);
  const [soloSin, setSoloSin] = useState(false);
  const [varios, setVarios] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  /** La ventana «Mover a:»: qué equipos se mueven (uno, o los marcados). */
  const [elegir, setElegir] = useState<string[] | null>(null);
  const [buscaDestino, setBuscaDestino] = useState('');
  const [ademas, setAdemas] = useState(false);
  const [verTodosSin, setVerTodosSin] = useState(false);
  /** Cajas desplegadas a mano (a pedido, 10-nov: «que todos los frentes y sin frente salgan
   *  plegados por si yo lo quiero desplegar»). Arranca todo plegado; 'sin' = la de sin frente. */
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  /** Ancho disponible, para armar una cuadrícula pareja (columnas del mismo ancho). */
  const [ancho, setAncho] = useState(0);

  const t = useMemo(
    () => armarTablero(equipos, asignaciones, frentes, { query, empresa, estado, categoria, soloSinFrente: soloSin, frenteQuery }),
    [equipos, asignaciones, frentes, query, empresa, estado, categoria, soloSin, frenteQuery],
  );
  const activos = useMemo(() => frentes.filter((f) => f.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [frentes]);
  // El color de cada frente sale del tablero COMPLETO (sin buscar), para que no cambie al filtrar.
  const colores = useMemo(() => {
    const m = new Map<string, string>();
    armarTablero(equipos, asignaciones, frentes).cajas.forEach((c) => m.set(c.frenteId, c.color));
    return m;
  }, [equipos, asignaciones, frentes]);
  const colorDe = (id: string) => colores.get(id) ?? COLORES_FRENTES[0];
  const frentesDe = (id: string) => [...new Set(asignaciones.filter((a) => a.machineryId === id && a.frenteId).map((a) => a.frenteId))];

  const buscando = query.trim() !== '' || frenteQuery.trim() !== '' || empresa !== null || estado !== null || categoria !== null;
  /** Al buscar o filtrar se abren solas las cajas con resultados (si no, no se verían). */
  const abierta = (caja: string, cuantos: number) => abiertas.has(caja) || (buscando && cuantos > 0);
  const alternar = (caja: string) => setAbiertas((p) => { const n = new Set(p); if (n.has(caja)) n.delete(caja); else n.add(caja); return n; });

  const abrirMover = (ids: string[]) => { setAdemas(false); setBuscaDestino(''); setElegir(ids); };
  const cerrarMover = () => { setElegir(null); setBuscaDestino(''); setAdemas(false); };
  const tocar = (e: EquipoTablero) => {
    if (!editable || guardando) return;
    if (varios) { setMarcados((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; }); return; }
    abrirMover([e.id]);
  };
  const mover = async (ids: string[], destino: string | null) => {
    await onMover(ids, destino, !esMaq && ademas);
    cerrarMover(); setMarcados(new Set());
  };

  const pill = (on: boolean, color?: string) => ({
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? (color ?? colors.primary) : colors.border, backgroundColor: on ? (color ?? colors.primary) : colors.surface,
  });
  const pillTxt = (on: boolean) => ({ color: on ? colors.primaryContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 15 } as const;

  const ficha = (e: EquipoTablero, caja: string, color?: string) => {
    const on = varios ? marcados.has(e.id) : !!elegir && elegir.length === 1 && elegir[0] === e.id;
    const varias = !esMaq && frentesDe(e.id).length > 1;
    return (
      <TouchableOpacity key={`${caja}-${e.id}`} disabled={!editable} onPress={() => tocar(e)} activeOpacity={0.7}
        style={{ maxWidth: '100%', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : (color ?? colors.border), backgroundColor: on ? colors.primary + '22' : colors.surface }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{varios ? (marcados.has(e.id) ? '☑️ ' : '⬜ ') : ''}{etiquetaEquipo(e)}{varias ? ' · 2+' : ''}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>{[e.companyName, e.estado].filter(Boolean).join(' · ')}</Text>
      </TouchableOpacity>
    );
  };

  /** Un grupo de pastillas de filtro (empresa, estado o categoría). */
  const grupo = (titulo: string, opciones: string[], valor: string | null, poner: (v: string | null) => void, icono: string) => (
    opciones.length > 1 ? (
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{titulo}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <TouchableOpacity onPress={() => poner(null)} style={pill(valor === null)}><Text style={pillTxt(valor === null)}>Todos</Text></TouchableOpacity>
          {opciones.map((o) => (
            <TouchableOpacity key={o} onPress={() => poner(valor === o ? null : o)} style={pill(valor === o)}>
              <Text style={pillTxt(valor === o)}>{icono} {o}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    ) : null
  );
  const filtrosActivos = [empresa, estado, categoria].filter(Boolean).length;

  const sinMostrados = verTodosSin ? t.sinFrente : t.sinFrente.slice(0, MAX_SIN_FRENTE);
  const barraVarios = varios && marcados.size > 0 ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background }}>
      <Text style={{ color: colors.text, fontWeight: '900' }}>{marcados.size} {marcados.size === 1 ? singular : plural} marcados</Text>
      <TouchableOpacity disabled={guardando} onPress={() => abrirMover([...marcados])} style={pill(true)}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>⛏️ Mover a…</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setMarcados(new Set())} style={pill(false)}><Text style={pillTxt(false)}>Desmarcar</Text></TouchableOpacity>
    </View>
  ) : null;

  // La cuadrícula: cuántas columnas caben y el ancho exacto de cada una.
  const gap = spacing.sm;
  const cols = ancho > 0 ? Math.max(1, Math.floor((ancho + gap) / (ANCHO_CAJA + gap))) : 1;
  const anchoCol = ancho > 0 ? Math.floor((ancho - gap * (cols - 1)) / cols) : undefined;
  const todas = ['sin', ...t.cajas.map((c) => c.frenteId)];
  const todasAbiertas = todas.every((k) => abiertas.has(k));

  // La ventana «Mover a:» (uno o varios), con su buscador de frentes.
  const actualesMover = elegir ? [...new Set(elegir.flatMap((id) => frentesDe(id)))] : [];
  const destinosFiltrados = frentesQueCoinciden(activos, buscaDestino);
  const tituloMover = elegir
    ? elegir.length === 1
      ? (() => { const e = equipos.find((x) => x.id === elegir[0]); return e ? `Mover ${etiquetaEquipo(e)} a:` : 'Mover a:'; })()
      : `Mover ${elegir.length} ${plural} a:`
    : '';

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }} onLayout={(ev) => setAncho(Math.round(ev.nativeEvent.layout.width))}>
      {/* La fecha y los atajos */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'flex-end' }}>
        <View style={{ flexGrow: 1, flexBasis: 200 }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{esMaq ? 'CÓMO ESTÁN LOS FRENTES AL' : 'FRENTES DEL DÍA'}</Text>
          <DateField value={fecha} onChange={onFecha} />
        </View>
        {editable && onRepetirAnterior ? (
          <TouchableOpacity disabled={guardando} onPress={onRepetirAnterior} style={[pill(false), { paddingVertical: 10 }]}>
            <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>📋 Repetir los del día anterior</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={{ color: colors.muted, fontSize: 12 }}>
        {t.conFrente} de {t.totalEquipos} {plural} con frente · {t.totalEquipos - t.conFrente} sin frente
        {editable ? ` · Toca un ${singular} para asignarlo, cambiarlo o quitarlo.` : ''}
      </Text>

      {/* Los dos buscadores: el de equipos y el de frentes (por nombre) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <TextInput value={query} onChangeText={setQuery} placeholder={`🔎 Buscar ${singular}: código, placa, serial…`} placeholderTextColor={colors.muted} style={[input, { flexGrow: 1, flexBasis: 240 }]} autoCorrect={false} />
        <TextInput value={frenteQuery} onChangeText={setFrenteQuery} placeholder="🔎 Buscar frente por su nombre…" placeholderTextColor={colors.muted} style={[input, { flexGrow: 1, flexBasis: 240 }]} autoCorrect={false} />
      </View>

      {/* Atajos y filtros */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <TouchableOpacity onPress={() => setVerFiltros((v) => !v)} style={pill(verFiltros || filtrosActivos > 0)}>
          <Text style={pillTxt(verFiltros || filtrosActivos > 0)}>{verFiltros ? '▾' : '▸'} Filtrar por empresa, estado o categoría{filtrosActivos ? ` (${filtrosActivos})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSoloSin((v) => !v)} style={pill(soloSin, colors.warning)}>
          <Text style={{ color: soloSin ? '#fff' : colors.text, fontWeight: '800', fontSize: 12 }}>⚠️ Solo los sin frente</Text>
        </TouchableOpacity>
        {editable ? (
          <TouchableOpacity onPress={() => { setVarios((v) => !v); setMarcados(new Set()); }} style={pill(varios)}>
            <Text style={{ color: varios ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>☑️ Mover varios a la vez</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => setAbiertas(todasAbiertas ? new Set() : new Set(todas))} style={pill(false)}>
          <Text style={pillTxt(false)}>{todasAbiertas ? '▴ Plegar todos' : '▾ Desplegar todos'}</Text>
        </TouchableOpacity>
        {filtrosActivos || query || frenteQuery ? (
          <TouchableOpacity onPress={() => { setEmpresa(null); setEstado(null); setCategoria(null); setQuery(''); setFrenteQuery(''); }} style={pill(false)}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕ Limpiar filtros</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {/* Empresas, estados y categorías en varias filas (en PC una tira horizontal no se corre con el mouse). */}
      {verFiltros ? (
        <View style={{ gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
          {grupo('ESTADO', t.estados, estado, setEstado, '●')}
          {grupo('CATEGORÍA', t.categorias, categoria, setCategoria, '🏷️')}
          {grupo('EMPRESA', t.empresas, empresa, setEmpresa, '🏢')}
          {t.estados.length <= 1 && t.categorias.length <= 1 && t.empresas.length <= 1 ? <Text style={{ color: colors.muted, fontSize: 12 }}>No hay con qué filtrar en esta lista.</Text> : null}
        </View>
      ) : null}
      {barraVarios}

      {/* ⚠️ Sin frente: siempre arriba, a todo el ancho (plegada; se despliega tocando el título) */}
      {!frenteQuery.trim() ? (
        <View style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg }}>
          <TouchableOpacity onPress={() => alternar('sin')} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={{ color: colors.warningSoftText, fontWeight: '900', flex: 1 }}>{abierta('sin', t.sinFrente.length) ? '▾' : '▸'} ⚠️ SIN FRENTE</Text>
            <Text style={{ color: colors.warningSoftText, fontWeight: '900' }}>{t.sinFrente.length}</Text>
          </TouchableOpacity>
          {abierta('sin', t.sinFrente.length) ? (
            <>
              {t.sinFrente.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{buscando ? 'Ninguno con esa búsqueda.' : `Todos los ${plural} tienen frente. 👍`}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {sinMostrados.map((e) => ficha(e, 'sin'))}
              </View>
              {t.sinFrente.length > MAX_SIN_FRENTE ? (
                <TouchableOpacity onPress={() => setVerTodosSin((v) => !v)} style={{ marginTop: spacing.xs }}>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{verTodosSin ? 'Ver menos' : `Ver los ${t.sinFrente.length} (o usa el buscador)`}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {/* Una caja por frente. Plegadas: cuadrícula pareja (mismo ancho y alto). Desplegada: todo el ancho. */}
      {frenteQuery.trim() && t.cajas.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún frente se llama así.</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {t.cajas.map((c) => {
          const ab = abierta(c.frenteId, c.equipos.length);
          return (
            <View key={c.frenteId} style={{ width: ab ? '100%' : anchoCol ?? '100%', padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 5, borderLeftColor: c.color, backgroundColor: colors.surface }}>
              <TouchableOpacity onPress={() => alternar(c.frenteId)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Text numberOfLines={ab ? undefined : 1} style={{ color: colors.text, fontWeight: '900', flex: 1 }}>{ab ? '▾' : '▸'} {c.nombre}{!c.activo ? <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 11 }}> · desactivado</Text> : null}</Text>
                <View style={{ minWidth: 28, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: c.equipos.length ? c.color : colors.border, alignItems: 'center' }}>
                  <Text style={{ color: c.equipos.length ? '#fff' : colors.muted, fontWeight: '900', fontSize: 12 }}>{c.equipos.length}</Text>
                </View>
              </TouchableOpacity>
              {ab ? (
                <>
                  {c.equipos.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{buscando ? 'Ninguno con esa búsqueda.' : `Sin ${plural} ${esMaq ? 'asignados' : 'este día'}.`}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                    {c.equipos.map((e) => ficha(e, c.frenteId, c.color))}
                  </View>
                </>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* ⛏️ La ventana «Mover a:», con buscador de frentes. Los nombres largos bajan de línea. */}
      {elegir ? (
        <Modal visible transparent animationType="fade" onRequestClose={cerrarMover}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
            <View style={{ backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, maxWidth: 560, width: '100%', maxHeight: '90%', alignSelf: 'center', gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>{tituloMover}</Text>
              <TextInput value={buscaDestino} onChangeText={setBuscaDestino} placeholder="🔎 Buscar el frente por su nombre…" placeholderTextColor={colors.muted} style={input} autoCorrect={false} />
              <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 6 }}>
                {destinosFiltrados.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún frente se llama así.</Text> : null}
                {destinosFiltrados.map((f) => {
                  const es = actualesMover.includes(f.id) && actualesMover.length === 1 && elegir.length === 1;
                  return (
                    <TouchableOpacity key={f.id} disabled={guardando || es} onPress={() => mover(elegir, f.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colorDe(f.id), borderLeftWidth: 6, backgroundColor: colors.surface, opacity: es ? 0.45 : guardando ? 0.6 : 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }}>⛏️ {f.nombre}</Text>
                      {es ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>ya está</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {!esMaq ? (
                  <TouchableOpacity onPress={() => setAdemas((v) => !v)} style={pill(ademas)}>
                    <Text style={pillTxt(ademas)}>{ademas ? '☑️' : '⬜'} Además del que tiene (no quitar el actual)</Text>
                  </TouchableOpacity>
                ) : null}
                {actualesMover.length > 0 ? (
                  <TouchableOpacity disabled={guardando} onPress={() => mover(elegir, null)} style={[pill(false), { borderColor: colors.danger }]}>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🚫 Quitar frente{esMaq ? ` desde el ${fecha.split('-').reverse().join('/')}` : ''}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={cerrarMover} style={pill(false)}>
                  <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12 }}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export default FrentesTablero;
