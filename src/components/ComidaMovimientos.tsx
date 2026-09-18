// QUIÉN TOCÓ LAS COMIDAS (18-sep-2026).
//
// Pedido del cliente: «que quede un registro de quién borró y cuándo borró
// cualquier registro de las comidas, o quién creó el nuevo modo de comida».
//
// El registro ya lo escribía la base; lo que faltaba era poder VERLO sin pasar
// por la pantalla de Auditoría, que exige `can_audit` y mezcla las comidas con
// las otras 30 y pico de tablas del sistema.
//
// ⚠️ Si la lectura vuelve vacía puede ser que no haya pasado nada O que la base
//    no deje leer la bitácora todavía (falta correr el .sql de esta tanda). Se
//    dicen las dos cosas: un «sin movimientos» falso haría creer que nadie borró
//    nada, que es justo lo contrario de lo que se pidió.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Plegable } from './Plegable';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { cargarMovimientosComida } from '../lib/comidaEditarDb';
import { FilaAuditoria, MovimientoComida, movimientosDeComida, resumenMovimientos, soloDelTipo } from '../lib/comidaMovimientos';
import { PlatoCatalogo, nombreDeCategoria } from '../lib/comidaPlatos';

type Props = {
  desde: string;
  hasta: string;
  /** Para decir «Precio de 🧾 Postre» y no «Precio de plato_3f2a…». */
  platos?: PlatoCatalogo[] | null;
};

type Filtro = 'todo' | MovimientoComida['tipo'];

const PASTILLAS: { key: Filtro; label: string }[] = [
  { key: 'todo', label: 'Todo' },
  { key: 'borrado', label: '🗑️ Borrados' },
  { key: 'cambio', label: '✏️ Correcciones' },
  { key: 'alta', label: '➕ Agregados' },
];

export function ComidaMovimientos({ desde, hasta, platos }: Props) {
  const { colors } = useTheme();
  // Se guardan las filas crudas: el renglón se vuelve a armar cuando llega el catálogo de platos.
  const [filas, setFilas] = useState<FilaAuditoria[] | null>(null);
  const movs = useMemo(
    () => (filas ? movimientosDeComida(filas, (c) => nombreDeCategoria(platos, c)) : null),
    [filas, platos],
  );
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todo');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setFilas((await cargarMovimientosComida(desde, hasta)) as FilaAuditoria[]);
      setError(null);
    } catch (e: any) {
      setFilas(null);
      setError(e?.message ?? 'No se pudo leer la bitácora.');
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const lista = movs ? soloDelTipo(movs, filtro) : [];
  const resumen = error ? 'No se pudo leer' : movs ? resumenMovimientos(movs) : 'Cargando…';

  return (
    <Plegable titulo="🕵️ Quién tocó las comidas" resumen={resumen} alerta={!!error}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Cada vez que alguien agrega, corrige o borra una comida —o crea un plato nuevo— queda su nombre y la hora.
        Un borrado guarda además todos los datos de lo que se borró.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {PASTILLAS.map((p) => {
          const on = filtro === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => setFiltro(p.key)}
              style={{ borderRadius: radius.pill, borderWidth: 1.5, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6 }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          onPress={cargar}
          disabled={cargando}
          style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 6, opacity: cargando ? 0.5 : 1 }}
        >
          <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{cargando ? '…' : '↻ Actualizar'}</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
          ⚠️ No se pudo leer la bitácora ({error}). Puede faltar correr el permiso de lectura en la base.
        </Text>
      ) : !movs ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
      ) : lista.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {movs.length === 0
            ? 'No hay movimientos en estas fechas. Si esperabas ver alguno, puede que la base todavía no deje leer la bitácora desde acá.'
            : 'No hay movimientos de ese tipo en estas fechas.'}
        </Text>
      ) : (
        lista.map((m) => (
          <View key={m.clave} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
              {m.icono} {m.verbo}: {m.titulo}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {m.quien} · {m.cuando}
            </Text>
            {m.detalle ? (
              <Text style={{ color: colors.brandText, fontSize: 11, marginTop: 2 }}>{m.detalle}</Text>
            ) : null}
          </View>
        ))
      )}
    </Plegable>
  );
}
