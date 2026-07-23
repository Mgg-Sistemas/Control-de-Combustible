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

// A dónde lleva "tocar" la notificación (mejor esfuerzo; si no aplica, no hace nada).
const DEST: Record<string, { tab?: string; screen: string }> = {
  requerimiento: { tab: 'More', screen: 'Inventario' },
  compra: { tab: 'More', screen: 'Compras' },
  cierre_control: { screen: 'ControlMaquinaria' },
};

/** Fecha/hora corta (Caracas) de una notificación. */
function whenLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const opts = { timeZone: 'America/Caracas' } as const;
    const fecha = d.toLocaleDateString('es-VE', { ...opts, day: '2-digit', month: '2-digit' });
    const hora = d.toLocaleTimeString('es-VE', { ...opts, hour: '2-digit', minute: '2-digit', hour12: true });
    return `${fecha} · ${hora}`;
  } catch {
    return '';
  }
}

/**
 * Campana de notificaciones del encabezado. Solo la ve el ADMIN (audiencia actual
 * de los avisos). Muestra un badge rojo con las NO leídas y un panel desplegable.
 * El estado "leído" es POR USUARIO (tabla notification_reads).
 */
export default function NotificationBell() {
  const { session, role } = useAuth();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const uid = session?.user?.id ?? null;

  const [items, setItems] = React.useState<AppNotification[]>([]);
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!isSupabaseConfigured || !uid || role !== 'admin') return;
    const { data: notifs } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    const list = (notifs as AppNotification[]) ?? [];
    setItems(list);
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

  const onTapItem = (n: AppNotification) => {
    markRead([n.id]);
    setOpen(false);
    goTo(n);
  };

  // Solo el admin recibe estos avisos: para el resto, ni se muestra la campana.
  if (role !== 'admin') return null;

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

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }} onPress={() => setOpen(false)}>
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              position: 'absolute', top: Platform.OS === 'web' ? 56 : 84, right: 10,
              width: 330, maxWidth: '92%', maxHeight: 460,
              backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
              overflow: 'hidden',
            }}
          >
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

            <ScrollView style={{ maxHeight: 400 }}>
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
                      onPress={() => onTapItem(n)}
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
                        {n.body ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{n.body}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>{whenLabel(n.created_at)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
