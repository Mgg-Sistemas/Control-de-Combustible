// 🧾 ACOMODAR EL HORÓMETRO DESDE CONTROL DE HORÓMETROS (02-oct-2026).
//
// Pedido del cliente: «poder acomodar el horómetro para el reporte de horómetros
// y poder modificar el horómetro que cargó el inspector, a la vez tener la opción
// de que ese horómetro que yo cargue me salga SOLO para el reporte de horómetros,
// o que me modifique el que cargó el inspector en ese día en específico».
//
// DOS DESTINOS, y se elige acá:
//   · 🧾 SOLO PARA CONTROL DE HORÓMETROS → un ajuste en `horometro_ajustes`. Lo
//     que cargó el inspector NO se toca; este módulo y su reporte usan el ajuste.
//   · ✎ CAMBIAR LA LECTURA DEL INSPECTOR → la corrección de Control de siempre
//     (origen 'control'): cambia en todas partes y la base exige el módulo
//     `horometros` (admin). Si el usuario no lo tiene, este destino no se ofrece.
//
// El motivo es obligatorio en los dos. Nada toca Control de jornadas.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { LecturaTrabajo, numeroDeTexto, soloHorometro, validarCorreccionHorometro } from '../lib/horometroTrabajo';
import { guardarLecturaHorometro } from '../lib/horometroTrabajoDb';
import { AjusteHorometro, validarAjusteHorometro } from '../lib/pagoHorometro';
import { anularAjustesHorometro, guardarAjusteHorometro } from '../lib/pagoHorometroDb';

type Props = {
  code: string;
  machineryId: string;
  /** El día con el que abre (se puede cambiar dentro). */
  roundDate: string;
  /** Las lecturas del inspector de ESA máquina en el rango cargado. */
  lecturas: readonly LecturaTrabajo[];
  /** Los ajustes de ESA máquina en el rango cargado. */
  ajustes: readonly AjusteHorometro[];
  /** Tiene el módulo `horometros` con escritura: puede cambiar la lectura del inspector. */
  puedeCambiarInspector: boolean;
  onClose: () => void;
  onSaved: (mensaje: string) => void;
};

type Destino = 'horometros' | 'inspector';
const fmt = (n: number | string | null | undefined) => (n == null || n === '' ? '' : String(n));
const dmy = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');

export function HorometroAjusteModal({ code, machineryId, roundDate, lecturas, ajustes, puedeCambiarInspector, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const [fecha, setFecha] = useState(roundDate);
  const [turno, setTurno] = useState<'day' | 'night'>('day');
  const [destino, setDestino] = useState<Destino>('horometros');
  const [ini, setIni] = useState('');
  const [fin, setFin] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delInspector = useMemo(
    () => lecturas.find((l) => String(l.roundDate).slice(0, 10) === fecha && l.shift === turno) ?? null,
    [lecturas, fecha, turno],
  );
  const ajusteVigente = useMemo(() => {
    const act = ajustes.filter((a) => !a.anulada_at && String(a.round_date).slice(0, 10) === fecha && a.shift === turno);
    return act.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null;
  }, [ajustes, fecha, turno]);

  // Al cambiar de día o turno se precarga lo que VALE hoy para este módulo:
  // el ajuste si lo hay, y si no, lo que cargó el inspector.
  useEffect(() => {
    setIni(fmt(ajusteVigente ? ajusteVigente.inicial : delInspector?.inicial));
    setFin(fmt(ajusteVigente ? ajusteVigente.final : delInspector?.final));
    setError(null);
  }, [fecha, turno, ajusteVigente?.id, delInspector?.inicial, delInspector?.final]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setError('Elige el día.'); return; }
    setError(null);
    if (destino === 'horometros') {
      const malo = validarAjusteHorometro({ inicial: ini, final: fin, motivo });
      if (malo) { setError(malo); return; }
      setBusy(true);
      const r = await guardarAjusteHorometro({
        machineryId, roundDate: fecha, shift: turno,
        inicial: Number(ini.replace(',', '.')), final: Number(fin.replace(',', '.')), motivo: motivo.trim(),
      });
      setBusy(false);
      if (r.error) { setError(r.error); return; }
      onSaved(`🧾 Ajuste guardado para ${code} el ${dmy(fecha)}: vale solo en Control de horómetros. Lo que cargó el inspector no cambió.`);
      onClose();
      return;
    }
    // ✎ Cambiar la lectura del inspector (corrección de Control de siempre).
    const malo = validarCorreccionHorometro({ inicial: ini, final: fin, motivo });
    if (malo) { setError(malo); return; }
    setBusy(true);
    const r = await guardarLecturaHorometro(machineryId, fecha, turno, {
      inicial: numeroDeTexto(ini) === false ? null : (numeroDeTexto(ini) as number | null),
      final: numeroDeTexto(fin) === false ? null : (numeroDeTexto(fin) as number | null),
      origen: 'control',
      motivoCorreccion: motivo.trim(),
    });
    if (!r.ok) { setBusy(false); setError(r.error ?? 'No se guardó. Intenta de nuevo.'); return; }
    // Si había un ajuste «solo horómetros» para ese turno, seguiría tapando la
    // lectura recién corregida: se anula para que mande la lectura nueva.
    if (ajusteVigente) await anularAjustesHorometro(machineryId, fecha, turno, 'Reemplazado: se cambió la lectura del inspector');
    setBusy(false);
    onSaved(`✎ Lectura del inspector cambiada para ${code} el ${dmy(fecha)}. Cambia también en el reporte ⚙️ Horómetro.`);
    onClose();
  };

  const quitarAjuste = async () => {
    if (busy || !ajusteVigente) return;
    if (!motivo.trim()) { setError('Escribe el motivo para quitar el ajuste.'); return; }
    setBusy(true);
    const r = await anularAjustesHorometro(machineryId, fecha, turno, motivo.trim());
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onSaved(`Ajuste quitado para ${code} el ${dmy(fecha)}: vuelve a valer lo que cargó el inspector.`);
    onClose();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const pastilla = (on: boolean) => ({ flex: 1, alignItems: 'center' as const, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,15,25,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 480, backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>⚙️ Acomodar el horómetro · {code}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm }}>No toca Control de jornadas ni sus horas.</Text>

          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Día</Text>
          <DateField value={fecha} onChange={setFecha} />
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.sm }}>
            {(['day', 'night'] as const).map((t) => (
              <TouchableOpacity key={t} onPress={() => setTurno(t)} style={pastilla(turno === t)}>
                <Text style={{ color: turno === t ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>{t === 'day' ? '☀️ Día' : '🌙 Noche'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={{ color: colors.muted, fontSize: 11 }}>
            Lo que cargó el inspector: {delInspector ? `inicial ${delInspector.inicial ?? '—'} · final ${delInspector.final ?? '—'}${delInspector.valida === false ? ` · ⚠️ ${delInspector.motivoInvalida || 'inválida'}` : ''}` : 'nada en ese turno'}
          </Text>
          {ajusteVigente ? (
            <Text style={{ color: colors.brandText, fontSize: 11, marginBottom: spacing.xs }}>
              🧾 Ajuste vigente: inicial {String(ajusteVigente.inicial)} · final {String(ajusteVigente.final)} — {ajusteVigente.motivo}{ajusteVigente.created_by_nombre ? ` (${ajusteVigente.created_by_nombre})` : ''}
            </Text>
          ) : <View style={{ height: spacing.xs }} />}

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro inicial</Text>
              <TextInput value={ini} onChangeText={(t) => setIni(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Horómetro final</Text>
              <TextInput value={fin} onChangeText={(t) => setFin(soloHorometro(t))} keyboardType="numeric" inputMode="decimal" placeholder="—" placeholderTextColor={colors.muted} style={input} />
            </View>
          </View>

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>¿Dónde vale este cambio?</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <TouchableOpacity onPress={() => setDestino('horometros')} style={pastilla(destino === 'horometros')}>
              <Text style={{ color: destino === 'horometros' ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12, textAlign: 'center' }}>🧾 Solo para Control de horómetros</Text>
            </TouchableOpacity>
            {puedeCambiarInspector ? (
              <TouchableOpacity onPress={() => setDestino('inspector')} style={pastilla(destino === 'inspector')}>
                <Text style={{ color: destino === 'inspector' ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12, textAlign: 'center' }}>✎ Cambiar la lectura del inspector</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, marginBottom: spacing.sm }}>
            {destino === 'horometros'
              ? 'Vale para el pago y el reporte de Control de horómetros. Lo que cargó el inspector queda igual, y el reporte ⚙️ Horómetro vs jornada lo sigue mostrando tal cual.'
              : 'Cambia la lectura del inspector de ese día en TODAS partes (también en el reporte ⚙️ Horómetro), y queda marcada «corregido desde Control».'}
          </Text>

          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Motivo · OBLIGATORIO (queda grabado con tu nombre)</Text>
          <TextInput value={motivo} onChangeText={setMotivo} placeholder="Ej.: el tablero marcaba 1.250,4 y se tecleó 1.205,4" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 50, textAlignVertical: 'top', marginBottom: spacing.sm }]} />

          {error ? <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>❌ {error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity onPress={onClose} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={guardar} disabled={busy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Guardando…' : '💾 Guardar'}</Text>
            </TouchableOpacity>
          </View>
          {ajusteVigente ? (
            <TouchableOpacity onPress={quitarAjuste} disabled={busy} style={{ marginTop: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>↺ Quitar el ajuste (vuelve a valer lo del inspector)</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
