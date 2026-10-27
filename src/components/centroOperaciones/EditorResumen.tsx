// 🏭 CENTRO DE OPERACIONES — ✏️ EL EDITOR DEL RESUMEN EJECUTIVO (24-oct-2026).
//
// Las tarjetas de arriba del consolidado y del corte se pueden retocar para ESE
// papel, con el mismo contrato `EdicionResumen` de frentesReporte.ts (el patrón del
// tablero editable de FrentesTrabajo.tsx):
//   · 👁️/🚫 esconder una tarjeta por su CLAVE ESTABLE (lo oculto no deja rastro);
//   · cambiarle el título, el valor o la nota: lo que se deja EN BLANCO vuelve al
//     automático, así una casilla vacía nunca borra un dato;
//   · hasta MAX_TARJETAS_PROPIAS_COP tarjetas propias (más no caben en la fila).
//
// ⭐ EDITAR ES DEL PAPEL, NO DE LOS DATOS: este componente no guarda nada en la base;
//    solo devuelve la edición con `onChange` (la pestaña la recuerda en el equipo,
//    sin los valores escritos a mano: esos son cifras de ESE día).
import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Plegable } from '../Plegable';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { cuentaEdicionResumen, EDICION_RESUMEN_VACIA, resumenEditado } from '../../lib/frentesReporte';
import type { EdicionResumen, ResumenFrentes } from '../../lib/frentesReporte';
import {
  MAX_TARJETAS_PROPIAS_COP,
  agregarTarjetaPropia,
  alternarOcultoResumen,
  cambiarTarjetaPropia,
  escribirEnResumen,
  quitarTarjetaPropia,
} from '../../lib/centroOperacionesReportes';

type Props = {
  /** El resumen AUTOMÁTICO (sin la edición): sus valores son la prevista de cada casilla. */
  resumen: ResumenFrentes | null;
  edicion: EdicionResumen;
  onChange: (ed: EdicionResumen) => void;
  /** Con varias hojas (corte de varias unidades) un valor escrito a mano saldría
   *  IGUAL en todas: no se ofrece (el papel tampoco lo usa). */
  sinValores?: boolean;
};

export function EditorResumen({ resumen, edicion, onChange, sinValores }: Props) {
  const { colors } = useTheme();
  const tarjetas = resumen?.tarjetas ?? [];
  const propias = edicion.propias ?? [];
  const oculto = (k: string): boolean => (edicion.ocultos ?? []).includes(k);

  const cuenta = cuentaEdicionResumen(edicion);
  const resumenTxt = !resumenEditado(edicion) ? 'sin cambios' : [
    cuenta.ocultos ? `${cuenta.ocultos} escondida${cuenta.ocultos === 1 ? '' : 's'}` : '',
    cuenta.cambiados ? `${cuenta.cambiados} cambiada${cuenta.cambiados === 1 ? '' : 's'}` : '',
    cuenta.propias ? `${cuenta.propias} propia${cuenta.propias === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.xs, paddingVertical: 4, color: colors.text, fontSize: 12, minWidth: 60,
  } as const;
  const etiqueta = { color: colors.muted, fontSize: 10, fontWeight: '800' as const, marginTop: spacing.sm };

  return (
    <Plegable titulo="✏️ Ajustar el resumen ejecutivo" resumen={resumenTxt}>
      <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
        Esto cambia SOLO el papel: no toca ningún registro. Lo que dejes en blanco sale con su valor
        automático, y lo que escribas sale tal cual. Los valores grises son la prevista: el papel los
        recalcula al bajarlo.
      </Text>
      {sinValores ? (
        <Text style={{ color: colors.warning, fontSize: 10.5, marginBottom: spacing.xs }}>
          Con varias unidades cada hoja lleva sus propias cifras: el valor a mano no se ofrece (saldría
          igual en todas). Los títulos, las notas y las tarjetas propias sí van en cada hoja.
        </Text>
      ) : null}

      <Text style={etiqueta}>TARJETAS</Text>
      {tarjetas.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>Con estos datos el resumen no lleva tarjetas.</Text>
      ) : tarjetas.map((x) => {
        const off = oculto(x.k);
        return (
          <View key={`tj-${x.k}`} style={{ marginTop: 4, opacity: off ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <TouchableOpacity onPress={() => onChange(alternarOcultoResumen(edicion, x.k))} accessibilityLabel={off ? `Mostrar ${x.titulo}` : `Esconder ${x.titulo}`}>
                <Text style={{ fontSize: 14 }}>{off ? '🚫' : '👁️'}</Text>
              </TouchableOpacity>
              <TextInput
                value={edicion.titulos?.[x.k] ?? ''}
                onChangeText={(v) => onChange(escribirEnResumen(edicion, 'titulos', x.k, v))}
                placeholder={x.titulo}
                placeholderTextColor={colors.muted}
                editable={!off}
                style={{ ...input, flex: 1.6 }}
              />
              {!sinValores ? (
                <TextInput
                  value={edicion.valores?.[x.k] ?? ''}
                  onChangeText={(v) => onChange(escribirEnResumen(edicion, 'valores', x.k, v))}
                  placeholder={x.valor}
                  placeholderTextColor={colors.muted}
                  editable={!off}
                  style={{ ...input, flex: 1 }}
                />
              ) : null}
            </View>
            <TextInput
              value={edicion.notas?.[x.k] ?? ''}
              onChangeText={(v) => onChange(escribirEnResumen(edicion, 'notas', x.k, v))}
              placeholder={x.nota ?? 'sin nota'}
              placeholderTextColor={colors.muted}
              editable={!off}
              style={{ ...input, marginTop: 3, marginLeft: 22 }}
            />
          </View>
        );
      })}

      {/* Tarjetas de cosecha propia: el dato que el sistema no tiene. */}
      <Text style={etiqueta}>TARJETAS PROPIAS</Text>
      <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>
        Van al final del resumen, en este orden. Una sin título Y sin valor no sale.
      </Text>
      {propias.map((x, i) => (
        <View key={`pr-${i}`} style={{ marginTop: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <TextInput
              value={x.titulo}
              onChangeText={(v) => onChange(cambiarTarjetaPropia(edicion, i, 'titulo', v))}
              placeholder="Título (ej. Turno)"
              placeholderTextColor={colors.muted}
              style={{ ...input, flex: 1.6 }}
            />
            <TextInput
              value={x.valor}
              onChangeText={(v) => onChange(cambiarTarjetaPropia(edicion, i, 'valor', v))}
              placeholder="Valor"
              placeholderTextColor={colors.muted}
              style={{ ...input, flex: 1 }}
            />
            <TouchableOpacity onPress={() => onChange(quitarTarjetaPropia(edicion, i))} accessibilityLabel="Quitar la tarjeta">
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            value={x.nota ?? ''}
            onChangeText={(v) => onChange(cambiarTarjetaPropia(edicion, i, 'nota', v))}
            placeholder="Nota (opcional)"
            placeholderTextColor={colors.muted}
            style={{ ...input, marginTop: 3 }}
          />
        </View>
      ))}
      <TouchableOpacity
        disabled={propias.length >= MAX_TARJETAS_PROPIAS_COP}
        onPress={() => onChange(agregarTarjetaPropia(edicion))}
        style={{ marginTop: spacing.xs, alignSelf: 'flex-start', opacity: propias.length >= MAX_TARJETAS_PROPIAS_COP ? 0.5 : 1 }}
      >
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>➕ Agregar tarjeta</Text>
      </TouchableOpacity>
      {propias.length >= MAX_TARJETAS_PROPIAS_COP ? (
        <Text style={{ color: colors.warning, fontSize: 10, marginTop: 2 }}>
          Ya van {MAX_TARJETAS_PROPIAS_COP}: es el máximo, porque más tarjetas no caben en la fila del papel
          sin quedar ilegibles. Quita una para agregar otra.
        </Text>
      ) : null}

      {/* Volver a cero: solo se ofrece si hay algo que deshacer. */}
      {resumenEditado(edicion) ? (
        <TouchableOpacity onPress={() => onChange({ ...EDICION_RESUMEN_VACIA })} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>↺ Dejar el resumen como estaba</Text>
        </TouchableOpacity>
      ) : null}
    </Plegable>
  );
}

export default EditorResumen;
