// ⛏️ TABLERO DE FRENTES (10-nov-2026). La vista nueva de la asignación, arriba de todo en
// «Frentes de trabajo» (Viajes de camiones y Reportes usan la MISMA pantalla).
//   · «⚠️ Sin frente» siempre arriba; una caja por frente con su color y su contador.
//   · Toca un equipo → elige el frente (o «Quitar frente»). «☑️ Varios» para mover muchos.
//   · En PC las cajas salen en columnas; en el teléfono, una debajo de otra.
// No guarda nada por su cuenta: le pide a la pantalla que MUEVA (`onMover`), y la pantalla lo
// hace con las mismas funciones de siempre. La lógica de qué sale dónde: lib/frentesTablero.ts.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { DateField } from './DateField';
import { armarTablero, etiquetaEquipo, COLORES_FRENTES } from '../lib/frentesTablero';
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

export function FrentesTablero({ equipos, asignaciones, frentes, esMaq, singular, plural, editable, guardando, fecha, onFecha, onMover, onRepetirAnterior }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [soloSin, setSoloSin] = useState(false);
  const [varios, setVarios] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  /** El equipo que se está moviendo y en qué caja se tocó (el panel sale ahí mismo). */
  const [moviendo, setMoviendo] = useState<{ id: string; caja: string } | null>(null);
  const [ademas, setAdemas] = useState(false);
  const [verTodosSin, setVerTodosSin] = useState(false);

  const t = useMemo(() => armarTablero(equipos, asignaciones, frentes, { query, empresa, soloSinFrente: soloSin }), [equipos, asignaciones, frentes, query, empresa, soloSin]);
  const activos = useMemo(() => frentes.filter((f) => f.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [frentes]);
  const colorDe = (id: string) => t.cajas.find((c) => c.frenteId === id)?.color ?? COLORES_FRENTES[0];
  const frentesDe = (id: string) => [...new Set(asignaciones.filter((a) => a.machineryId === id && a.frenteId).map((a) => a.frenteId))];

  const tocar = (e: EquipoTablero, caja: string) => {
    if (!editable || guardando) return;
    if (varios) { setMarcados((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; }); return; }
    setAdemas(false);
    setMoviendo((m) => (m?.id === e.id && m.caja === caja ? null : { id: e.id, caja }));
  };
  const mover = async (ids: string[], destino: string | null) => {
    await onMover(ids, destino, !esMaq && ademas);
    setMoviendo(null); setMarcados(new Set()); setAdemas(false);
  };

  const pill = (on: boolean, color?: string) => ({
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? (color ?? colors.primary) : colors.border, backgroundColor: on ? (color ?? colors.primary) : colors.surface,
  });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 15 } as const;

  /** Los botones de destino: un frente por pastilla, con su color. */
  const destinos = (ids: string[], actuales: string[]) => (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {activos.map((f) => {
          const es = actuales.includes(f.id) && actuales.length === 1;
          return (
            <TouchableOpacity key={f.id} disabled={guardando || es} onPress={() => mover(ids, f.id)} style={[pill(true, colorDe(f.id)), { opacity: es ? 0.45 : guardando ? 0.6 : 1 }]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>⛏️ {f.nombre}{es ? ' (ya está)' : ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {!esMaq ? (
          <TouchableOpacity onPress={() => setAdemas((v) => !v)} style={pill(ademas)}>
            <Text style={{ color: ademas ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{ademas ? '☑️' : '⬜'} Además del que tiene (no quitar el actual)</Text>
          </TouchableOpacity>
        ) : null}
        {actuales.length > 0 ? (
          <TouchableOpacity disabled={guardando} onPress={() => mover(ids, null)} style={[pill(false), { borderColor: colors.danger }]}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>🚫 Quitar frente{esMaq ? ` desde el ${fecha.split('-').reverse().join('/')}` : ''}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => { setMoviendo(null); setMarcados(new Set()); }} style={pill(false)}>
          <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12 }}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const ficha = (e: EquipoTablero, caja: string, color?: string) => {
    const on = varios ? marcados.has(e.id) : moviendo?.id === e.id && moviendo.caja === caja;
    const varias = !esMaq && frentesDe(e.id).length > 1;
    return (
      <TouchableOpacity key={`${caja}-${e.id}`} disabled={!editable} onPress={() => tocar(e, caja)} activeOpacity={0.7}
        style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : (color ?? colors.border), backgroundColor: on ? colors.primary + '22' : colors.surface }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{varios ? (marcados.has(e.id) ? '☑️ ' : '⬜ ') : ''}{etiquetaEquipo(e)}{varias ? ' · 2+' : ''}</Text>
        {e.companyName ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>{e.companyName}</Text> : null}
      </TouchableOpacity>
    );
  };

  const panelAqui = (caja: string) => (moviendo && moviendo.caja === caja && !varios ? (
    <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background }}>
      <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 4 }}>
        {(() => { const e = equipos.find((x) => x.id === moviendo.id); return e ? `Mover ${etiquetaEquipo(e)} a:` : 'Mover a:'; })()}
      </Text>
      {destinos([moviendo.id], frentesDe(moviendo.id))}
    </View>
  ) : null);

  const sinMostrados = verTodosSin ? t.sinFrente : t.sinFrente.slice(0, MAX_SIN_FRENTE);
  const barraVarios = varios && marcados.size > 0 ? (
    <View style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background }}>
      <Text style={{ color: colors.text, fontWeight: '900', marginBottom: 4 }}>Mover {marcados.size} {marcados.size === 1 ? singular : plural} a:</Text>
      {destinos([...marcados], [...new Set([...marcados].flatMap((id) => frentesDe(id)))])}
    </View>
  ) : null;

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
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

      {/* Buscador y filtros */}
      <TextInput value={query} onChangeText={setQuery} placeholder={`🔎 Buscar ${singular}: código, placa, serial, empresa…`} placeholderTextColor={colors.muted} style={input} autoCorrect={false} />
      {t.empresas.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          <TouchableOpacity onPress={() => setEmpresa(null)} style={pill(empresa === null)}><Text style={{ color: empresa === null ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Todas las empresas</Text></TouchableOpacity>
          {t.empresas.map((em) => (
            <TouchableOpacity key={em} onPress={() => setEmpresa(empresa === em ? null : em)} style={pill(empresa === em)}>
              <Text style={{ color: empresa === em ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏢 {em}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <TouchableOpacity onPress={() => setSoloSin((v) => !v)} style={pill(soloSin, colors.warning)}>
          <Text style={{ color: soloSin ? '#fff' : colors.text, fontWeight: '800', fontSize: 12 }}>⚠️ Solo los sin frente</Text>
        </TouchableOpacity>
        {editable ? (
          <TouchableOpacity onPress={() => { setVarios((v) => !v); setMarcados(new Set()); setMoviendo(null); }} style={pill(varios)}>
            <Text style={{ color: varios ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 12 }}>☑️ Mover varios a la vez</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {barraVarios}

      {/* ⚠️ Sin frente: siempre arriba */}
      <View style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoftBg }}>
        <Text style={{ color: colors.warningSoftText, fontWeight: '900' }}>⚠️ SIN FRENTE ({t.sinFrente.length})</Text>
        {t.sinFrente.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{query || empresa ? 'Ninguno con esa búsqueda.' : `Todos los ${plural} tienen frente. 👍`}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {sinMostrados.map((e) => ficha(e, 'sin'))}
        </View>
        {t.sinFrente.length > MAX_SIN_FRENTE ? (
          <TouchableOpacity onPress={() => setVerTodosSin((v) => !v)} style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{verTodosSin ? 'Ver menos' : `Ver los ${t.sinFrente.length} (o usa el buscador)`}</Text>
          </TouchableOpacity>
        ) : null}
        {panelAqui('sin')}
      </View>

      {/* Una caja por frente: columnas en PC, una debajo de otra en el teléfono */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {t.cajas.map((c) => (
          <View key={c.frenteId} style={{ flexGrow: 1, flexBasis: 280, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, borderTopColor: c.color, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.text, fontWeight: '900' }}>⛏️ {c.nombre} <Text style={{ color: c.color }}>({c.equipos.length})</Text>{!c.activo ? <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 11 }}> · desactivado</Text> : null}</Text>
            {c.equipos.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{query || empresa ? 'Ninguno con esa búsqueda.' : `Sin ${plural} ${esMaq ? 'asignados' : 'este día'}.`}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {c.equipos.map((e) => ficha(e, c.frenteId, c.color))}
            </View>
            {panelAqui(c.frenteId)}
          </View>
        ))}
      </View>
      {barraVarios}
    </View>
  );
}

export default FrentesTablero;
