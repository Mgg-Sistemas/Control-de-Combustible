// 🏗️ EQUIPOS DE TRITURACIÓN DEL SITIO (06-nov-2026). Dentro de ⚙️ Ajustes (solo Full).
//
// Los equipos que salen en 📅 Parte diario → 2 · ⚙️ Producción de trituración: la
// Trituradora 1, la 2 (Ecosocialismo, por reparar) y el cono triturador (por comprar).
// Pedido: «créalo de una vez con las tres; si no los tengo, quedan vacíos». Por eso un
// equipo que todavía no está en sitio se deja DADO DE BAJA (inactivo) y se ACTIVA aquí el
// día que llegue: no hay que tocar el sistema.
//   · Nombre, tipo (trituradora / cono / otro), código y serial, y las t/h POR DEFECTO
//     (lo que se propone al anotar; ella las cambia cada vez según la mandíbula).
//   · Dar de baja NO borra: lo anotado de ese equipo se queda en los papeles. Un equipo
//     nunca se borra.
//   · Cambiar la t/h por defecto NO cambia lo ya anotado (cada línea guardó la suya).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Card } from '../ui';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import type { Sitio } from '../../lib/centroOperaciones';
import { FALTA_TABLA_PRODUCCION, cargarEquiposTrituracion, guardarEquipoTrituracion } from '../../lib/centroOperacionesDb';
import {
  TIPOS_EQUIPO, etiquetaTipo, fmtN, formDeEquipo, formEquipoVacio, revisarEquipo,
} from '../../lib/centroOperacionesProduccion';
import type { EquipoTrituracion, FormEquipo } from '../../lib/centroOperacionesProduccion';

export default function EquiposTrituracionAjustes({ sitio }: { sitio: Sitio }) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [equipos, setEquipos] = useState<EquipoTrituracion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** El formulario abierto: null = cerrado; editandoId null = equipo nuevo. */
  const [form, setForm] = useState<{ editandoId: string | null; f: FormEquipo } | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setEquipos(await cargarEquiposTrituracion(sitio.id));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los equipos de trituración.');
    }
  }, [sitio]);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = equipos ?? [];
  const cambiar = (patch: Partial<FormEquipo>) => setForm((x) => (x ? { ...x, f: { ...x.f, ...patch } } : x));

  const guardar = async () => {
    if (!form || ocupado) return;
    const r = revisarEquipo(form.f, lista, form.editandoId);
    if (!r.ok) { setErrorForm(r.error); return; }
    setOcupado(true); setErrorForm(null);
    try {
      const orden = form.editandoId ? undefined : (lista.reduce((m, e) => Math.max(m, e.orden), 0) + 1);
      await guardarEquipoTrituracion({
        ...(form.editandoId ? { id: form.editandoId } : { sitioId: sitio.id, activo: true, orden }),
        nombre: form.f.nombre, tipo: form.f.tipo, codigo: form.f.codigo, serial: form.f.serial, thDefecto: r.thDefecto, nota: form.f.nota,
      });
      toast.success(form.editandoId ? 'Equipo actualizado.' : `«${form.f.nombre.trim()}» agregado: ya sale en el Parte diario.`);
      setForm(null);
    } catch (e: any) {
      setErrorForm(e?.message || 'No se guardó el equipo.');
    } finally {
      setOcupado(false);
      cargar();
    }
  };

  const cambiarActivo = async (e: EquipoTrituracion) => {
    if (ocupado) return;
    if (e.activo) {
      const si = await confirm({
        title: 'Dar de baja el equipo',
        message: `«${e.nombre}» deja de salir en el Parte diario para anotarle producción. Lo ya anotado NO se borra y sigue en los papeles. Se puede volver a activar cuando quieras.`,
        confirmText: 'Dar de baja',
      });
      if (!si) return;
    } else if (lista.some((x) => x.activo && x.id !== e.id && x.nombre.trim().toLowerCase() === e.nombre.trim().toLowerCase())) {
      toast.error(`Ya hay otro equipo activo llamado «${e.nombre}»: cámbiale el nombre a uno antes de activarlo.`);
      return;
    }
    setOcupado(true);
    try {
      await guardarEquipoTrituracion({ id: e.id, activo: !e.activo });
      toast.success(e.activo ? `«${e.nombre}» dado de baja.` : `«${e.nombre}» activado: ya sale en el Parte diario.`);
    } catch (err: any) {
      toast.error(err?.message || 'No se guardó el cambio.');
    } finally {
      setOcupado(false);
      cargar();
    }
  };

  // ── Estilos ──
  const titulo = { color: colors.brandText, fontSize: 15, fontWeight: '900' as const };
  const ayuda = { color: colors.muted, fontSize: 12 };
  const rotulo = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.sm };
  const input = {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginTop: 2, fontSize: 16,
  } as const;
  const pastilla = (activa: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
    borderColor: activa ? colors.primary : colors.border, backgroundColor: activa ? colors.primary : colors.surface,
  });
  const boton = (principal: boolean) => ({
    borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center' as const,
    backgroundColor: principal ? colors.primary : colors.surface, borderWidth: 1, borderColor: principal ? colors.primary : colors.border, opacity: ocupado ? 0.5 : 1,
  });

  const formulario = form ? (
    <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md }}>
      <Text style={{ color: colors.text, fontWeight: '900' }}>{form.editandoId ? '✏️ Editar equipo' : '➕ Nuevo equipo de trituración'}</Text>
      <Text style={rotulo}>NOMBRE *</Text>
      <TextInput value={form.f.nombre} onChangeText={(t) => cambiar({ nombre: t })} placeholder="Ej.: Trituradora 1" placeholderTextColor={colors.muted} style={input} />
      <Text style={rotulo}>TIPO</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 }}>
        {TIPOS_EQUIPO.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => cambiar({ tipo: t.key })} style={pastilla(form.f.tipo === t.key)}>
            <Text style={{ color: form.f.tipo === t.key ? colors.primaryContrast : colors.text, fontWeight: '800' }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <Text style={rotulo}>CÓDIGO (OPCIONAL)</Text>
          <TextInput value={form.f.codigo} onChangeText={(t) => cambiar({ codigo: t })} placeholder="Ej.: TR-01" placeholderTextColor={colors.muted} style={input} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <Text style={rotulo}>SERIAL (OPCIONAL)</Text>
          <TextInput value={form.f.serial} onChangeText={(t) => cambiar({ serial: t })} placeholderTextColor={colors.muted} style={input} />
        </View>
      </View>
      <Text style={rotulo}>TONELADAS POR HORA POR DEFECTO (OPCIONAL)</Text>
      <TextInput value={form.f.th} onChangeText={(t) => cambiar({ th: t })} placeholder="Ej.: 250" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={input} />
      <Text style={ayuda}>Es lo que se propone al anotar; cada día se puede cambiar. Cambiarlo aquí no mueve lo ya anotado.</Text>
      <Text style={rotulo}>NOTA (OPCIONAL)</Text>
      <TextInput value={form.f.nota} onChangeText={(t) => cambiar({ nota: t })} placeholderTextColor={colors.muted} style={input} />
      {errorForm ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>❌ {errorForm}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
        <TouchableOpacity onPress={guardar} disabled={ocupado} style={[boton(true), { flexGrow: 1 }]}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{ocupado ? 'Guardando…' : '💾 Guardar'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setForm(null); setErrorForm(null); }} disabled={ocupado} style={[boton(false), { flexGrow: 1 }]}>
          <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null;

  return (
    <Card>
      <Text style={titulo}>🏗️ Equipos de trituración · {sitio.nombre}</Text>
      <Text style={ayuda}>
        Los que salen en 📅 Parte diario → 2 · ⚙️ Producción de trituración. Un equipo que todavía no está en sitio se deja dado de baja y se activa aquí el día que llegue.
      </Text>
      {error ? (
        <View style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {error}</Text>
          {error !== FALTA_TABLA_PRODUCCION ? (
            <TouchableOpacity onPress={cargar} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              <Text style={{ color: colors.danger, fontWeight: '800' }}>🔄 Reintentar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : equipos === null ? (
        <Text style={ayuda}>Cargando…</Text>
      ) : (
        <View style={{ marginTop: spacing.xs }}>
          {!lista.length ? <Text style={ayuda}>Todavía no hay equipos. Agrega el primero.</Text> : null}
          {lista.map((e) => (
            <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xs, opacity: e.activo ? 1 : 0.75 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }}>
                <View style={{ flex: 1, minWidth: 180 }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>{e.nombre} {e.activo ? '' : '· ⏸️ dado de baja'}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {[etiquetaTipo(e.tipo), e.codigo ? `Código ${e.codigo}` : '', e.serial ? `Serial ${e.serial}` : '', e.thDefecto ? `${fmtN(e.thDefecto)} t/h por defecto` : 'sin t/h por defecto'].filter(Boolean).join(' · ')}
                  </Text>
                  {e.nota ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>📝 {e.nota}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => { setForm({ editandoId: e.id, f: formDeEquipo(e) }); setErrorForm(null); }} disabled={ocupado} style={boton(false)}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>✏️ Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => cambiarActivo(e)} disabled={ocupado} style={boton(false)}>
                  <Text style={{ color: e.activo ? colors.warning : colors.success, fontWeight: '800', fontSize: 12 }}>{e.activo ? '⏸️ Dar de baja' : '↩️ Activar'}</Text>
                </TouchableOpacity>
              </View>
              {form?.editandoId === e.id ? formulario : null}
            </View>
          ))}
          {form && !form.editandoId ? formulario : (
            !form ? (
              <TouchableOpacity onPress={() => { setForm({ editandoId: null, f: formEquipoVacio() }); setErrorForm(null); }} style={[boton(true), { alignSelf: 'flex-start', marginTop: spacing.sm }]}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>➕ Agregar equipo</Text>
              </TouchableOpacity>
            ) : null
          )}
        </View>
      )}
    </Card>
  );
}
