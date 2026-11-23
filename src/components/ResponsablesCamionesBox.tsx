// 🧑‍🔧 RESPONSABLES DE CAMIONES (23-nov-2026) — pedido del cliente: «poder crear
// uno o más responsables y asignarles un camión, un grupo o N camiones, aparte
// del responsable que ya está en el catálogo».
//
// Vive en «Viajes de camiones → ⚙️ Configuración», junto a «👤 Choferes por
// camión». Lista PROPIA del módulo: no toca `machinery.encargado`, no crea
// usuarios ni empleados. Igual molde que `ChoferesCamionesBox`: carga diferida
// al desplegar y aviso honesto si falta correr el SQL.
//
// REGLAS:
//  · Un camión le trabaja a UN responsable vigente a la vez.
//  · Asignar N camiones a la vez; si alguno le trabajaba a otro, pide confirmación.
//  · Quitar y desactivar CIERRAN vigencias / banderas: nunca hay DELETE.
//  · El historial se puede consultar; los viajes ya registrados no se tocan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import {
  SQL_RESPONSABLES, ETIQUETA_SIN_RESPONSABLE, nombreValidoResponsable,
  mapaNombresResponsables, responsableVigentePorCamion, conteoCamionesPorResponsable,
  planAsignarCamiones, type ResponsableCamion, type AsignacionResponsable,
} from '../lib/camionResponsables';
import {
  listarResponsablesCamiones, listarAsignacionesResponsables, crearResponsableCamion,
  editarResponsableCamion, activarResponsableCamion, asignarCamionesAResponsable,
  quitarCamionAResponsable,
} from '../lib/camionResponsablesDb';

export type CamionParaResponsable = {
  id: string; code: string; plate: string | null; serial: string | null; companyName?: string | null;
};

type Props = { camiones: CamionParaResponsable[]; uid: string | null; onChanged?: () => void };

type Formulario = { name: string; phone: string; cedula: string; note: string };
const FORM_VACIO: Formulario = { name: '', phone: '', cedula: '', note: '' };

function Boton({
  label, onPress, color, disabled,
}: { label: string; onPress: () => void; color: string; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm,
        borderWidth: 1, borderColor: color, opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const referencia = (c: CamionParaResponsable) =>
  `${c.code}${c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}`;

export function ResponsablesCamionesBox({ camiones, uid, onChanged }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();

  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [faltaSql, setFaltaSql] = useState(false);
  const [responsables, setResponsables] = useState<ResponsableCamion[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionResponsable[]>([]);
  const [form, setForm] = useState<Formulario>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [buscaCamion, setBuscaCamion] = useState('');
  const [historialCamion, setHistorialCamion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [resp, asig] = await Promise.all([listarResponsablesCamiones(), listarAsignacionesResponsables()]);
    setResponsables(resp.rows);
    setAsignaciones(asig.rows);
    setFaltaSql(resp.missing || asig.missing);
    setCargando(false);
  }, []);

  useEffect(() => { if (abierto) void cargar(); }, [abierto, cargar]);

  const nombres = useMemo(() => mapaNombresResponsables(responsables), [responsables]);
  const vigentes = useMemo(() => responsableVigentePorCamion(asignaciones), [asignaciones]);
  const conteo = useMemo(() => conteoCamionesPorResponsable(asignaciones), [asignaciones]);
  const asignados = useMemo(() => new Set(Object.keys(vigentes)), [vigentes]);
  const activos = responsables.filter((r) => r.active);
  const camionesFiltrados = useMemo(() => {
    const q = buscaCamion.trim().toLocaleLowerCase('es');
    return camiones
      .filter((c) => !q || referencia(c).toLocaleLowerCase('es').includes(q) || (c.companyName ?? '').toLocaleLowerCase('es').includes(q))
      .sort((a, b) => a.code.localeCompare(b.code, 'es') || (a.plate ?? '').localeCompare(b.plate ?? ''));
  }, [camiones, buscaCamion]);

  const guardarResponsable = async () => {
    if (!nombreValidoResponsable(form.name)) {
      toast.error('Escribe el nombre del responsable (al menos 2 letras).');
      return;
    }
    setGuardando(true);
    const datos = { name: form.name, phone: form.phone, cedula: form.cedula, note: form.note };
    const r = editandoId
      ? await editarResponsableCamion(editandoId, datos, uid)
      : await crearResponsableCamion(datos, uid);
    setGuardando(false);
    if (r.error) { toast.error(r.error); return; }
    toast.success(editandoId ? 'Responsable actualizado.' : 'Responsable creado. Ahora asígnale camiones.');
    setForm(FORM_VACIO);
    setEditandoId(null);
    await cargar();
    onChanged?.();
  };

  const cambiarActivo = async (r: ResponsableCamion) => {
    const ok = await confirm({
      title: r.active ? 'Desactivar responsable' : 'Reactivar responsable',
      message: r.active
        ? `¿Desactivar a ${r.name}? Dejará de SALIR en la lista, pero sus camiones actuales y el historial de viajes se conservan. Nada se borra.`
        : `¿Reactivar a ${r.name}?`,
      confirmText: r.active ? '⏸ Desactivar' : '▶ Reactivar',
      cancelText: 'Cancelar',
      danger: r.active,
    });
    if (!ok) return;
    const res = await activarResponsableCamion(r.id, !r.active, uid);
    if (res.error) { toast.error(res.error); return; }
    toast.success(r.active ? `${r.name} desactivado (historial conservado).` : `${r.name} reactivado.`);
    await cargar();
  };

  const abrirPanel = (r: ResponsableCamion) => {
    setPanelId(panelId === r.id ? null : r.id);
    setHistorialCamion(null);
    setBuscaCamion('');
    setSeleccion(new Set(asignaciones.filter((a) => a.hasta === null && a.responsable_id === r.id).map((a) => a.machinery_id)));
    setEditandoId(null);
    setForm(FORM_VACIO);
  };

  const guardarAsignacion = async (r: ResponsableCamion) => {
    if (guardando) return;
    const ids = Array.from(seleccion);
    const plan = planAsignarCamiones(asignaciones, r.id, ids, new Date().toISOString(), uid);
    if (plan.conflictos.length > 0) {
      const detalle = plan.conflictos.map((a) => {
        const c = camiones.find((x) => x.id === a.machinery_id);
        return `• ${referencia(c ?? { id: a.machinery_id, code: a.machinery_id, plate: null, serial: null })} → ${nombres[a.responsable_id] ?? 'otro'}`;
      }).join('\n');
      const ok = await confirm({
        title: 'Cambiar responsable de camiones',
        message: `Estos camiones le trabajaban a otro:\n${detalle}\n\nSe cerrará la asignación anterior (quedará en el historial) y se abrirá la nueva. Los viajes ya registrados NO cambian. ¿Continuar?`,
        confirmText: '✅ Cambiar',
        cancelText: 'Cancelar',
        danger: true,
      });
      if (!ok) return;
    }
    setGuardando(true);
    const res = await asignarCamionesAResponsable(r.id, ids, new Date().toISOString(), uid);
    setGuardando(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`${res.abiertos ?? ids.length} camión(es) asignado(s) a ${r.name}.`);
    await cargar();
    onChanged?.();
  };

  const quitarCamion = async (r: ResponsableCamion, machineryId: string) => {
    const c = camiones.find((x) => x.id === machineryId);
    const ok = await confirm({
      title: 'Quitar camión',
      message: `${referencia(c ?? { id: machineryId, code: machineryId, plate: null, serial: null })} dejará de trabajarle a ${r.name}. Se cierra la vigencia, no se borra nada. ¿Continuar?`,
      confirmText: '✕ Quitar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const res = await quitarCamionAResponsable(r.id, machineryId, new Date().toISOString(), uid);
    if (res.error) { toast.error(res.error); return; }
    setSeleccion((s) => { const n = new Set(s); n.delete(machineryId); return n; });
    toast.success('Camión quitado (historial conservado).');
    await cargar();
    onChanged?.();
  };

  const resumen = faltaSql
    ? 'Falta correr el SQL en Supabase'
    : `${activos.length} responsable(s) · ${asignados.size} camión(es) asignado(s)`;

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
      <TouchableOpacity
        onPress={() => setAbierto(!abierto)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>🧑‍🔧 Responsables de camiones</Text>
          <Text style={{ color: faltaSql ? colors.danger : colors.muted, fontSize: 11 }}>{resumen}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.sm }}>
          {faltaSql ? (
            <Text style={{ color: colors.danger, fontSize: 11, marginBottom: spacing.sm }}>
              ⚠️ Falta correr el SQL aditivo de responsables en Supabase ({SQL_RESPONSABLES}). Mientras tanto Viajes sigue funcionando como siempre.
            </Text>
          ) : null}
          {cargando ? <Text style={{ color: colors.muted, fontSize: 11 }}>Cargando…</Text> : null}

          {/* Alta / edición del responsable */}
          <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11, marginBottom: 6 }}>
              {editandoId ? 'EDITAR RESPONSABLE' : '+ NUEVO RESPONSABLE'}
            </Text>
            <TextInput
              value={form.name}
              onChangeText={(t) => setForm({ ...form, name: t })}
              placeholder="Nombre y apellido *"
              placeholderTextColor={colors.muted}
              style={{ color: colors.text, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 5, marginBottom: 5 }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                value={form.phone}
                onChangeText={(t) => setForm({ ...form, phone: t })}
                placeholder="Teléfono"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.text, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 5 }}
              />
              <TextInput
                value={form.cedula}
                onChangeText={(t) => setForm({ ...form, cedula: t })}
                placeholder="Cédula"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.text, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 5 }}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
              <Boton
                label={guardando ? 'Guardando…' : editandoId ? '💾 Guardar cambios' : '➕ Crear responsable'}
                onPress={guardarResponsable}
                color={colors.primary}
                disabled={guardando}
              />
              {editandoId ? (
                <Boton label="Cancelar" onPress={() => { setEditandoId(null); setForm(FORM_VACIO); }} color={colors.muted} />
              ) : null}
            </View>
          </View>

          {responsables.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 11 }}>Todavía no hay responsables. Crea el primero arriba.</Text>
          ) : null}

          {responsables.map((r) => {
            const abiertoPanel = panelId === r.id;
            const historia = asignaciones
              .filter((a) => a.machinery_id === historialCamion)
              .sort((a, b) => b.desde.localeCompare(a.desde));
            return (
              <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={() => abrirPanel(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: r.active ? colors.text : colors.muted, fontWeight: '800', fontSize: 13 }}>
                      {r.active ? '🧑‍🔧' : '⏸'} {r.name}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {conteo[r.id] ?? 0} camión(es) le trabajan
                      {r.phone ? ` · 📞 ${r.phone}` : ''}
                      {r.cedula ? ` · ${r.cedula}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{abiertoPanel ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Boton label="✏️ Editar" color={colors.muted} onPress={() => {
                    setEditandoId(r.id);
                    setForm({ name: r.name, phone: r.phone ?? '', cedula: r.cedula ?? '', note: r.note ?? '' });
                    setPanelId(null);
                  }} />
                  <Boton label={r.active ? '⏸ Desactivar' : '▶ Reactivar'} color={r.active ? colors.warning : colors.success} onPress={() => void cambiarActivo(r)} />
                </View>

                {abiertoPanel ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <TextInput
                      value={buscaCamion}
                      onChangeText={setBuscaCamion}
                      placeholder="Buscar camión por código, placa, serial o empresa"
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, marginBottom: 6 }}
                    />
                    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      <Boton label="☑ Seleccionar visibles" color={colors.muted} onPress={() => setSeleccion(new Set(camionesFiltrados.map((c) => c.id)))} />
                      <Boton label="☐ Limpiar" color={colors.muted} onPress={() => setSeleccion(new Set())} />
                      <Boton label={guardando ? 'Guardando…' : '💾 Guardar asignación'} color={colors.primary} onPress={() => void guardarAsignacion(r)} disabled={guardando} />
                    </View>
                    <ScrollView style={{ maxHeight: 240 }}>
                      {camionesFiltrados.map((c) => {
                        const puesto = seleccion.has(c.id);
                        const dueno = vigentes[c.id] ? nombres[vigentes[c.id]] ?? 'otro' : null;
                        return (
                          <View key={c.id} style={{ paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                            <TouchableOpacity onPress={() => {
                              setSeleccion((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; });
                            }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ color: colors.text, fontSize: 14 }}>{puesto ? '☑' : '☐'}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{referencia(c)}</Text>
                                <Text style={{ color: dueno && dueno !== r.name ? colors.warning : colors.muted, fontSize: 10 }}>
                                  {dueno ? `Le trabaja a: ${dueno}` : `Sin responsable · ${ETIQUETA_SIN_RESPONSABLE}`}
                                </Text>
                              </View>
                              {dueno === r.name ? (
                                <Boton label="✕" color={colors.danger} onPress={() => void quitarCamion(r, c.id)} />
                              ) : null}
                              <Boton label="📜" color={colors.muted} onPress={() => setHistorialCamion(historialCamion === c.id ? null : c.id)} />
                            </TouchableOpacity>
                            {historialCamion === c.id ? (
                              <View style={{ marginLeft: 22, marginTop: 4 }}>
                                {historia.length === 0 ? (
                                  <Text style={{ color: colors.muted, fontSize: 10 }}>Sin historial.</Text>
                                ) : historia.map((a) => (
                                  <Text key={a.id} style={{ color: colors.muted, fontSize: 10 }}>
                                    {a.desde.slice(0, 10)} → {a.hasta ? a.hasta.slice(0, 10) : 'vigente'} · {nombres[a.responsable_id] ?? 'otro'}
                                  </Text>
                                ))}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </ScrollView>
                    <Text style={{ color: colors.muted, fontSize: 10, marginTop: 6 }}>
                      Los cambios afectan los viajes que se registren DESPUÉS. Los viajes ya anotados conservan el responsable que tenían congelado. Nada se borra: cambiar cierra la vigencia anterior y abre otra.
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
