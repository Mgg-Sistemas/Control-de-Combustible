// Captura errores de render en toda la app: en vez de pantalla en blanco,
// muestra el mensaje del error para poder diagnosticar y un botón para reintentar.
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // Queda en consola para depurar.
    console.error('ErrorBoundary capturó:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={{ padding: 24, gap: 12, backgroundColor: '#18181B', flexGrow: 1 }}>
          <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: '800' }}>Ocurrió un error</Text>
          <Text style={{ color: '#FAFAFA', fontSize: 14 }}>{this.state.error.message}</Text>
          <Text selectable style={{ color: '#A1A1AA', fontSize: 11 }}>
            {this.state.error.stack}
          </Text>
          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: '#E4E4E7', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ color: '#18181B', fontWeight: '700' }}>Reintentar</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}
