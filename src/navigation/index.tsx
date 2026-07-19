import React from 'react';
import { Text, TouchableOpacity, View, Image, Platform, ActivityIndicator } from 'react-native';
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
import MargenGananciaScreen from '../screens/MargenGananciaScreen';
import MantenimientoMaquinariaScreen from '../screens/MantenimientoMaquinariaScreen';
import RoleHomeScreen from '../screens/RoleHomeScreen';
import OperadoresScreen from '../screens/OperadoresScreen';
import EmpresasScreen from '../screens/EmpresasScreen';
import OperatorScreen from '../screens/OperatorScreen';
import SupervisorScreen from '../screens/SupervisorScreen';
import SupervisionScreen from '../screens/SupervisionScreen';
import CocinaScreen from '../screens/CocinaScreen';
import ComidaScreen from '../screens/ComidaScreen';
import FoodCompanyScreen from '../screens/FoodCompanyScreen';
import MachineQuickScreen from '../screens/MachineQuickScreen';
import ScanQrScreen from '../screens/ScanQrScreen';
import MapScreen from '../screens/MapScreen';
import ManualScreen from '../screens/ManualScreen';
import CombustibleScreen from '../screens/CombustibleScreen';
import EmpleadosScreen from '../screens/EmpleadosScreen';
import EmployeeCardScreen from '../screens/EmployeeCardScreen';
import AliadosScreen from '../screens/AliadosScreen';
import AliadoCardScreen from '../screens/AliadoCardScreen';
import AliadoInfoScreen from '../screens/AliadoInfoScreen';
import NominaScreen from '../screens/NominaScreen';
import PagoPersonalScreen from '../screens/PagoPersonalScreen';
import UniformesScreen from '../screens/UniformesScreen';
import AsistenciaScreen from '../screens/AsistenciaScreen';
import ComprasScreen from '../screens/ComprasScreen';
import InventarioScreen from '../screens/InventarioScreen';
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

const LOGO = require('../../assets/logo.png');

/** Marca del encabezado: logo de la empresa + título de la pantalla. */
function HeaderBrand({ title }: { title?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Image source={LOGO} style={{ width: 30, height: 30 }} resizeMode="contain" />
      {title ? <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{title}</Text> : null}
    </View>
  );
}

/** Fecha y hora del día en horario de Caracas (Venezuela). */
function HeaderClock() {
  const { colors } = useTheme();
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const opts = { timeZone: 'America/Caracas' } as const;
  const fecha = now.toLocaleDateString('es-VE', { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = now.toLocaleTimeString('es-VE', { ...opts, hour: '2-digit', minute: '2-digit', hour12: true });
  return (
    <View style={{ alignItems: 'flex-end', paddingRight: 12 }}>
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>{hora}</Text>
      <Text style={{ color: colors.muted, fontSize: 10 }}>{fecha} · Caracas 🇻🇪</Text>
    </View>
  );
}

/** Flecha "volver" del encabezado que siempre lleva a Inicio (Dashboard). */
function HeaderHomeButton() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => {
        // Primero intenta volver a la pantalla anterior (p. ej. Tanques → menú Más);
        // si no hay a dónde volver (pantalla raíz de un tab), va al inicio.
        if (navigation.canGoBack?.()) { navigation.goBack(); return; }
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

/** Botón "Salir" del encabezado (para vistas sin menú "Más", p. ej. supervisor). */
function HeaderLogoutButton() {
  const { signOut } = useAuth();
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={() => signOut()} style={{ paddingHorizontal: 12, paddingVertical: 4 }} accessibilityLabel="Salir">
      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '800' }}>Salir</Text>
    </TouchableOpacity>
  );
}

function useScreenHeader() {
  const { colors } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.surface },
    headerTitleStyle: { color: colors.text },
    headerTintColor: colors.primary,
    // Logo de la empresa en el navbar + fecha/hora (Caracas) a la derecha.
    headerTitle: ({ children }: any) => <HeaderBrand title={typeof children === 'string' ? children : undefined} />,
    headerRight: () => <HeaderClock />,
  };
}

function MoreStack() {
  const screenHeader = useScreenHeader();
  return (
    <Stack.Navigator screenOptions={{ ...screenHeader, headerLeft: () => <HeaderHomeButton /> }}>
      <Stack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'Más' }} />
      <Stack.Screen name="Combustible" component={CombustibleScreen} options={{ title: 'Combustible' }} />
      <Stack.Screen name="Tanks" component={TanksScreen} options={{ title: 'Tanques' }} />
      <Stack.Screen name="Intakes" component={IntakesScreen} options={{ title: 'Ingresos' }} />
      <Stack.Screen name="Dispatches" component={DispatchesScreen} options={{ title: 'Consumos' }} />
      <Stack.Screen name="Authorizations" component={AuthorizationsScreen} options={{ title: 'Solicitudes' }} />
      <Stack.Screen name="ControlPagos" component={ControlPagosScreen} options={{ title: 'Control de pagos' }} />
      <Stack.Screen name="MargenGanancia" component={MargenGananciaScreen} options={{ title: 'Margen de ganancia' }} />
      <Stack.Screen name="MantenimientoMaquinaria" component={MantenimientoMaquinariaScreen} options={{ title: 'Mantenimiento maquinaria' }} />
      <Stack.Screen name="Operadores" component={OperadoresScreen} options={{ title: 'Operadores' }} />
      <Stack.Screen name="Supervision" component={SupervisionScreen} options={{ title: 'Supervisión' }} />
      <Stack.Screen name="Comida" component={ComidaScreen} options={{ title: 'Distribución de comida' }} />
      <Stack.Screen name="Empleados" component={EmpleadosScreen} options={{ title: 'Empleados' }} />
      <Stack.Screen name="EmployeeCard" component={EmployeeCardScreen} options={{ title: 'Ficha del trabajador' }} />
      <Stack.Screen name="Aliados" component={AliadosScreen} options={{ title: 'Aliados' }} />
      <Stack.Screen name="AliadoCard" component={AliadoCardScreen} options={{ title: 'Ficha de aliado' }} />
      <Stack.Screen name="Nomina" component={NominaScreen} options={{ title: 'Nómina' }} />
      <Stack.Screen name="PagoPersonal" component={PagoPersonalScreen} options={{ title: 'Pago a personal' }} />
      <Stack.Screen name="Uniformes" component={UniformesScreen} options={{ title: 'Distribución de uniformes' }} />
      <Stack.Screen name="Asistencia" component={AsistenciaScreen} options={{ title: 'Control de asistencia' }} />
      <Stack.Screen name="Compras" component={ComprasScreen} options={{ title: 'Compras' }} />
      <Stack.Screen name="Inventario" component={InventarioScreen} options={{ title: 'Inventario' }} />
      <Stack.Screen name="ScanQr" component={ScanQrScreen} options={{ title: 'Escanear QR', headerShown: false }} />
      <Stack.Screen name="MachineQuick" component={MachineQuickScreen} options={{ title: 'Máquina' }} />
      <Stack.Screen name="Transfers" component={TransfersScreen} options={{ title: 'Traslados' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reportes' }} />
      <Stack.Screen name="Users" component={UsersScreen} options={{ title: 'Usuarios' }} />
      <Stack.Screen name="Empresas" component={EmpresasScreen} options={{ title: 'Empresas' }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
    </Stack.Navigator>
  );
}

/** Panel de un COORDINADOR (rol dinámico): solo su panel y los módulos de su rol.
 *  No ve tabs ni el resto del sistema. La flecha de volver regresa a su panel. */
function CoordinadorStack() {
  const screenHeader = useScreenHeader();
  return (
    <Stack.Navigator screenOptions={screenHeader}>
      <Stack.Screen name="RoleHome" component={RoleHomeScreen} options={{ title: 'Mi panel', headerLeft: () => <HeaderLogoutButton /> }} />
      <Stack.Screen name="MantenimientoMaquinaria" component={MantenimientoMaquinariaScreen} options={{ title: 'Mantenimiento de Maquinaria' }} />
      <Stack.Screen name="Operadores" component={OperadoresScreen} options={{ title: 'Operadores' }} />
      <Stack.Screen name="Supervision" component={SupervisionScreen} options={{ title: 'Supervisión' }} />
      <Stack.Screen name="Equipos" component={EquiposScreen} options={{ title: 'Catálogo' }} />
      <Stack.Screen name="Map" component={MapScreen} options={{ title: 'Mapa' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reportes' }} />
      <Stack.Screen name="Inventario" component={InventarioScreen} options={{ title: 'Inventario' }} />
      <Stack.Screen name="Comida" component={ComidaScreen} options={{ title: 'Distribución de comida' }} />
      <Stack.Screen name="ControlMaquinaria" component={ControlMaquinariaScreen} options={{ title: 'Control de maquinaria' }} />
      <Stack.Screen name="EmployeeCard" component={EmployeeCardScreen} options={{ title: 'Ficha del trabajador' }} />
      <Stack.Screen name="Asistencia" component={AsistenciaScreen} options={{ title: 'Control de asistencia' }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
    </Stack.Navigator>
  );
}

/** Vista del SUPERVISOR: su pantalla principal es "Revisar" (lista de máquinas +
 *  check-in con GPS). También ve Mapa y Catálogo. Puede marcar cualquier máquina
 *  desde la lista o escaneando su QR; sin escanear el QR físico ya no depende. */
function SupervisorTabs() {
  const { colors } = useTheme();
  const screenHeader = useScreenHeader();
  return (
    <Tab.Navigator
      screenOptions={{
        ...screenHeader,
        headerLeft: () => <HeaderLogoutButton />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen name="Revisar" component={SupervisorScreen} options={{ title: 'Revisar', tabBarIcon: tabIcon('🪖') }} />
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Mapa', tabBarIcon: tabIcon('🗺️') }} />
      <Tab.Screen name="Equipos" component={EquiposScreen} options={{ title: 'Catálogo', tabBarIcon: tabIcon('🚜') }} />
    </Tab.Navigator>
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
        name="ControlMaquinaria"
        component={ControlMaquinariaScreen}
        options={{ title: 'Control', tabBarIcon: tabIcon('🛠️'), headerLeft: () => <HeaderHomeButton /> }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ title: 'Mapa', tabBarIcon: tabIcon('🗺️'), headerLeft: () => <HeaderHomeButton /> }}
      />
      <Tab.Screen
        name="Equipos"
        component={EquiposScreen}
        options={{ title: 'Catálogo', tabBarIcon: tabIcon('🚜'), headerLeft: () => <HeaderHomeButton /> }}
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

/** Lee un parámetro de la URL (solo web) para abrir por QR: ?maquina=<id> o ?empleado=<id>. */
function useQrParam(name: string): [string | null, () => void] {
  const read = (): string | null => {
    if (Platform.OS !== 'web') return null;
    try {
      const w: any = globalThis;
      return new URLSearchParams(w.location.search).get(name);
    } catch {
      return null;
    }
  };
  const [id, setId] = React.useState<string | null>(read);
  const clear = () => {
    if (Platform.OS === 'web') {
      try {
        const w: any = globalThis;
        w.history.replaceState({}, '', w.location.pathname);
      } catch {}
    }
    setId(null);
  };
  return [id, clear];
}

export default function RootNavigator() {
  const { session, configured, locked, role, appRole, signOut } = useAuth();
  const [qrMachineId, clearQr] = useQrParam('maquina');
  const [qrMachineSerial] = useQrParam('s'); // serial sellado del QR (para vencer QR viejos)
  const [qrEmployeeId, clearQrEmp] = useQrParam('empleado');
  const [qrAliadoId, clearQrAliado] = useQrParam('aliado');
  const [qrComidaId, clearQrComida] = useQrParam('comida');
  const [wantLogin, clearWantLogin] = useQrParam('login');
  const { colors } = useTheme();
  // Sesión anónima (operador que escaneó el QR sin loguearse): NO da acceso a la app.
  const isAnon = !!(session as any)?.user?.is_anonymous;
  // Al salir de una vista abierta por QR: SIEMPRE se cierra la sesión y se vuelve al
  // login. Escanear un QR NO es una puerta al sistema: la vista (operador / control de
  // cocina) queda aislada; su única salida es cerrar sesión (no entrar a la app).
  const exitQr = React.useCallback(() => { signOut(); clearQr(); clearWantLogin(); }, [signOut, clearQr, clearWantLogin]);
  const exitQrEmp = React.useCallback(() => { signOut(); clearQrEmp(); clearWantLogin(); }, [signOut, clearQrEmp, clearWantLogin]);
  const exitQrComida = React.useCallback(() => { signOut(); clearQrComida(); }, [signOut, clearQrComida]);
  // El QR de aliado es solo INFORMACIÓN pública: si era anónimo, cierra esa sesión temporal.
  const exitQrAliado = React.useCallback(() => { if (isAnon) { signOut(); } clearQrAliado(); }, [isAnon, signOut, clearQrAliado]);
  // Pide iniciar sesión desde una vista abierta por QR (para que quede el nombre
  // de quien registra). Cierra la sesión anónima y marca ?login=1 conservando el
  // parámetro del QR (?maquina o ?empleado).
  const goQrLogin = React.useCallback((param: 'maquina' | 'empleado', id: string) => {
    if (isAnon) signOut();
    if (Platform.OS === 'web') {
      try {
        const w: any = globalThis;
        w.history.replaceState({}, '', `${w.location.pathname}?${param}=${id}&login=1`);
        w.location.reload();
      } catch {}
    }
  }, [isAnon, signOut]);
  const goSupervisorLogin = React.useCallback(() => goQrLogin('maquina', qrMachineId ?? ''), [goQrLogin, qrMachineId]);
  const goCocinaLogin = React.useCallback(() => goQrLogin('empleado', qrEmployeeId ?? ''), [goQrLogin, qrEmployeeId]);
  // Sesión real (no anónima) ya cargada.
  const loggedInReal = !!session && !isAnon;
  const loggedInSup = loggedInReal && role === 'supervisor';
  const loggedInCocina = loggedInReal && role === 'cocina';
  const roleLoading = loggedInReal && role == null;
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
  // En modo demo (sin Supabase) o con sesión NO anónima, mostramos la app.
  const showApp = !configured || (!!session && !isAnon);
  return (
    <NavigationContainer
      theme={navTheme}
      // Título fijo de la pestaña del navegador (web). Sin esto, React Navigation
      // pone el nombre de la pantalla activa y en el arranque muestra "undefined".
      documentTitle={{ formatter: () => 'SOS LA GUAIRA' }}
    >
      {qrComidaId && !loggedInReal ? (
        // QR de DISTRIBUCIÓN DE COMIDA: LOGIN DIRECTO (sin vista anónima).
        <LoginScreen />
      ) : qrComidaId ? (
        // Con sesión: registrar comidas de la empresa (la cocina se verifica con su carnet).
        <FoodCompanyScreen companyId={qrComidaId} onExit={exitQrComida} />
      ) : qrAliadoId ? (
        // Se abrió por QR de un aliado: muestra su INFORMACIÓN (no el carnet).
        <AliadoInfoScreen aliadoId={qrAliadoId} onExit={exitQrAliado} />
      ) : qrEmployeeId && loggedInCocina ? (
        // Carnet escaneado por COCINA con sesión: abre directo el registro de
        // comida de esa persona (con el nombre de quien reparte ya cargado).
        <CocinaScreen initialEmployeeId={qrEmployeeId} onConsumed={exitQrEmp} />
      ) : qrEmployeeId && roleLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : qrEmployeeId && wantLogin && !loggedInReal ? (
        // Cocina pidió iniciar sesión desde la ficha abierta por el carnet.
        <LoginScreen />
      ) : qrEmployeeId ? (
        // Se abrió por QR de un empleado: ficha del trabajador SIN login (solo
        // lectura). Cocina puede tocar "Soy de cocina" para entrar con su nombre.
        <EmployeeCardScreen employeeId={qrEmployeeId} onExit={exitQrEmp} onCocinaLogin={goCocinaLogin} />
      ) : qrMachineId && wantLogin && !loggedInReal ? (
        // El SUPERVISOR pidió iniciar sesión (con su nombre) desde la vista de la máquina.
        <LoginScreen />
      ) : qrMachineId && !loggedInReal ? (
        // OPERADOR SIN usuario: vista de operador ANÓNIMA de esa máquina. Se identifica
        // DENTRO de la pantalla con su carnet + cédula (deben coincidir) antes de ver los
        // botones (combustible, avería, ubicar, jornada). El supervisor puede iniciar sesión.
        <MachineQuickScreen machineId={qrMachineId} qrSerial={qrMachineSerial} onExit={exitQr} onSupervisorLogin={goSupervisorLogin} />
      ) : qrMachineId && roleLoading ? (
        // Hay sesión real pero aún no sabemos el rol: esperar para no parpadear.
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : qrMachineId && loggedInSup ? (
        // Supervisor con sesión que escanea una máquina: va DIRECTO a su check-in de
        // supervisión (marcar Operativa / Parada / No está + GPS, y si hace falta,
        // iniciar la jornada de un operador escaneando su carnet). El supervisor
        // SUPERVISA, no opera: no pasa por la vista de operador. Puede escanear
        // CUALQUIER máquina (no tiene la restricción por empresa del operador).
        <SupervisorScreen initialMachineId={qrMachineId} />
      ) : qrMachineId ? (
        // Otro rol con sesión (admin/operador): vista de operador de esa máquina.
        <MachineQuickScreen machineId={qrMachineId} qrSerial={qrMachineSerial} onExit={exitQr} />
      ) : !showApp ? (
        <LoginScreen />
      ) : locked ? (
        <BiometricLockScreen />
      ) : appRole && role !== 'admin' ? (
        // Usuario con ROL DINÁMICO (coordinador): ve SOLO su panel y los módulos de su rol.
        <CoordinadorStack />
      ) : role === 'operador' ? (
        // El operador tiene su propia vista (independiente de la administración).
        <OperatorScreen />
      ) : role === 'supervisor' ? (
        // El supervisor entra al sistema pero SOLO ve Mapa y Catálogo. La jornada,
        // averías y combustible se inician escaneando el QR de cada máquina.
        <SupervisorTabs />
      ) : role === 'cocina' ? (
        // Cocina reparte comida: escanea carnets y registra las comidas entregadas.
        <CocinaScreen />
      ) : (
        <Tabs />
      )}
    </NavigationContainer>
  );
}
