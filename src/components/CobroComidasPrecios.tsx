// COBRO DE COMIDAS · precios (15-sep-2026).
//
// Se abre desde la tarjeta «💵 Cobro de comidas» de Distribución de comida. Un precio por
// comida: general desde una fecha, o blindado a un rango que manda sobre el general en
// esas fechas. Nunca se borran: se anulan. Lo pasado conserva su precio.
//
// La regla (qué precio rige) vive en src/lib/cobroComidas.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Screen, SectionTitle, Card } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { onlyDecimal } from '../lib/text';
import { MEALS } from '../lib/foodCompanyMeals';
import { precioComidaEn, validarPrecioComida, PrecioComida } from '../lib/cobroComidas';
import { anularPrecioComida, cargarPreciosComida, crearPrecioComida } from '../lib/cobroComidasDb';
import { CobroComidasCuentas } from './CobroComidasCuentas';

type Props = {
  visible: boolean;
  onClose: () => void;
  canEdit: boolean;
  usuarioId: string | null;
  hoy: string;
  /** Se llama después de guardar algo, para que el cobro recalcule. */
  onChanged: () => void;
};

const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const etiqueta = (k: string) => {
  const m = MEALS.find((x) => x.key === k);
  return m ? `${m.icon} ${m.label}` : k;
};

export function CobroComidasPrecios({ visible, onClose, canEdit, usuarioId, hoy, onChanged }: Props) {
  const { colors } = useTheme();
  const [pestana, setPestana] = useState<'precios' | 'cuentas'>('precios');
  const [precios, setPrecios] = useState<PrecioComida[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [categoria, setCategoria] = useState<string>(MEALS[0].key);
  const [precio, setPrecio] = useState('');
  const [desde, setDesde] = useState(hoy);
  const [conHasta, setConHasta] = useState(false);
  const [hasta, setHasta] = useState(hoy);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [verAnulados, setVerAnulados] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setPrecios(await cargarPreciosComida());
    } catch (e: any) {
      setError(`No se pudieron leer los precios (${e?.message ?? 'revisa la conexión'}).`);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (visible) { setAviso(null); cargar(); }
  }, [visible, cargar]);

  const ordenados = useMemo(
    () => precios
      .filter((p) => verAnulados || !p.anulada_at)
      .slice()
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [precios, verAnulados],
  );

  const guardar = async () => {
    setAviso(null);
    const motivo = validarPrecioComida({ categoria, precio, desde, hasta: conHasta ? hasta : null }, MEALS.map((m) => m.key));
    if (motivo) { setAviso(`❌ ${motivo}`); return; }
    setGuardando(true);
    const { error: err } = await crearPrecioComida({
      categoria,
      precio: Number(precio.replace(',', '.')),
      desde,
      hasta: conHasta ? hasta : null,
      nota,
    });
    setGuardando(false);
    if (err) { setAviso(`❌ ${err}`); return; }
    setAviso(conHasta
      ? `✅ ${etiqueta(categoria)} a ${usd(precio.replace(',', '.'))} blindado del ${dmy(desde)} al ${dmy(hasta)}. Fuera de ese rango no cambia nada.`
      : `✅ ${etiqueta(categoria)} a ${usd(precio.replace(',', '.'))} desde el ${dmy(desde)} en adelante. Los días anteriores conservan su precio.`);
    setPrecio(''); setNota('');
    await cargar();
    onChanged();
  };

  const confirmarAnular = async (p: PrecioComida) => {
    const { error: err } = await anularPrecioComida(p.id, motivoAnular, usuarioId);
    if (err) { setAviso(`❌ ${err}`); return; }
    setAnulando(null); setMotivoAnular('');
    setAviso('✅ Precio anulado. Los días que cubría vuelven a tomar el precio que corresponda.');
    await cargar();
    onChanged();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (activo: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: activo ? colors.brand : colors.border, backgroundColor: activo ? colors.brand : colors.surface });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.xs, marginBottom: spacing.xs }}>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>← Volver</Text>
        </TouchableOpacity>
        <SectionTitle>💲 Precios y cuentas</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
          El precio de cada comida y, por cuenta, si se cobra y quién es su encargado. Todo cambio rige desde la fecha
          que elijas y no toca lo anterior. No cambia cómo registra la cocina.
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          <TouchableOpacity onPress={() => setPestana('precios')} style={chip(pestana === 'precios')}>
            <Text style={chipTxt(pestana === 'precios')}>💲 Precios</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPestana('cuentas')} style={chip(pestana === 'cuentas')}>
            <Text style={chipTxt(pestana === 'cuentas')}>👤 Cuentas</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={{ borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text>
          </View>
        ) : null}
        {aviso ? (
          <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
          </TouchableOpacity>
        ) : null}

        {pestana === 'cuentas' ? (
          <CobroComidasCuentas canEdit={canEdit} hoy={hoy} onChanged={onChanged} />
        ) : (
        <ScrollView style={{ flex: 1 }}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>Precio vigente hoy ({dmy(hoy)})</Text>
            {MEALS.map((m) => {
              const p = precioComidaEn(precios, m.key, hoy);
              return (
                <Text key={m.key} style={{ color: colors.text, fontSize: 13 }}>
                  {m.icon} {m.label}: <Text style={{ fontWeight: '800', color: p ? colors.text : colors.warning }}>{p ? usd(p.precio) : 'sin precio'}</Text>
                  {p ? <Text style={{ color: colors.muted }}>{p.hasta ? `  · blindado ${dmy(p.desde)} → ${dmy(p.hasta)}` : `  · desde ${dmy(p.desde)}`}</Text> : null}
                </Text>
              );
            })}
            {/* Quien busca aquí el precio de «Otros» no lo va a encontrar: se dice dónde está. */}
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
              🧾 Otros (hielo, refresco, postre…) no lleva precio aquí: cada plato se cobra con el costo por plato que
              escribe la cocina al registrarlo.
            </Text>
          </Card>

          {canEdit ? (
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>➕ Nuevo precio</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm, flexWrap: 'wrap' }}>
                {MEALS.map((m) => (
                  <TouchableOpacity key={m.key} onPress={() => setCategoria(m.key)} style={chip(categoria === m.key)}>
                    <Text style={chipTxt(categoria === m.key)}>{m.icon} {m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Precio por comida ($)</Text>
              <TextInput value={precio} onChangeText={(v) => setPrecio(onlyDecimal(v))} keyboardType="numeric" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Desde</Text>
              <DateField value={desde} onChange={setDesde} />
              <TouchableOpacity onPress={() => setConHasta((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm }}>
                <Text style={{ fontSize: 16 }}>{conHasta ? '☑️' : '⬜'}</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>🔒 Blindar a un rango de fechas</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                {conHasta
                  ? 'Rige solo del «desde» al «hasta» y manda sobre el precio general en esas fechas.'
                  : 'Rige desde esa fecha en adelante, hasta que pongas otro.'}
              </Text>
              {conHasta ? (
                <View style={{ marginTop: spacing.xs }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Hasta</Text>
                  <DateField value={hasta} onChange={setHasta} />
                </View>
              ) : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
              <TextInput value={nota} onChangeText={setNota} placeholder="Motivo del cambio…" placeholderTextColor={colors.muted} style={input} />
              <TouchableOpacity disabled={guardando} onPress={guardar} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{guardando ? 'Guardando…' : '💾 Guardar precio'}</Text>
              </TouchableOpacity>
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Historial de precios</Text>
            <TouchableOpacity onPress={() => setVerAnulados((v) => !v)}>
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>{verAnulados ? 'Ocultar anulados' : 'Ver anulados'}</Text>
            </TouchableOpacity>
          </View>
          {cargando && !precios.length ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}
          {ordenados.map((p) => (
            <Card key={p.id} style={p.anulada_at ? { opacity: 0.55 } : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{etiqueta(p.categoria)} · {usd(p.precio)}</Text>
                <Text style={{ color: p.hasta ? colors.warning : colors.muted, fontSize: 12, fontWeight: '700' }}>
                  {p.hasta ? `🔒 ${dmy(p.desde)} → ${dmy(p.hasta)}` : `desde ${dmy(p.desde)}`}
                </Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {p.created_by_nombre ? `${p.created_by_nombre} · ` : ''}{p.created_at ? new Date(p.created_at).toLocaleString('es-VE', { timeZone: 'America/Caracas' }) : ''}
                {p.nota ? ` · ${p.nota}` : ''}
              </Text>
              {p.anulada_at ? (
                <Text style={{ color: colors.danger, fontSize: 11 }}>Anulado{p.anulada_motivo ? `: ${p.anulada_motivo}` : ''}</Text>
              ) : canEdit ? (
                anulando === p.id ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <TextInput value={motivoAnular} onChangeText={setMotivoAnular} placeholder="Motivo de la anulación" placeholderTextColor={colors.muted} style={input} />
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                      <TouchableOpacity onPress={() => { setAnulando(null); setMotivoAnular(''); }} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmarAnular(p)} style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>Sí, anular</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => { setAnulando(p.id); setMotivoAnular(''); }} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🚫 Anular</Text>
                  </TouchableOpacity>
                )
              ) : null}
            </Card>
          ))}
          <View style={{ height: spacing.lg }} />
        </ScrollView>
        )}
      </Screen>
    </Modal>
  );
}
