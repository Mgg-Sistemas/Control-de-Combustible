// 📝 La nota de «por qué no se ha pagado» en la tarjeta de cada cuenta de Por
// Pagar (04-nov-2026). Se ve SIN abrir la tarjeta. La escribe cualquiera que vea
// Por Pagar; la base pone el nombre y la hora. Nada se borra: se anula.
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import {
  LARGO_MAX_NOTA_ESPERA, NotaEspera, TABLA_NOTAS_ESPERA, cuandoNotaEspera, esTablaNotasFaltante,
  ultimaNotaActiva, validarNotaEspera,
} from '../lib/cuentaNotasEspera';

export function NotasEsperaCuenta(props: {
  cuentaId: string;
  notas: NotaEspera[];
  /** La cuenta sigue abierta (sin pagar ni anular): se invita a escribir. */
  abierta: boolean;
  miId: string | null;
  puedeAnularTodas: boolean;
  onCambio: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [escribiendo, setEscribiendo] = useState(false);
  const [texto, setTexto] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ultima = ultimaNotaActiva(props.notas);
  const anteriores = props.notas.filter((n) => n.id !== ultima?.id);

  const guardar = async () => {
    const err = validarNotaEspera(texto);
    if (err) { setError(err); return; }
    setOcupado(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from(TABLA_NOTAS_ESPERA)
        .insert({ cuenta_id: props.cuentaId, texto: texto.trim() })
        .select('id');
      if (e) throw e;
      if (!data || data.length === 0) throw new Error('La nota no se guardó (sin permiso para Por Pagar).');
      setTexto('');
      setEscribiendo(false);
      toast.success('📝 Nota guardada. Ya se ve en la cuenta.');
      props.onCambio();
    } catch (e: any) {
      const msg = esTablaNotasFaltante(e?.message)
        ? 'Las notas todavía no están activas en la base. Avísale a sistemas.'
        : (e?.message || 'No se pudo guardar la nota.');
      setError(msg);
    } finally {
      setOcupado(false);
    }
  };

  const anular = async (n: NotaEspera) => {
    const ok = await confirm({
      title: 'Anular nota',
      message: `La nota «${n.texto.slice(0, 80)}${n.texto.length > 80 ? '…' : ''}» quedará tachada (no se borra).`,
      confirmText: 'Anular nota',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      const { data, error: e } = await supabase
        .from(TABLA_NOTAS_ESPERA)
        .update({ anulada_at: new Date().toISOString() })
        .eq('id', n.id)
        .select('id');
      if (e) throw e;
      if (!data || data.length === 0) throw new Error('No tienes permiso para anular esa nota.');
      toast.success('Nota anulada.');
      props.onCambio();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo anular la nota.');
    } finally {
      setOcupado(false);
    }
  };

  const puedeAnular = (n: NotaEspera) => !n.anulada_at && (props.puedeAnularTodas || (!!props.miId && n.created_by === props.miId));

  const notaVista = (n: NotaEspera, destacada: boolean) => (
    <View key={n.id} style={{ marginTop: destacada ? 0 : 4, opacity: n.anulada_at ? 0.55 : 1 }}>
      <Text selectable style={{ color: colors.text, fontSize: destacada ? 12.5 : 11.5, lineHeight: 17, textDecorationLine: n.anulada_at ? 'line-through' : 'none' }}>
        {destacada ? <Text style={{ fontWeight: '900', color: colors.warningSoftText }}>📝 Por qué no se ha pagado: </Text> : null}
        {n.texto}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
          — {n.autor_nombre || 'Usuario'} · {cuandoNotaEspera(n.created_at)}
          {n.anulada_at ? ` · anulada por ${n.anulada_por_nombre || 'Usuario'} el ${cuandoNotaEspera(n.anulada_at)}` : ''}
        </Text>
        {puedeAnular(n) ? (
          <TouchableOpacity onPress={() => void anular(n)} disabled={ocupado} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={{ color: colors.danger, fontSize: 10.5, fontWeight: '800' }}>Anular</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  // Una cuenta cerrada sin notas no muestra nada (no hay nada que justificar).
  if (!props.abierta && props.notas.length === 0) return null;

  return (
    <View style={{
      marginTop: 5, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6,
      borderColor: ultima ? colors.warningSoftBorder : colors.border,
      backgroundColor: ultima ? colors.warningSoftBg : 'transparent',
    }}>
      {ultima ? notaVista(ultima, true) : (
        <Text style={{ color: colors.muted, fontSize: 11 }}>Sin nota de por qué no se ha pagado.</Text>
      )}

      {verTodas && anteriores.length > 0 ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 5, paddingTop: 3 }}>
          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '800' }}>Notas anteriores:</Text>
          {anteriores.map((n) => notaVista(n, false))}
        </View>
      ) : null}

      {escribiendo ? (
        <View style={{ marginTop: 6, gap: 4 }}>
          <TextInput
            value={texto}
            onChangeText={(t) => { setTexto(t); if (error) setError(null); }}
            placeholder="Ej.: Esperando que Tesorería apruebe la transferencia del lunes."
            placeholderTextColor={colors.muted}
            multiline
            maxLength={LARGO_MAX_NOTA_ESPERA}
            autoFocus
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.text, minHeight: 60, textAlignVertical: 'top' }}
          />
          {error ? <Text style={{ color: colors.danger, fontSize: 11.5, fontWeight: '700' }}>⚠️ {error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={() => void guardar()} disabled={ocupado}
              style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, opacity: ocupado ? 0.5 : 1 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{ocupado ? 'Guardando…' : '💾 Guardar nota'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setEscribiendo(false); setTexto(''); setError(null); }} disabled={ocupado}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 5, flexWrap: 'wrap' }}>
          <TouchableOpacity onPress={() => setEscribiendo(true)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 12 }}>📝 {ultima ? 'Agregar otra nota' : 'Agregar nota'}</Text>
          </TouchableOpacity>
          {anteriores.length > 0 ? (
            <TouchableOpacity onPress={() => setVerTodas((v) => !v)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12 }}>{verTodas ? '▲ Ocultar anteriores' : `▼ Ver anteriores (${anteriores.length})`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}
