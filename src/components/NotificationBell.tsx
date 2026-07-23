import React from 'react';
import { Text, View, TouchableOpacity, Modal, Pressable, ScrollView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import type { AppNotification } from '../types/database';

// Ícono por tipo de evento (para reconocerlo de un vistazo en el panel).
const ICON: Record<string, string> = {
  requerimiento: '📝',
  compra: '🛒',
  cierre_control: '🛠️',
};

// Nombre del MÓDULO al que pertenece cada aviso (se muestra en el detalle).
const MODULE_LABEL: Record<string, string> = {
  requerimiento: 'Inventario · Requerimiento',
  compra: 'Compras · Solicitud',
  cierre_control: 'Control de maquinaria · Cierre',
};

// A dónde lleva "Ir al módulo" (mejor esfuerzo; si no aplica, no hace nada).
const DEST: Record<string, { tab?: string; screen: string }> = {
  requerimiento: { tab: 'More', screen: 'Inventario' },
  compra: { tab: 'More', screen: 'Compras' },
  cierre_control: { screen: 'ControlMaquinaria' },
};

/**
 * Sonido SUTIL de notificación (tipo iPhone), a volumen bajo para no ser invasivo.
 * Se sintetiza con Web Audio (dos notas suaves ascendentes); no requiere archivos.
 * Solo en web (plataforma principal). Si el navegador aún no permite audio, no falla.
 */
function playChime() {
  if (Platform.OS !== 'web') return;
  try {
    const w: any = globalThis;
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
    const t0 = ctx.currentTime;
    // Dos notas suaves (A5 → D6), volumen bajo (~0.10) y colita corta.
    ([[880, 0], [1174.66, 0.11]] as const).forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      const s = t0 + dt;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.10, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.38);
      o.start(s);
      o.stop(s + 0.4);
    });
    setTimeout(() => { try { ctx.close(); } catch {} }, 1200);
  } catch {}
}

/** Fecha/hora corta (Caracas) de una notificación. */
function whenLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const opts = { timeZone: 'America/Caracas' } as const;
    const fecha = d.toLocaleDateString('es-VE', { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = d.toLocaleTimeString('es-VE', { ...opts, hour: '2-digit', minute: '2-digit', hour12: true });
    return `${fecha} · ${hora}`;
  } catch {
    return '';
  }
}

/**
 * Campana de notificaciones del encabezado. Solo la ve el ADMIN (audiencia actual
 * de los avisos). Muestra un badge rojo con las NO leídas y un panel desplegable.
 * Al tocar un aviso se abre su DETALLE (módulo + detalle) con "Marcar como leída"
 * e "Ir al módulo". El estado "leído" es POR USUARIO (tabla notification_reads).
 */
export default function NotificationBell() {
  const { session, role } = useAuth();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const uid = session?.user?.id ?? null;

  const [items, setItems] = React.useState<AppNotification[]>([]);
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<AppNotification | null>(null);
  // IDs ya conocidos: para sonar SOLO cuando llega una nueva (no en la 1ra carga).
  const knownIds = React.useRef<Set<string> | null>(null);

  const load = React.useCallback(async () => {
    if (!isSupabaseConfigured || !uid || role !== 'admin') return;
    const { data: notifs } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    const list = (notifs as AppNotification[]) ?? [];
    setItems(list);
    // Sonido sutil al llegar una notificación NUEVA (no en la carga inicial).
    const ids = new Set(list.map((n) => n.id));
    if (knownIds.current && list.some((n) => !knownIds.current!.has(n.id))) playChime();
    knownIds.current = ids;
    if (list.length) {
      const { data: reads } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', uid)
        .in('notification_id', list.map((n) => n.id));
      setReadIds(new Set((reads ?? []).map((r: any) => r.notification_id)));
    } else {
      setReadIds(new Set());
    }
  }, [uid, role]);

  React.useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['notifications', 'notification_reads'], load);

  const unread = items.filter((n) => !readIds.has(n.id));
  const badge = unread.length;

  const markRead = React.useCallback(async (ids: string[]) => {
    if (!uid || !ids.length) return;
    setReadIds((prev) => { const s = new Set(prev); ids.forEach((id) => s.add(id)); return s; });
    await supabase.from('notification_reads').upsert(
      ids.map((id) => ({ notification_id: id, user_id: uid })),
      { onConflict: 'notification_id,user_id' }
    );
  }, [uid]);

  const goTo = React.useCallback((n: AppNotification) => {
    const dest = DEST[n.type];
    if (dest) {
      try {
        if (dest.tab) navigation.navigate(dest.tab, { screen: dest.screen });
        else navigation.navigate(dest.screen);
      } catch { try { navigation.navigate(dest.screen); } catch {} }
    }
  }, [navigation]);

  const closePanel = () => { setOpen(false); setDetail(null); };

  // Solo el admin recibe estos avisos: para el resto, ni se muestra la campana.
  if (role !== 'admin') return null;

  const detailUnread = detail ? !readIds.has(detail.id) : false;

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={{ paddingHorizontal: 10, paddingVertical: 4 }}
        accessibilityLabel={`Notificaciones${badge ? `, ${badge} sin leer` : ''}`}
      >
        <Text style={{ fontSize: 20 }}>🔔</Text>
        {badge > 0 ? (
          <View style={{
            position: 'absolute', top: 0, right: 2, minWidth: 16, height: 16, borderRadius: 8,
            backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
          }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={closePanel}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }} onPress={closePanel}>
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              position: 'absolute', top: Platform.OS === 'web' ? 56 : 84, right: 10,
              width: 340, maxWidth: '92%', maxHeight: 480,
              backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
              overflow: 'hidden',
            }}
          >
            {detail ? (
              // ── Vista de DETALLE de un aviso ─────────────────────────────
              <View>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
                }}>
                  <TouchableOpacity onPress={() => setDetail(null)} style={{ paddingRight: 4 }}>
                    <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>Detalle</Text>
                </View>
                <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 22 }}>{ICON[detail.type] ?? '🔔'}</Text>
                    <View style={{
                      backgroundColor: colors.background, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
                      borderWidth: 1, borderColor: colors.border,
                    }}>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                        {MODULE_LABEL[detail.type] ?? 'Notificación'}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{detail.title}</Text>
                  {detail.body ? <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>{detail.body}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🕒 {whenLabel(detail.created_at)}</Text>
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
                  {detailUnread ? (
                    <TouchableOpacity
                      onPress={() => markRead([detail.id])}
                      style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingVertical: 11, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>✓ Marcar como leída</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center', backgroundColor: colors.background }}>
                      <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }}>✓ Leída</Text>
                    </View>
                  )}
                  {DEST[detail.type] ? (
                    <TouchableOpacity
                      onPress={() => { markRead([detail.id]); const n = detail; closePanel(); goTo(n); }}
                      style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>Ir al módulo →</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : (
              // ── LISTA de avisos ──────────────────────────────────────────
              <View>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
                }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                    Notificaciones{badge ? ` · ${badge}` : ''}
                  </Text>
                  {badge > 0 ? (
                    <TouchableOpacity onPress={() => markRead(unread.map((n) => n.id))}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Marcar todo leído</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <ScrollView style={{ maxHeight: 420 }}>
                  {items.length === 0 ? (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ fontSize: 26 }}>🔕</Text>
                      <Text style={{ color: colors.muted, marginTop: 6 }}>Sin notificaciones</Text>
                    </View>
                  ) : (
                    items.map((n) => {
                      const isUnread = !readIds.has(n.id);
                      return (
                        <TouchableOpacity
                          key={n.id}
                          onPress={() => setDetail(n)}
                          style={{
                            flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 11,
                            borderBottomWidth: 1, borderBottomColor: colors.border,
                            backgroundColor: isUnread ? colors.background : 'transparent',
                          }}
                        >
                          <Text style={{ fontSize: 18 }}>{ICON[n.type] ?? '🔔'}</Text>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {isUnread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' }} /> : null}
                              <Text style={{ color: colors.text, fontWeight: isUnread ? '800' : '600', fontSize: 13, flex: 1 }}>{n.title}</Text>
                            </View>
                            {n.body ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{n.body}</Text> : null}
                            <Text style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>{whenLabel(n.created_at)}</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
