import React from 'react';
import './src/lib/noTranslate'; // Evita que el navegador traduzca (rompe React) en web
import './src/lib/fonts'; // Fuente global Tahoma en toda la app
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { ConfirmProvider } from './src/components/ConfirmProvider';
import { ToastProvider } from './src/components/ToastProvider';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { UpdateBanner } from './src/components/UpdateBanner';
import { PhotoCropperHost } from './src/components/PhotoCropper';
import { SincronizadorColas } from './src/components/SincronizadorColas';
import RootNavigator from './src/navigation';

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ErrorBoundary>
              <AuthProvider>
                <ThemedStatusBar />
                <RootNavigator />
                <UpdateBanner />
                <PhotoCropperHost />
                {/* Sube los viajes que quedaron guardados en el telefono, este
                    abierta o no la pantalla de Viajes de camiones. */}
                <SincronizadorColas />
              </AuthProvider>
            </ErrorBoundary>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
