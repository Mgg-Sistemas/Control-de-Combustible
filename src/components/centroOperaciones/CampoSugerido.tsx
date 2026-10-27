// 🏭 CENTRO DE OPERACIONES — CAMPO CON SUGERENCIAS (24-oct-2026).
//
// Texto libre con sugerencias de las listas del sitio y del sistema. Devuelve
// SIEMPRE { texto, listaId }: el texto manda (se guarda tal cual); el id va solo
// cuando lo escrito es un nombre de la lista (elegido o escrito igual, sin mirar
// mayúsculas, tildes ni espacios). Así la fase 3 y las tarifas no dependen de
// cruzar por nombre.
//
// ⚠️ En la WEB la sugerencia se toma con `onPressIn`, no con `onPress`: el blur del
//    campo esconde la lista antes de que el click llegue (el mismo arreglo de
//    GuardButton). La lista se esconde 250 ms después del blur por lo mismo.
// ⭐ En el TELÉFONO se toma con `onPress` (revisión final B-M6): con el teclado abierto,
//    deslizar la PÁGINA apoyando el dedo sobre una sugerencia la elegía en el primer
//    contacto. Con `onPress`, un desplazamiento cancela el toque; la pantalla ya pasa
//    `keyboardShouldPersistTaps="handled"`, así que el primer toque no se lo traga el teclado.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm } from '../../lib/text';
import { itemDeLista, ValorLista } from '../../lib/centroOperacionesCarga';
import type { ItemLista } from '../../lib/centroOperaciones';

/** Cuántas sugerencias se muestran a la vez (las demás aparecen al escribir). Son 5
 *  porque caben en la caja (unos 34 px cada una, 180 px de alto) SIN desplazar: en la web
 *  se eligen con `onPressIn`, y el primer toque para desplazar ya elegía una por error. */
const MAX_SUGERENCIAS = 5;

/** En la web, `onPressIn` (el blur gana al click); en el teléfono, `onPress` (B-M6). */
const enWeb = Platform.OS === 'web';

type Props = {
  etiqueta: string;
  valor: ValorLista;
  onChange: (v: ValorLista) => void;
  /** Lo que se ofrece (ya sin repetir y A→Z). */
  sugerencias: string[];
  /** Los nombres de lista con los que se vincula el id (ya filtrados por clase). */
  items: ItemLista[];
  placeholder?: string;
};

export function CampoSugerido({ etiqueta, valor, onChange, sugerencias, items, placeholder }: Props) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);

  const fijar = (texto: string) => onChange({ texto, listaId: itemDeLista(texto, items)?.id ?? null });

  const visibles = useMemo(() => {
    const q = norm(valor.texto.trim());
    const lista = q ? sugerencias.filter((s) => norm(s).includes(q) && norm(s) !== q) : sugerencias;
    return lista.slice(0, MAX_SUGERENCIAS);
  }, [valor.texto, sugerencias]);

  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, marginTop: 4,
  } as const;

  return (
    <View style={{ marginTop: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{etiqueta.toUpperCase()}</Text>
        {valor.texto.trim() ? (
          <Text style={{ color: valor.listaId ? colors.success : colors.muted, fontSize: 10, fontWeight: '700' }}>
            {valor.listaId ? '📋 de la lista' : '✍️ texto libre'}
          </Text>
        ) : null}
      </View>
      <TextInput
        value={valor.texto}
        onChangeText={(v) => { fijar(v); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 250)}
        placeholder={placeholder ?? 'Escribe o elige'}
        placeholderTextColor={colors.muted}
        style={input}
      />
      {abierto && visibles.length > 0 ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, maxHeight: 180 }}>
          <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled>
            {visibles.map((s) => (
              <TouchableOpacity
                key={s}
                onPressIn={enWeb ? () => { fijar(s); setAbierto(false); } : undefined}
                onPress={enWeb ? undefined : () => { fijar(s); setAbierto(false); }}
                style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}
              >
                <Text style={{ color: colors.text, fontSize: 13 }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
