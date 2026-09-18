// COBRO DE COMIDAS · pestaña «🧾 Platos» de «💲 Precios y cuentas» (18-sep-2026).
//
// Pedido del cliente: crear platos además de desayuno, almuerzo, lunch y cena, y que
// TODOS tengan precio. Los platos son los de «🧾 Otros» (el mismo catálogo que usa la
// cocina al registrar); acá se crean CON precio, se les cambia el nombre y se quitan
// de la lista. Nunca se borran: sus entregas viejas se siguen viendo y cobrando.
//
// El precio de un plato se cambia en la pestaña «💲 Precios», con el mismo historial
// que las comidas fijas (desde, blindado, anular): el botón «💲 Precio» lleva allá.
//
// La regla vive en src/lib/comidaPlatos.ts; lo que escribe, en comidaPlatosDb.ts.
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { onlyDecimal } from '../lib/text';
import { precioComidaEn, validarPrecioComida, PrecioComida } from '../lib/cobroComidas';
import { crearPrecioComida } from '../lib/cobroComidasDb';
import {
  PlatoCatalogo, categoriaDePlato, limpiarNombrePlato, ordenarPlatos, platoActivo, platoConNombre, platosSinPrecio,
  validarNombrePlato,
} from '../lib/comidaPlatos';
import { cambiarListaPlato, crearOReusarPlato, renombrarPlato } from '../lib/comidaPlatosDb';

type Props = {
  canEdit: boolean;
  hoy: string;
  precios: PrecioComida[];
  platos: PlatoCatalogo[];
  cargando: boolean;
  /** Vuelve a leer precios y platos (y avisa al cobro para que recalcule). */
  onCambio: () => Promise<void> | void;
  /** Lleva a la pestaña «💲 Precios» con este plato elegido. */
  onPonerPrecio: (categoria: string) => void;
};

const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CobroComidasPlatos({ canEdit, hoy, precios, platos, cargando, onCambio, onPonerPrecio }: Props) {
  const { colors } = useTheme();
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [desde, setDesde] = useState(hoy);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Un plato a la vez: cambiando el nombre o confirmando que se quita de la lista.
  const [editando, setEditando] = useState<{ id: string; modo: 'nombre' | 'quitar' } | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [confirmarNombre, setConfirmarNombre] = useState(false);

  const vigente = (p: PlatoCatalogo) => precioComidaEn(precios, categoriaDePlato(p.id), hoy);
  const lista = useMemo(() => ordenarPlatos(platos), [platos]);
  const sinPrecio = useMemo(
    () => platosSinPrecio(platos, (c) => !!precioComidaEn(precios, c, hoy)),
    [platos, precios, hoy],
  );
  const enLista = lista.filter(platoActivo).length;

  // «Crear» un plato que ya existe (lo inventó la cocina) es ponerle precio: no se duplica.
  const existente = platoConNombre(platos, nombre);

  const crear = async () => {
    setAviso(null);
    const limpio = limpiarNombrePlato(nombre);
    if (!existente) {
      const m = validarNombrePlato(limpio, platos);
      if (m) { setAviso(`❌ ${m}`); return; }
    }
    // Precio OBLIGATORIO: sin él no se crea nada.
    const mp = validarPrecioComida({ categoria: 'plato', precio, desde, hasta: null }, ['plato']);
    if (mp) { setAviso(`❌ ${mp}`); return; }
    setGuardando(true);
    try {
      const r = await crearOReusarPlato(limpio, platos);
      if (r.error || !r.plato) { setAviso(`❌ ${r.error ?? 'No se creó el plato.'}`); return; }
      const nombreFinal = r.plato.name;
      const p = await crearPrecioComida({
        categoria: categoriaDePlato(r.plato.id),
        precio: Number(precio.replace(',', '.')),
        desde,
        nota: r.yaExistia ? 'Precio del plato' : 'Plato creado',
      });
      if (p.error) {
        setAviso(`⚠️ El plato «${nombreFinal}» ${r.yaExistia ? 'ya existía' : 'quedó creado'} pero SIN precio (${p.error}). Tócale «💲 Precio».`);
      } else {
        setAviso(r.yaExistia
          ? `✅ «${nombreFinal}» ya existía: ahora cuesta ${usd(precio.replace(',', '.'))} desde el ${dmy(desde)}.`
          : `✅ Plato «${nombreFinal}» creado a ${usd(precio.replace(',', '.'))} desde el ${dmy(desde)}. Ya le sale a la cocina en «🧾 Otros».`);
        setNombre(''); setPrecio(''); setDesde(hoy);
      }
      await onCambio();
    } finally {
      setGuardando(false);
    }
  };

  const abrirNombre = (p: PlatoCatalogo) => {
    setAviso(null); setConfirmarNombre(false); setNuevoNombre(p.name); setEditando({ id: p.id, modo: 'nombre' });
  };

  const guardarNombre = async (p: PlatoCatalogo) => {
    const limpio = limpiarNombrePlato(nuevoNombre);
    const m = validarNombrePlato(limpio, platos, p.id);
    if (m) { setAviso(`❌ ${m}`); return; }
    if (limpio === p.name) { setEditando(null); return; }
    // Primer toque: avisa qué va a pasar. Segundo: lo hace.
    if (!confirmarNombre) { setConfirmarNombre(true); return; }
    setGuardando(true);
    try {
      const r = await renombrarPlato(p, limpio);
      if (r.error) { setAviso(`❌ ${r.error}`); return; }
      setAviso(`✅ «${p.name}» ahora se llama «${limpio}»${r.entregas ? ` (corregido también en ${r.entregas} entrega(s) ya registradas)` : ''}.`);
      setEditando(null); setConfirmarNombre(false);
      await onCambio();
    } finally {
      setGuardando(false);
    }
  };

  const cambiarLista = async (p: PlatoCatalogo, activo: boolean) => {
    setAviso(null);
    setGuardando(true);
    try {
      const r = await cambiarListaPlato(p.id, activo);
      if (r.error) { setAviso(`❌ ${r.error}`); return; }
      setAviso(activo
        ? `✅ «${p.name}» volvió a la lista: ya le sale a la cocina.`
        : `✅ «${p.name}» se quitó de la lista. No se borró: sus entregas viejas se siguen viendo y cobrando.`);
      setEditando(null);
      await onCambio();
    } finally {
      setGuardando(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const boton = (label: string, onPress: () => void, color: string = colors.brandText) => (
    <TouchableOpacity key={label} disabled={guardando} onPress={onPress}
      style={{ paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, opacity: guardando ? 0.5 : 1 }}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const par = (cancelar: () => void, ok: string, onOk: () => void, peligro = false) => (
    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
      <TouchableOpacity onPress={cancelar} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={guardando} onPress={onOk} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: peligro ? colors.danger : colors.brand, opacity: guardando ? 0.6 : 1 }}>
        <Text style={{ color: peligro ? '#fff' : colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : ok}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
        Los platos que se entregan además de desayuno, almuerzo, lunch y cena (hielo, refresco, postre…). Son los mismos
        que la cocina elige en «🧾 Otros». Cada uno se cobra con su precio; si todavía no tiene, con el costo por plato que
        escribe la cocina al registrarlo.
      </Text>

      {aviso ? (
        <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : aviso.startsWith('⚠️') ? colors.warning : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
        </TouchableOpacity>
      ) : null}

      {sinPrecio.length ? (
        <View style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 13 }}>
            ⚠️ {sinPrecio.length} plato(s) de la lista sin precio
          </Text>
          <Text style={{ color: colors.text, fontSize: 12, marginTop: 2 }}>
            {sinPrecio.map((p) => p.name).join(', ')}. Mientras no tengan precio se cobran con el costo que escribe la cocina
            (y si no escribe ninguno, no suman). Tócales «💲 Precio».
          </Text>
        </View>
      ) : null}

      {canEdit ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>➕ Crear plato</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre</Text>
          <TextInput nativeID="plato-nombre" value={nombre} onChangeText={setNombre} placeholder="Ej. Postre, Jugo natural, Bolsa de hielo…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: 2 }} />
          {existente ? (
            <Text style={{ color: colors.warning, fontSize: 11, marginBottom: spacing.xs }}>
              Ya hay un plato «{existente.name}»{platoActivo(existente) ? '' : ' (quitado de la lista: vuelve a ella)'}. No se crea otro: se le pone este precio.
            </Text>
          ) : <View style={{ height: spacing.xs }} />}
          <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por plato ($) · obligatorio</Text>
          <TextInput nativeID="plato-precio" value={precio} onChangeText={(v) => setPrecio(onlyDecimal(v))} keyboardType="numeric" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Rige desde</Text>
          <DateField value={desde} onChange={setDesde} />
          <TouchableOpacity disabled={guardando} onPress={crear} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: guardando ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>
              {guardando ? 'Guardando…' : existente ? '💲 Ponerle este precio' : '💾 Crear plato'}
            </Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      <Text style={{ color: colors.text, fontWeight: '800', marginTop: spacing.sm }}>
        Platos ({enLista} en la lista{lista.length > enLista ? ` · ${lista.length - enLista} quitado(s)` : ''})
      </Text>
      {cargando && !lista.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
      {!cargando && !lista.length ? (
        <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Todavía no hay platos. Crea el primero arriba.</Text>
      ) : null}

      {lista.map((p) => {
        const v = vigente(p);
        const activo = platoActivo(p);
        const abierto = editando?.id === p.id ? editando.modo : null;
        return (
          <Card key={p.id} style={activo ? undefined : { opacity: 0.6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>
                🧾 {p.name}{activo ? '' : '  · quitado de la lista'}
              </Text>
              <Text style={{ color: v ? colors.text : colors.warning, fontWeight: '800', fontVariant: ['tabular-nums'] as any }}>
                {v ? usd(v.precio) : '⚠️ sin precio'}
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {v
                ? (v.hasta ? `🔒 blindado ${dmy(v.desde)} → ${dmy(v.hasta)}` : `desde ${dmy(v.desde)}`)
                : 'Se cobra con el costo que escribe la cocina hasta que le pongas precio.'}
            </Text>

            {canEdit && !abierto ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {boton('💲 Precio', () => onPonerPrecio(categoriaDePlato(p.id)))}
                {boton('✏️ Nombre', () => abrirNombre(p))}
                {activo
                  ? boton('🚫 Quitar de la lista', () => { setAviso(null); setEditando({ id: p.id, modo: 'quitar' }); }, colors.danger)
                  : boton('↩️ Devolver a la lista', () => cambiarLista(p, true))}
              </View>
            ) : null}

            {abierto === 'nombre' ? (
              <View style={{ marginTop: spacing.xs }}>
                <TextInput nativeID={`plato-renombrar-${p.id}`} value={nuevoNombre} onChangeText={(t) => { setNuevoNombre(t); setConfirmarNombre(false); }} placeholder="Nombre nuevo" placeholderTextColor={colors.muted} style={input} />
                {confirmarNombre ? (
                  <Text style={{ color: colors.warning, fontSize: 12, marginTop: spacing.xs }}>
                    Se cambia en la lista Y en las entregas ya registradas como «{p.name}», para que los reportes viejos
                    digan lo mismo. Cada entrega corregida queda en «🕵️ Quién tocó las comidas». ¿Seguro?
                  </Text>
                ) : null}
                {par(() => { setEditando(null); setConfirmarNombre(false); }, confirmarNombre ? 'Sí, cambiar el nombre' : 'Guardar nombre', () => guardarNombre(p))}
              </View>
            ) : null}

            {abierto === 'quitar' ? (
              <View style={{ marginTop: spacing.xs }}>
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  Deja de salirle a la cocina en «🧾 Otros». No se borra: sus entregas viejas se siguen viendo y cobrando,
                  y lo puedes devolver a la lista cuando quieras.
                </Text>
                {par(() => setEditando(null), 'Sí, quitar', () => cambiarLista(p, false), true)}
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
