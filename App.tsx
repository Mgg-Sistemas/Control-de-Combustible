import React from 'react';
import './src/lib/fonts'; // Fuente global Tahoma en toda la app
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { ConfirmProvider } from './src/components/ConfirmProvider';
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
          <AuthProvider>
            <ThemedStatusBar />
            <RootNavigator />
          </AuthProvider>
        </ConfirmProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
