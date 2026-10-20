// 👤 ELEGIR UNA PERSONA DE LA NÓMINA — O ESCRIBIRLA (20-oct-2026).
//
// Pedido: «quién lo solicitó y que sea de la lista de la nómina, pero sin tocar
// nómina ni nada, y si no existe lo pueda escribir y se guarde en contactos».
// Se usa DOS veces en el requerimiento (quién solicitó y quién autorizó), por eso
// vive acá y no dentro de la pantalla: dos copias se separan a la primera
// corrección.
//
// La regla (a quién se ofrece, cómo se busca, qué nombre vale, si ya existe) es
// pura y vive en `src/lib/requerimientoPersonas.ts`. Acá solo se pinta.
//
// ⚠️ LA NÓMINA NO SE TOCA. Esta caja solo LEE `employees`. Lo único que llega a
//    escribirse es un CONTACTO, y solo cuando el usuario escribe un nombre que no
//    está en ninguna de las dos listas.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import {
  buscarPersonas, nombreEscrito, nombreEscritoValido, nombreYaExiste,
  personaDeFicha, personaEscrita, SIN_PERSONA,
  type PersonaElegida, type PersonaNomina,
} from '../lib/requerimientoPersonas';

type Props = {
  /** El rótulo: «Solicitado por», «Autorizado por»… */
  titulo: string;
  /** La línea chica de abajo que explica de dónde sale la lista. */
  ayuda?: string;
  icono?: string;
  valor: PersonaElegida;
  onElegir: (p: PersonaElegida) => void;
  personas: PersonaNomina[];
  contactos: { id: string; name: string }[];
  /**
   * Guarda en CONTACTOS un nombre escrito a mano. Devuelve el aviso a mostrar
   * (null si quedó guardado). Lo hace la pantalla, que es la que tiene la sesión.
   */
  onGuardarContacto?: (nombre: string) => Promise<string | null>;
  cargando?: boolean;
};

export function PersonaNominaPicker({
  titulo, ayuda, icono = '👤', valor, onElegir, personas, contactos, onGuardarContacto, cargando,
}: Props) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const encontradas = useMemo(() => buscarPersonas(personas, q), [personas, q]);
  const escrito = nombreEscrito(q);
  const yaEsta = useMemo(() => nombreYaExiste(q, personas, contactos), [q, personas, contactos]);
  // Se ofrece crear el contacto solo si lo escrito sirve como nombre y NO existe
  // ya en ninguna de las dos listas (ni en nómina ni en contactos).
  const sePuedeCrear = nombreEscritoValido(q) && !yaEsta;

  const inp = {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 13,
  } as const;

  const cerrar = () => { setAbierto(false); setQ(''); setAviso(null); };

  const usarEscrito = async () => {
    const n = escrito;
    if (!n) return;
    // El nombre se pone en el requerimiento SIEMPRE; que el contacto se cree o no
    // es un extra — si la base lo rechaza, el papel no se queda sin solicitante.
    onElegir(personaEscrita(n));
    if (onGuardarContacto) {
      setGuardando(true);
      const err = await onGuardarContacto(n);
      setGuardando(false);
      if (err) { setAviso(err); return; }
    }
    cerrar();
  };

  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{titulo}</Text>
      {ayuda ? <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 4 }}>{ayuda}</Text> : null}

      <TouchableOpacity
        onPress={() => setAbierto((v) => !v)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderWidth: 1, borderColor: valor.nombre ? colors.brand : colors.border,
          backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
          paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        }}
      >
        <Text style={{ color: valor.nombre ? colors.text : colors.muted, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
          {valor.nombre ? `${icono} ${valor.nombre}` : 'Sin asignar'}
          {valor.nombre && !valor.employeeId ? '  ·  escrito a mano' : ''}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
          <TextInput
            value={q}
            onChangeText={(t) => { setQ(t); setAviso(null); }}
            placeholder="Buscar en la nómina (nombre, cédula, cargo, área)…"
            placeholderTextColor={colors.muted}
            style={[inp, { margin: 6 }]}
            autoCapitalize="characters"
          />

          {aviso ? (
            <Text style={{ color: colors.dangerSoftText, backgroundColor: colors.dangerSoftBg, fontSize: 11, fontWeight: '700', paddingHorizontal: spacing.md, paddingVertical: 6 }}>
              ⚠️ {aviso}
            </Text>
          ) : null}

          {/* Si lo escrito YA existe, se dice de dónde en vez de crear un duplicado. */}
          {yaEsta ? (
            <Text style={{ color: colors.muted, fontSize: 11, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
              «{escrito}» ya está {yaEsta.donde === 'nomina' ? 'en la nómina' : 'en Contactos'}: tócalo abajo en vez de volver a crearlo.
            </Text>
          ) : null}

          <View style={{ maxHeight: 230 }}>
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {/* Quitar lo elegido. */}
              <TouchableOpacity
                onPress={() => { onElegir(SIN_PERSONA); cerrar(); }}
                style={{ paddingVertical: 9, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }}>Sin asignar</Text>
              </TouchableOpacity>

              {/* Escribir un nombre que no está en la nómina → se guarda en Contactos. */}
              {sePuedeCrear ? (
                <TouchableOpacity
                  onPress={usarEscrito}
                  disabled={guardando}
                  style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt, opacity: guardando ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                    {guardando ? '⏳ Guardando…' : `＋ Usar «${escrito}»`}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 10, marginTop: 1 }}>
                    No está en la nómina: queda en este requerimiento y se agrega a Contactos.
                  </Text>
                </TouchableOpacity>
              ) : null}

              {cargando ? (
                <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.md }}>⏳ Leyendo la nómina…</Text>
              ) : null}

              {encontradas.map((p) => {
                const on = valor.employeeId === p.id;
                const detalle = [p.cargo, p.area, p.cedula].filter(Boolean).join(' · ');
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => { onElegir(personaDeFicha(p)); cerrar(); }}
                    style={{ paddingVertical: 8, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.brand : 'transparent' }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>
                      {p.activo ? '' : '⏸️ '}{p.nombre}
                    </Text>
                    {detalle ? (
                      <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 10 }} numberOfLines={1}>
                        {detalle}{p.activo ? '' : ' · no activo'}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}

              {!cargando && encontradas.length === 0 && !sePuedeCrear ? (
                <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.md }}>
                  {personas.length === 0
                    ? 'No se pudo leer la nómina. Puedes escribir el nombre igual.'
                    : 'Sin coincidencias. Escribe el nombre completo para agregarlo.'}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  );
}
