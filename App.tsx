import React from 'react';
import './src/lib/noTranslate'; // Evita que el navegador traduzca (rompe React) en web
import './src/lib/fonts'; // Fuente global Tahoma en toda la app
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { ConfirmProvider } from './src/components/ConfirmProvider';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { UpdateBanner } from './src/components/UpdateBanner';
import RootNavigator from './src/navigation';

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ConfirmProvider>
          <ErrorBoundary>
            <AuthProvider>
              <ThemedStatusBar />
              <RootNavigator />
              <UpdateBanner />
            </AuthProvider>
          </ErrorBoundary>
        </ConfirmProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
