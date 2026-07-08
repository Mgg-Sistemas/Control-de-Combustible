import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { NavigationContainer, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import DashboardScreen from '../screens/DashboardScreen';
import LoginScreen from '../screens/LoginScreen';
import BiometricLockScreen from '../screens/BiometricLockScreen';
import MoreScreen from '../screens/MoreScreen';
import UsersScreen from '../screens/UsersScreen';
import ReportsScreen from '../screens/ReportsScreen';
import AuthorizationsScreen from '../screens/AuthorizationsScreen';
import EquiposScreen from '../screens/EquiposScreen';
import ControlMaquinariaScreen from '../screens/ControlMaquinariaScreen';
import ControlPagosScreen from '../screens/ControlPagosScreen';
import MapScreen from '../screens/MapScreen';
import {
  TanksScreen,
  IntakesScreen,
  DispatchesScreen,
  TransfersScreen,
} from '../screens/modules';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Ícono simple basado en emoji (sin dependencias extra)
const tabIcon = (emoji: string) => () => <Text style={{ fontSize: 18 }}>{emoji}</Text>;

/** Flecha "volver" del encabezado que siempre lleva a Inicio (Dashboard). */
function HeaderHomeButton() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => {
        const parent = navigation.getParent?.();
        (parent ?? navigation).navigate('Dashboard');
      }}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      accessibilityLabel="Volver al inicio"
    >
      <Text style={{ color: colors.primary, fontSize: 24, fontWeight: '700' }}>←</Text>
    </TouchableOpacity>
  );
}

function useScreenHeader() {
  const { colors } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.surface },
    headerTitleStyle: { color: colors.text },
    headerTintColor: colors.primary,
  };
}

function MoreStack() {
  const screenHeader = useScreenHeader();
  return (
    <Stack.Navigator screenOptions={{ ...screenHeader, headerLeft: () => <HeaderHomeButton /> }}>
      <Stack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'Más' }} />
      <Stack.Screen name="Authorizations" component={AuthorizationsScreen} options={{ title: 'Autorizaciones' }} />
      <Stack.Screen name="Equipos" component={EquiposScreen} options={{ title: 'Catálogo maquinaria/vehículos' }} />
      <Stack.Screen name="ControlMaquinaria" component={ControlMaquinariaScreen} options={{ title: 'Control de maquinaria' }} />
      <Stack.Screen name="ControlPagos" component={ControlPagosScreen} options={{ title: 'Control de pagos' }} />
      <Stack.Screen name="Map" component={MapScreen} options={{ title: 'Mapa' }} />
      <Stack.Screen name="Transfers" component={TransfersScreen} options={{ title: 'Traslados' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reportes' }} />
      <Stack.Screen name="Users" component={UsersScreen} options={{ title: 'Usuarios' }} />
    </Stack.Navigator>
  );
}

function Tabs() {
  const { colors } = useTheme();
  const screenHeader = useScreenHeader();
  return (
    <Tab.Navigator
      screenOptions={{
        ...screenHeader,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'Inicio', tabBarIcon: tabIcon('🏠') }}
      />
      <Tab.Screen
        name="Tanks"
        component={TanksScreen}
        options={{ title: 'Tanques', tabBarIcon: tabIcon('🛢️'), headerLeft: () => <HeaderHomeButton /> }}
      />
      <Tab.Screen
        name="Intakes"
        component={IntakesScreen}
        options={{ title: 'Ingresos', tabBarIcon: tabIcon('⬇️'), headerLeft: () => <HeaderHomeButton /> }}
      />
      <Tab.Screen
        name="Dispatches"
        component={DispatchesScreen}
        options={{ title: 'Consumos', tabBarIcon: tabIcon('⛽'), headerLeft: () => <HeaderHomeButton /> }}
      />
      <Tab.Screen
        name="More"
        component={MoreStack}
        options={{ title: 'Más', headerShown: false, tabBarIcon: tabIcon('☰'), popToTopOnBlur: true }}
        listeners={({ navigation }) => ({
          // Al tocar la pestaña "Más" siempre mostrar el menú, no el último módulo abierto.
          tabPress: () => {
            navigation.navigate('More', { screen: 'MoreMenu' });
          },
        })}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { session, configured, locked } = useAuth();
  const { colors } = useTheme();
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };
  // En modo demo (sin Supabase) o con sesión activa, mostramos la app.
  const showApp = !configured || !!session;
  return (
    <NavigationContainer theme={navTheme}>
      {!showApp ? (
        <LoginScreen />
      ) : locked ? (
        <BiometricLockScreen />
      ) : (
        <Tabs />
      )}
    </NavigationContainer>
  );
}
