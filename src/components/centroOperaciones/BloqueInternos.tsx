// 🏭 CENTRO DE OPERACIONES — 📅 PARTE DIARIO · 4) 🔁 MOVIMIENTO ENTRE PATIOS (11-nov-2026).
//
// «Mover los vestigios por m³ y viajes desde un patio a otro» (movimiento interno). Es el tipo
// «interno» de siempre (el de ✍️ Carga libre, que el Reporte completo y el Corte ya suman), a la
// vista y con un formulario corto: DESDE patio → HACIA patio (los patios que ella crea en ⚙️
// Ajustes), viajes y m³ por viaje (el total sale solo) o los m³ escritos, material opcional.
// La lógica (validar, resumen, balance) es `lib/centroOperacionesInternos.ts`.
//
// Lectura ve; Escritura anota y corrige; borrar pide Full (lo exige la base).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import { m3De } from '../../lib/centroOperaciones';
import type { Movimiento, Sitio } from '../../lib/centroOperaciones';
import { guardarMovimiento, borrarMovimiento } from '../../lib/centroOperacionesDb';
import {
  patiosActivos, materialesActivos, internosDelDia, resumenInternos, balancePorPatio,
  formInternoVacio, m3DelFormulario, validarInterno, type FormInterno,
} from '../../lib/centroOperacionesInternos';
import type { DatosSalidas } from './BloqueSalidas';

const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BloqueInternos({ sitio, nivel, fecha, datos, alSinGuardar, alResumen }: {
  sitio: Sitio;
  nivel: PermLevel;
  fecha: string;
  datos: DatosSalidas;
  alSinGuardar?: (v: boolean) => void;
  alResumen?: (texto: string) => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeEscribir = levelMeets(nivel, 'escritura');
  const puedeBorrar = levelMeets(nivel, 'full');

  const patios = useMemo(() => patiosActivos(datos.listas), [datos.listas]);
  const materiales = useMemo(() => materialesActivos(datos.listas), [datos.listas]);
  const lista = useMemo(() => internosDelDia(datos.delDia), [datos.delDia]);
  const balance = useMemo(() => balancePorPatio(lista), [lista]);

  const [form, setForm] = useState<FormInterno>(() => formInternoVacio(fecha));
  const [editando, setEditando] = useState<Movimiento | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);

  // Cambió el día: el formulario arranca limpio en ese día.
  useEffect(() => { setForm(formInternoVacio(fecha)); setEditando(null); setErrores([]); }, [fecha]);
  const resumen = resumenInternos(lista);
  useEffect(() => { alResumen?.(resumen); }, [resumen, alResumen]);
  const sucio = !!(form.origenId || form.destinoId || form.capacidad || form.m3 || form.observacion || form.materialId || form.viajes !== '1' || editando);
  useEffect(() => { alSinGuardar?.(sucio); }, [sucio, alSinGuardar]);

  const cambiar = (p: Partial<FormInterno>) => { setForm((f) => ({ ...f, ...p })); setErrores([]); };
  const total = m3DelFormulario(form);

  const guardar = async () => {
    const { errores: errs, datos: d } = validarInterno(form, datos.listas, caracasBusinessToday());
    if (errs.length) { setErrores(errs); return; }
    setGuardando(true);
    try {
      await guardarMovimiento(editando ? { ...d, id: editando.id } : { ...d, sitioId: sitio.id });
      toast.success(editando ? 'Movimiento corregido.' : `Movido: ${d.origen} → ${d.destino}.`);
      // Para cargar la serie rápido: se quedan los patios y el m³ por viaje.
      setForm(editando ? formInternoVacio(fecha) : { ...form, viajes: '1', m3: '', observacion: '' });
      setEditando(null);
      datos.recargar();
    } catch (e: any) {
      setErrores([e?.message || 'No se guardó.']);
    } finally {
      setGuardando(false);
    }
  };

  const editar = (m: Movimiento) => {
    setEditando(m);
    setErrores([]);
    setForm({
      fecha: m.fecha,
      origenId: m.origenId ?? patios.find((p) => p.nombre === m.origen)?.id ?? null,
      destinoId: m.destinoId ?? patios.find((p) => p.nombre === m.destino)?.id ?? null,
      viajes: m.viajes != null ? String(m.viajes) : '',
      capacidad: m.capacidadM3 != null ? String(m.capacidadM3).replace('.', ',') : '',
      m3: m.m3 != null ? String(m.m3).replace('.', ',') : '',
      materialId: m.materialId ?? null,
      observacion: m.observacion ?? '',
    });
  };

  const borrar = async (m: Movimiento) => {
    const ok = await confirm({ title: 'Borrar el movimiento', message: `¿Borrar ${m.origen ?? '—'} → ${m.destino ?? '—'} (${m.viajes ?? 0} viaje(s))? No se puede deshacer.`, confirmText: 'Borrar', cancelText: 'Cancelar' });
    if (!ok) return;
    try { await borrarMovimiento(m.id); toast.success('Movimiento borrado.'); datos.recargar(); }
    catch (e: any) { toast.error(e?.message || 'No se borró.'); }
  };

  const pill = (on: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface });
  const pillTxt = (on: boolean) => ({ color: on ? colors.primaryContrast : colors.text, fontWeight: '800' as const, fontSize: 13 });
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 15 } as const;
  const etiqueta = (t: string) => <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.xs }}>{t}</Text>;

  if (datos.listasCargadas && patios.length < 2) {
    return <Text style={{ color: colors.muted, fontSize: 13 }}>Para mover entre patios hacen falta al menos dos patios. Créalos en ⚙️ Ajustes → «⛰️ Patios».</Text>;
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {puedeEscribir ? (
        <View style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: editando ? colors.warning : colors.border, backgroundColor: colors.background, gap: 4 }}>
          {editando ? <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>✏️ Corrigiendo un movimiento</Text> : null}
          {etiqueta('DESDE EL PATIO')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {patios.map((p) => <TouchableOpacity key={p.id} onPress={() => cambiar({ origenId: p.id })} style={pill(form.origenId === p.id)}><Text style={pillTxt(form.origenId === p.id)}>⛰️ {p.nombre}</Text></TouchableOpacity>)}
          </View>
          {etiqueta('HACIA EL PATIO')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {patios.map((p) => {
              const igual = form.origenId === p.id;
              return <TouchableOpacity key={p.id} disabled={igual} onPress={() => cambiar({ destinoId: p.id })} style={[pill(form.destinoId === p.id), { opacity: igual ? 0.35 : 1 }]}><Text style={pillTxt(form.destinoId === p.id)}>⛰️ {p.nombre}</Text></TouchableOpacity>;
            })}
          </View>
          {materiales.length ? (
            <>
              {etiqueta('MATERIAL (OPCIONAL)')}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {materiales.map((p) => <TouchableOpacity key={p.id} onPress={() => cambiar({ materialId: form.materialId === p.id ? null : p.id })} style={pill(form.materialId === p.id)}><Text style={pillTxt(form.materialId === p.id)}>{p.nombre}</Text></TouchableOpacity>)}
              </View>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <View style={{ flexGrow: 1, flexBasis: 110 }}>{etiqueta('VIAJES')}<TextInput value={form.viajes} onChangeText={(t) => cambiar({ viajes: t })} keyboardType="numeric" style={input} /></View>
            <View style={{ flexGrow: 1, flexBasis: 130 }}>{etiqueta('M³ POR VIAJE')}<TextInput value={form.capacidad} onChangeText={(t) => cambiar({ capacidad: t })} keyboardType="decimal-pad" placeholder="Ej. 8" placeholderTextColor={colors.muted} style={input} /></View>
            <View style={{ flexGrow: 1, flexBasis: 150 }}>{etiqueta('M³ TOTALES (si los sabes)')}<TextInput value={form.m3} onChangeText={(t) => cambiar({ m3: t })} keyboardType="decimal-pad" placeholder={total != null && !form.m3 ? fmt(total) : 'Opcional'} placeholderTextColor={colors.muted} style={input} /></View>
          </View>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
            {total != null ? `= ${fmt(total)} m³ movidos` : 'Con viajes y m³ por viaje sale el total solo (o escribe los m³ totales).'}
          </Text>
          {etiqueta('OBSERVACIÓN (OPCIONAL)')}
          <TextInput value={form.observacion} onChangeText={(t) => cambiar({ observacion: t })} placeholder="Ej. con la payloader 2" placeholderTextColor={colors.muted} style={input} />
          {errores.map((e, i) => <Text key={i} style={{ color: colors.danger, fontSize: 12 }}>• {e}</Text>)}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            <TouchableOpacity disabled={guardando || !datos.listasCargadas} onPress={guardar} style={[pill(true), { opacity: guardando ? 0.6 : 1 }]}>
              <Text style={pillTxt(true)}>{guardando ? 'Guardando…' : editando ? '💾 Guardar corrección' : '💾 Guardar movimiento'}</Text>
            </TouchableOpacity>
            {editando || sucio ? (
              <TouchableOpacity onPress={() => { setEditando(null); setForm(formInternoVacio(fecha)); setErrores([]); }} style={pill(false)}><Text style={pillTxt(false)}>Cancelar</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Lo movido ese día (de este bloque o de ✍️ Carga libre) */}
      <Text style={{ color: colors.text, fontWeight: '900' }}>{resumen}</Text>
      {lista.map((m) => (
        <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>⛰️ {m.origen ?? '—'} → ⛰️ {m.destino ?? '—'}{m.estado === 'por_confirmar' ? '  (por confirmar)' : ''}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {m.viajes ?? 0} viaje(s){m.capacidadM3 != null ? ` × ${fmt(Number(m.capacidadM3))} m³` : ''}{m3De(m) != null ? ` = ${fmt(m3De(m) as number)} m³` : ''}{m.material ? ` · ${m.material}` : ''}{m.observacion ? ` · ${m.observacion}` : ''}
            </Text>
          </View>
          {puedeEscribir ? <TouchableOpacity onPress={() => editar(m)} style={pill(false)}><Text style={{ fontSize: 13 }}>✏️</Text></TouchableOpacity> : null}
          {puedeBorrar ? <TouchableOpacity onPress={() => borrar(m)} style={pill(false)}><Text style={{ fontSize: 13 }}>🗑️</Text></TouchableOpacity> : null}
        </View>
      ))}

      {/* Cuánto salió y entró de cada patio por movimiento interno ese día */}
      {balance.length ? (
        <View style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 2 }}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>POR PATIO (SOLO MOVIMIENTO INTERNO DE ESTE DÍA)</Text>
          {balance.map((b) => (
            <Text key={b.patio} style={{ color: colors.text, fontSize: 12 }}>
              ⛰️ {b.patio}: salieron {b.salenViajes} viaje(s) / {fmt(b.salenM3)} m³ · entraron {b.entranViajes} viaje(s) / {fmt(b.entranM3)} m³
            </Text>
          ))}
        </View>
      ) : null}
      {datos.errorDatos ? <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {datos.errorDatos}</Text> : null}
    </View>
  );
}

export default BloqueInternos;
