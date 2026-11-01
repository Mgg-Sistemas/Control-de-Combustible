// 🎭 FICHAS DE ROL (31-oct-2026) — el admin configura, por ROL DEL SISTEMA, los
// accesos por defecto a cada módulo y la vista al entrar en teléfono. Se guarda en
// la tabla role_templates; la app (AuthContext.moduleLevel) y la base (module_level
// / can_write_module) la leen en el mismo orden:
//   persona > rol personalizado > ficha del rol > fábrica.
// Una ficha vacía deja todo igual que antes. Los módulos sensibles no se configuran
// aquí: se dan persona por persona.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { norm } from '../lib/text';
import { Profile } from '../types/database';
import {
  MODULES, PermLevel, defaultLevel, roleLabel, ROLE_DESC,
  MODULOS_SOLO_POR_PERSONA, ROLES_CON_FICHA, ROLES_CON_VISTA_SISTEMA,
  fichaDesdeFila, type FichaRol, type VistaTelefono,
} from '../lib/permissions';

const NIVELES: { lvl: PermLevel; label: string }[] = [
  { lvl: 'none', label: 'Sin' },
  { lvl: 'lectura', label: 'Lectura' },
  { lvl: 'escritura', label: 'Escritura' },
  { lvl: 'full', label: 'Full' },
];
const NOMBRE_NIVEL: Record<PermLevel, string> = { none: 'sin acceso', lectura: 'lectura', escritura: 'escritura', full: 'full' };

/** Nivel de fábrica de un rol del sistema (lo que diría el código sin ficha). */
export function nivelDeFabrica(rol: string, moduleKey: string): PermLevel {
  if (rol === 'analista' && moduleKey === 'asistencia') return 'escritura';
  return defaultLevel(moduleKey);
}

const VISTAS: { v: VistaTelefono; label: string; desc: string; soloSistema?: boolean }[] = [
  { v: 'auto', label: 'La de siempre', desc: 'Entra a la pantalla que su rol tiene hoy.' },
  { v: 'propia_sistema', label: 'Su vista + botón SISTEMA', desc: 'Entra a la vista de inspector y con SISTEMA salta a la app completa.', soloSistema: true },
  { v: 'completa', label: 'App completa', desc: 'Entra a la app con los módulos que tenga permitidos.' },
];

export function FichasDeRolModal({ visible, onClose, users }: { visible: boolean; onClose: () => void; users: Profile[] }) {
  const { colors } = useTheme();
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [fichas, setFichas] = useState<Record<string, FichaRol>>({});
  const [cargando, setCargando] = useState(false);
  const [rolSel, setRolSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<FichaRol | null>(null);
  const [q, setQ] = useState('');
  const [propios, setPropios] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);

  // Personas a las que les aplica la ficha: activas, con ese rol y SIN rol personalizado.
  const personasDe = (rol: string) => users.filter((u) => u.active !== false && u.role === rol && !(u as any).app_role_id && !(u as any).archivado_en);

  const cargar = async () => {
    setCargando(true);
    const { data, error } = await supabase.from('role_templates').select('rol, modules, vista_telefono');
    setCargando(false);
    if (error) { toast.error(`No se pudieron leer las fichas de rol: ${error.message}`); return; }
    const map: Record<string, FichaRol> = {};
    (data ?? []).forEach((r: any) => { map[r.rol] = fichaDesdeFila(r); });
    setFichas(map);
  };
  useEffect(() => { if (visible) { cargar(); setRolSel(null); setDraft(null); } }, [visible]);

  const abrir = async (rol: string) => {
    setRolSel(rol);
    setQ('');
    setDraft(fichas[rol] ? { modules: { ...fichas[rol].modules }, vista_telefono: fichas[rol].vista_telefono } : { modules: {}, vista_telefono: 'auto' });
    // Cuántas personas de este rol tienen un permiso PROPIO por módulo (ese manda sobre la ficha).
    const ids = personasDe(rol).map((u) => u.id);
    if (!ids.length) { setPropios({}); return; }
    const { data } = await supabase.from('module_permissions').select('module').in('user_id', ids);
    const cuenta: Record<string, number> = {};
    (data ?? []).forEach((r: any) => { cuenta[r.module] = (cuenta[r.module] ?? 0) + 1; });
    setPropios(cuenta);
  };

  const modulosVisibles = useMemo(() => {
    const t = norm(q);
    return MODULES.filter((m) => !t || norm(m.label).includes(t) || norm(m.key).includes(t));
  }, [q]);

  const cambiosPendientes = useMemo(() => {
    if (!rolSel || !draft) return 0;
    const orig = fichas[rolSel] ?? { modules: {}, vista_telefono: 'auto' as VistaTelefono };
    const keys = new Set([...Object.keys(orig.modules), ...Object.keys(draft.modules)]);
    let n = 0;
    keys.forEach((k) => { if (orig.modules[k] !== draft.modules[k]) n++; });
    if (orig.vista_telefono !== draft.vista_telefono) n++;
    return n;
  }, [rolSel, draft, fichas]);

  const ponerNivel = (k: string, lvl: PermLevel) => {
    if (!draft || !rolSel) return;
    const mods = { ...draft.modules };
    // Si el nivel elegido es el de fábrica, no se guarda nada: el módulo sigue «de fábrica».
    if (lvl === nivelDeFabrica(rolSel, k)) delete mods[k]; else mods[k] = lvl;
    setDraft({ ...draft, modules: mods });
  };

  const guardar = async () => {
    if (!rolSel || !draft) return;
    const n = personasDe(rolSel).length;
    const ok = await confirm({
      title: `Guardar la ficha de «${roleLabel(rolSel)}»`,
      message: `Esto afecta a ${n} persona(s) con este rol (sin rol personalizado). Los permisos propios de cada persona se respetan. Los accesos se aplican en vivo; la vista en teléfono, la próxima vez que entren.`,
      confirmText: 'Guardar',
    });
    if (!ok) return;
    const limpio: Record<string, PermLevel> = {};
    Object.keys(draft.modules).forEach((k) => { if (!MODULOS_SOLO_POR_PERSONA.includes(k)) limpio[k] = draft.modules[k]; });
    const vista: VistaTelefono = draft.vista_telefono === 'propia_sistema' && !ROLES_CON_VISTA_SISTEMA.includes(rolSel) ? 'auto' : draft.vista_telefono;
    setGuardando(true);
    const { data, error } = await supabase
      .from('role_templates')
      .update({ modules: limpio, vista_telefono: vista, updated_by: session?.user?.id ?? null, updated_at: new Date().toISOString() })
      .eq('rol', rolSel)
      .select('rol');
    setGuardando(false);
    // Nada de éxito falso: si la base no devolvió la fila, no se guardó.
    if (error) { toast.error(`No se guardó: ${error.message}`); return; }
    if (!data || data.length === 0) { toast.error('No se guardó: la base no aceptó el cambio (¿sesión de administrador?).'); return; }
    toast.success(`Ficha de «${roleLabel(rolSel)}» guardada.`);
    await cargar();
    setRolSel(null);
    setDraft(null);
  };

  const chip = (on: boolean, disabled?: boolean) => ({
    flexGrow: 1, minWidth: 64, paddingVertical: 7, paddingHorizontal: 6, borderRadius: radius.md, borderWidth: 1,
    borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface,
    alignItems: 'center' as const, opacity: disabled ? 0.45 : 1,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%', maxWidth: 720, alignSelf: 'center', maxHeight: '92%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, flex: 1 }} numberOfLines={1}>
              {rolSel ? `🎭 ${roleLabel(rolSel)}` : '🎭 Accesos por rol'}
            </Text>
            <TouchableOpacity onPress={() => (rolSel ? (setRolSel(null), setDraft(null)) : onClose())} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{rolSel ? '‹ Roles' : 'Cerrar'}</Text>
            </TouchableOpacity>
          </View>

          {cargando ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : null}

          {!rolSel ? (
            <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.md }}>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                Lo que configures aquí es lo que tiene cada rol por defecto. Lo que le pusiste a una persona en sus permisos manda sobre esto. Los roles personalizados no cambian.
              </Text>
              {ROLES_CON_FICHA.map((r) => {
                const f = fichas[r];
                const n = personasDe(r).length;
                const nMods = f ? Object.keys(f.modules).length : 0;
                const vista = VISTAS.find((x) => x.v === (f?.vista_telefono ?? 'auto'))!;
                return (
                  <TouchableOpacity key={r} onPress={() => abrir(r)} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{roleLabel(r)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{n} persona(s) ›</Text>
                    </View>
                    {ROLE_DESC[r] ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{ROLE_DESC[r]}</Text> : null}
                    <Text style={{ color: nMods || vista.v !== 'auto' ? colors.primary : colors.muted, fontSize: 11, fontWeight: '700', marginTop: 4 }}>
                      {nMods ? `${nMods} módulo(s) configurado(s)` : 'Todo de fábrica'} · 📱 {vista.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : draft ? (
            <>
              <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>📱 VISTA AL ENTRAR EN TELÉFONO</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {VISTAS.filter((x) => !x.soloSistema || ROLES_CON_VISTA_SISTEMA.includes(rolSel)).map((x) => {
                    const on = draft.vista_telefono === x.v;
                    return (
                      <TouchableOpacity key={x.v} onPress={() => setDraft({ ...draft, vista_telefono: x.v })} style={{ flexGrow: 1, minWidth: 150, flexBasis: 150, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{on ? '● ' : '○ '}{x.label}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>{x.desc}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }}>En PC no cambia. Se aplica la próxima vez que la persona abra la app.</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, gap: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>ACCESOS POR DEFECTO</Text>
                  {Object.keys(draft.modules).length ? (
                    <TouchableOpacity onPress={() => setDraft({ ...draft, modules: {} })}>
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800' }}>↺ Todo de fábrica</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar módulo…" placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />

                {modulosVisibles.map((m) => {
                  const sensible = MODULOS_SOLO_POR_PERSONA.includes(m.key);
                  const fabrica = nivelDeFabrica(rolSel, m.key);
                  const config = draft.modules[m.key];
                  const efectivo = sensible ? fabrica : (config ?? fabrica);
                  const nPropios = propios[m.key] ?? 0;
                  return (
                    <View key={m.key} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flexShrink: 1 }}>{m.label}</Text>
                        <Text style={{ color: sensible ? colors.muted : config ? colors.primary : colors.muted, fontSize: 11, fontWeight: '700' }}>
                          {sensible ? '🔒 solo por persona' : config ? `configurado (fábrica: ${NOMBRE_NIVEL[fabrica]})` : 'de fábrica'}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {NIVELES.map((n) => (
                          <TouchableOpacity key={n.lvl} disabled={sensible} onPress={() => ponerNivel(m.key, n.lvl)} style={chip(efectivo === n.lvl, sensible)}>
                            <Text style={{ color: efectivo === n.lvl ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '800' }}>{n.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {nPropios > 0 && !sensible ? (
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>👤 {nPropios} persona(s) de este rol tienen permiso propio aquí: el suyo manda.</Text>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
              <TouchableOpacity disabled={guardando || cambiosPendientes === 0} onPress={guardar}
                style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: cambiosPendientes ? colors.brand : colors.surfaceAlt, opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: cambiosPendientes ? colors.brandContrast : colors.muted, fontWeight: '800' }}>
                  {guardando ? 'Guardando…' : cambiosPendientes ? `Guardar (${cambiosPendientes} cambio(s))` : 'Sin cambios'}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
