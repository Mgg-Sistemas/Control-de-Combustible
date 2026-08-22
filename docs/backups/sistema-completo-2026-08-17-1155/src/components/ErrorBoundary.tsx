// Captura errores de render en toda la app: en vez de pantalla en blanco,
// muestra el mensaje del error para poder diagnosticar y botones para recuperarse.
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null; reloading: boolean };

/**
 * Recarga LIMPIA en web: borra Cache Storage, desregistra cualquier service
 * worker y recarga forzando descargar el index.html/bundle nuevos (cache-bust).
 * Sirve para autorecuperarse cuando quedó cacheado un bundle roto y "Reintentar"
 * (que solo reintenta en memoria) vuelve a fallar con el mismo código viejo.
 */
async function recargarLimpioWeb() {
  try {
    const c: any = (globalThis as any).caches;
    if (c?.keys) {
      const keys = await c.keys();
      await Promise.all(keys.map((k: string) => c.delete(k)));
    }
  } catch {}
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.serviceWorker?.getRegistrations) {
      const regs = await nav.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r: any) => r.unregister()));
    }
  } catch {}
  try {
    const w: any = (globalThis as any).window;
    const url = new URL(w.location.href);
    url.searchParams.set('v', String(Date.now())); // fuerza traer index.html fresco
    w.location.replace(url.toString());
  } catch {
    try { (globalThis as any).window?.location?.reload(); } catch {}
  }
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, reloading: false };
  }

  componentDidCatch(error: Error, info: any) {
    // Queda en consola para depurar.
    console.error('ErrorBoundary capturó:', error, info);
  }

  render() {
    if (this.state.error) {
      const isWeb = Platform.OS === 'web';
      return (
        <ScrollView contentContainerStyle={{ padding: 24, gap: 12, backgroundColor: '#18181B', flexGrow: 1 }}>
          <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: '800' }}>Ocurrió un error</Text>
          <Text style={{ color: '#FAFAFA', fontSize: 14 }}>{this.state.error.message}</Text>
          <Text selectable style={{ color: '#A1A1AA', fontSize: 11 }}>
            {this.state.error.stack}
          </Text>

          {/* En web: recarga limpia (borra caché) — resuelve el bundle viejo pegado. */}
          {isWeb ? (
            <TouchableOpacity
              onPress={() => { this.setState({ reloading: true }); recargarLimpioWeb(); }}
              disabled={this.state.reloading}
              style={{ backgroundColor: '#2563EB', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>
                {this.state.reloading ? 'Actualizando…' : '🔄 Actualizar app (recarga limpia)'}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: '#E4E4E7', borderRadius: 12, padding: 14, alignItems: 'center' }}
          >
            <Text style={{ color: '#18181B', fontWeight: '700' }}>Reintentar</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}
