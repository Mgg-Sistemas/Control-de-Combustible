import React from 'react';
import { Text, TouchableOpacity, View, Image, Platform, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme, useNavigation, LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAuth } from '../context/AuthContext';
import { AppRole, UserRole } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import NotificationBell from '../components/NotificationBell';
import DashboardScreen from '../screens/DashboardScreen';
import LoginScreen from '../screens/redesign/LoginPilot'; // PILOTO rediseño (Sesión); original en ../screens/LoginScreen
import BiometricLockScreen from '../screens/BiometricLockScreen';
import MoreScreen from '../screens/MoreScreen';
import AjustesScreen from '../screens/AjustesScreen';
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
import FuelDriverScreen from '../screens/FuelDriverScreen';
import SupervisionScreen from '../screens/SupervisionScreen';
import HistoricoJornadasScreen from '../screens/HistoricoJornadasScreen';
import CocinaScreen from '../screens/CocinaScreen';
import ComidaScreen from '../screens/ComidaScreen';
import FoodCompanyScreen from '../screens/FoodCompanyScreen';
import MachineQuickScreen from '../screens/MachineQuickScreen';
import MachineQrEntry from '../screens/MachineQrEntry';
import ScanQrScreen from '../screens/ScanQrScreen';
import { isPhoneDevice } from '../lib/device';
import PatioScreen from '../screens/PatioScreen';
import CamionesScreen from '../screens/CamionesScreen';
import MapScreen from '../screens/MapScreen';
import ManualScreen from '../screens/ManualScreen';
import AuditScreen from '../screens/AuditScreen';
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
import AsistenciaCamionesScreen from '../screens/AsistenciaCamionesScreen';
import ComprasScreen from '../screens/ComprasScreen';
import InventarioScreen from '../screens/InventarioScreen';
import InspeccionesScreen from '../screens/InspeccionesScreen';
import ManguerasScreen from '../screens/ManguerasScreen';
import FabricacionHubScreen from '../screens/FabricacionHubScreen';
import WorkCentersScreen from '../screens/WorkCentersScreen';
import BomScreen from '../screens/BomScreen';
import RoutesScreen from '../screens/RoutesScreen';
import {
  TanksScreen,
  IntakesScreen,
  DispatchesScreen,
} from '../screens/modules';
// Piloto de rediseño: Traslados restilizado (mismo comportamiento, look nuevo).
import TransfersPilot from '../screens/redesign/TransfersPilot';

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
    // Logo de la empresa en el navbar + campana (solo admin) + fecha/hora (Caracas) a la derecha.
    headerTitle: ({ children }: any) => <HeaderBrand title={typeof children === 'string' ? children : undefined} />,
    headerRight: () => (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <NotificationBell />
        <HeaderClock />
      </View>
    ),
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
      <Stack.Screen name="Supervision" component={SupervisionScreen} options={{ title: 'Inspecciones' }} />
      <Stack.Screen name="HistoricoJornadas" component={HistoricoJornadasScreen} options={{ title: 'Histórico por inspector' }} />
      {/* Vista de INSPECTOR (la del teléfono) abierta en la PC desde el módulo de
          Inspecciones (solo admin, con el botón "Ver vista de inspector"). Es el
          mismo SupervisorScreen: lista de máquinas, check-in, jornada, avería… */}
      <Stack.Screen name="InspectorTlf" component={SupervisorScreen} options={{ title: 'Vista de inspector (teléfono)' }} />
      <Stack.Screen name="Camiones" component={CamionesScreen} options={{ title: 'Entrada y salida de camiones' }} />
      <Stack.Screen name="Comida" component={ComidaScreen} options={{ title: 'Distribución de comida' }} />
      <Stack.Screen name="Empleados" component={EmpleadosScreen} options={{ title: 'Empleados' }} />
      <Stack.Screen name="EmployeeCard" component={EmployeeCardScreen} options={{ title: 'Ficha del trabajador' }} />
      <Stack.Screen name="Aliados" component={AliadosScreen} options={{ title: 'Aliados' }} />
      <Stack.Screen name="AliadoCard" component={AliadoCardScreen} options={{ title: 'Ficha de aliado' }} />
      <Stack.Screen name="Nomina" component={NominaScreen} options={{ title: 'Nómina' }} />
      <Stack.Screen name="PagoPersonal" component={PagoPersonalScreen} options={{ title: 'Pago a personal' }} />
      <Stack.Screen name="Uniformes" component={UniformesScreen} options={{ title: 'Distribución de uniformes' }} />
      <Stack.Screen name="Asistencia" component={AsistenciaScreen} options={{ title: 'Control de asistencia' }} />
      <Stack.Screen name="AsistenciaCamiones" component={AsistenciaCamionesScreen} options={{ title: 'Asistencia de camiones' }} />
      <Stack.Screen name="Compras" component={ComprasScreen} options={{ title: 'Compras' }} />
      <Stack.Screen name="Inventario" component={InventarioScreen} options={{ title: 'Inventario' }} />
      <Stack.Screen name="InspeccionesMaq" component={InspeccionesScreen} options={{ title: 'Inspecciones de Maquinaria' }} />
      <Stack.Screen name="FabricacionHub" component={FabricacionHubScreen} options={{ title: 'Fabricación' }} />
      <Stack.Screen name="Mangueras" component={ManguerasScreen} options={{ title: 'Mangueras hidráulicas' }} />
      <Stack.Screen name="WorkCenters" component={WorkCentersScreen} options={{ title: 'Centros de trabajo' }} />
      <Stack.Screen name="Bom" component={BomScreen} options={{ title: 'Recetas (BoM)' }} />
      <Stack.Screen name="Routes" component={RoutesScreen} options={{ title: 'Rutas de producción' }} />
      <Stack.Screen name="ScanQr" component={ScanQrScreen} options={{ title: 'Escanear QR', headerShown: false }} />
      <Stack.Screen name="MachineQuick" component={MachineQuickScreen} options={{ title: 'Máquina' }} />
      <Stack.Screen name="Transfers" component={TransfersPilot} options={{ title: 'Traslados' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reportes' }} />
      <Stack.Screen name="Users" component={UsersScreen} options={{ title: 'Usuarios' }} />
      <Stack.Screen name="Audit" component={AuditScreen} options={{ title: 'Auditoría' }} />
      <Stack.Screen name="Empresas" component={EmpresasScreen} options={{ title: 'Empresas' }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
      <Stack.Screen name="Ajustes" component={AjustesScreen} options={{ title: 'Ajustes' }} />
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
      <Stack.Screen name="Supervision" component={SupervisionScreen} options={{ title: 'Inspecciones' }} />
      <Stack.Screen name="HistoricoJornadas" component={HistoricoJornadasScreen} options={{ title: 'Histórico por inspector' }} />
      <Stack.Screen name="Equipos" component={EquiposScreen} options={{ title: 'Catálogo' }} />
      <Stack.Screen name="Map" component={MapScreen} options={{ title: 'Mapa' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reportes' }} />
      <Stack.Screen name="Inventario" component={InventarioScreen} options={{ title: 'Inventario' }} />
      <Stack.Screen name="InspeccionesMaq" component={InspeccionesScreen} options={{ title: 'Inspecciones de Maquinaria' }} />
      <Stack.Screen name="Comida" component={ComidaScreen} options={{ title: 'Distribución de comida' }} />
      <Stack.Screen name="ControlMaquinaria" component={ControlMaquinariaScreen} options={{ title: 'Control de maquinaria' }} />
      <Stack.Screen name="EmployeeCard" component={EmployeeCardScreen} options={{ title: 'Ficha del trabajador' }} />
      <Stack.Screen name="Asistencia" component={AsistenciaScreen} options={{ title: 'Control de asistencia' }} />
      <Stack.Screen name="AsistenciaCamiones" component={AsistenciaCamionesScreen} options={{ title: 'Asistencia de camiones' }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
    </Stack.Navigator>
  );
}

/** Panel del COORDINADOR DE PATIO (rol fijo): escanea QR de camiones (entrada/salida),
 *  reporta averías y ve el calendario de entradas/salidas. No ve el resto del sistema. */
function PatioStack() {
  const screenHeader = useScreenHeader();
  return (
    <Stack.Navigator screenOptions={{ ...screenHeader, headerLeft: () => <HeaderHomeButton /> }}>
      <Stack.Screen name="PatioHome" component={PatioScreen} options={{ title: 'Coordinador de Patio', headerLeft: () => <HeaderLogoutButton /> }} />
      <Stack.Screen name="Camiones" component={CamionesScreen} options={{ title: 'Entrada y salida de camiones' }} />
      <Stack.Screen name="Asistencia" component={AsistenciaScreen} options={{ title: 'Control de asistencia' }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
    </Stack.Navigator>
  );
}

/** Panel del CHOFER DE COMBUSTIBLE (rol dinámico, panel_type 'chofer_combustible').
 *  Teléfono: escanea/elige la máquina y surte combustible (litros + monto + fotos).
 *  No ve el resto del sistema. */
function FuelDriverStack() {
  const screenHeader = useScreenHeader();
  return (
    <Stack.Navigator screenOptions={{ ...screenHeader, headerLeft: () => <HeaderHomeButton /> }}>
      <Stack.Screen name="FuelDriverHome" component={FuelDriverScreen} options={{ title: 'Surtir combustible', headerLeft: () => <HeaderLogoutButton /> }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
    </Stack.Navigator>
  );
}

/** Módulos que forman el módulo "Combustible" (Tanques/Ingresos/Consumos/
 *  Traslados/Solicitudes — ver MoreScreen). */
const COMBUSTIBLE_MODULES = ['tanques', 'ingresos', 'consumos', 'traslados', 'autorizaciones'];
/** ¿El rol dinámico de este usuario SOLO tiene acceso a módulos de combustible?
 *  (ninguno de otro tipo). Se usa para llevarlo DIRECTO al módulo Combustible en
 *  el teléfono, en vez de la app completa o la vista de inspector. */
function esRolCombustible(appRole: AppRole | null): boolean {
  const mods = appRole?.modules ?? {};
  const activos = Object.keys(mods).filter((k) => mods[k] && mods[k] !== 'none');
  return activos.length > 0 && activos.every((k) => COMBUSTIBLE_MODULES.includes(k));
}

/** Panel de un rol personalizado cuyo ÚNICO acceso es de combustible (teléfono):
 *  entra DIRECTO al módulo Combustible (Tanques/Ingresos/Consumos/Traslados),
 *  sin pasar por Inicio ni el menú "Más". */
function CombustibleStack() {
  const screenHeader = useScreenHeader();
  return (
    <Stack.Navigator screenOptions={{ ...screenHeader, headerLeft: () => <HeaderLogoutButton /> }}>
      <Stack.Screen name="CombustibleHome" component={CombustibleScreen} options={{ title: 'Combustible' }} />
      <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual / Ayuda' }} />
    </Stack.Navigator>
  );
}

/** Vista del SUPERVISOR: su pantalla principal es "Revisar" (lista de máquinas +
 *  check-in con GPS). También ve Mapa y Catálogo. Puede marcar cualquier máquina
 *  desde la lista o escaneando su QR; sin escanear el QR físico ya no depende. */
function SupervisorTabs({ onSistema }: { onSistema?: () => void } = {}) {
  const { colors } = useTheme();
  const screenHeader = useScreenHeader();
  // Pestaña "Revisar" (Inspectores). Si es admin en teléfono, se le inyecta el
  // botón SISTEMA para saltar a la app completa.
  const RevisarScreen = React.useCallback(() => <SupervisorScreen onSistema={onSistema} />, [onSistema]);
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
      <Tab.Screen name="Revisar" component={RevisarScreen} options={{ title: 'Revisar', tabBarIcon: tabIcon('🪖') }} />
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Mapa', tabBarIcon: tabIcon('🗺️') }} />
      <Tab.Screen name="Equipos" component={EquiposScreen} options={{ title: 'Catálogo', tabBarIcon: tabIcon('🚜') }} />
    </Tab.Navigator>
  );
}

function Tabs() {
  const { colors } = useTheme();
  const { canSee } = useAuth();
  const screenHeader = useScreenHeader();
  // Inicio y Más SIEMPRE; las demás pestañas solo si el rol tiene permiso de ese módulo
  // (así un rol fijo con pocos módulos no ve pestañas que no puede usar).
  return (
    <Tab.Navigator
      screenOptions={{
        ...screenHeader,
        // lazy: false — por defecto React Navigation NO monta el contenido de una
        // pestaña hasta que se activa. Eso rompía la restauración PROFUNDA al
        // recargar (ej. Más → Inspecciones): el stack anidado de "Más" no existía
        // todavía cuando se aplicaba el estado guardado, así que solo se
        // restauraba la pestaña, no la pantalla de adentro (caía siempre en el
        // menú). Con lazy=false, TODAS las pestañas (y sus stacks anidados)
        // existen desde el primer render, así initialState/resetRoot sí
        // encuentran la pantalla guardada para restaurarla.
        lazy: false,
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
      {canSee('control_maquinaria') ? (
        <Tab.Screen
          name="ControlMaquinaria"
          component={ControlMaquinariaScreen}
          options={{ title: 'Control', tabBarIcon: tabIcon('🛠️'), headerLeft: () => <HeaderHomeButton /> }}
        />
      ) : null}
      {canSee('mapa') ? (
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{ title: 'Mapa', tabBarIcon: tabIcon('🗺️'), headerLeft: () => <HeaderHomeButton /> }}
        />
      ) : null}
      {canSee('equipos') ? (
        <Tab.Screen
          name="Equipos"
          component={EquiposScreen}
          options={{ title: 'Catálogo', tabBarIcon: tabIcon('🚜'), headerLeft: () => <HeaderHomeButton /> }}
        />
      ) : null}
      <Tab.Screen
        name="More"
        component={MoreStack}
        // Sin popToTopOnBlur: reseteaba el stack de "Más" al menú, y al RECARGAR la
        // página tumbaba la pantalla restaurada (persistencia de navegación). Para
        // "tocar Más = ver el menú" basta el listener de tabPress de abajo.
        options={{ title: 'Más', headerShown: false, tabBarIcon: tabIcon('☰') }}
        listeners={({ navigation }) => ({
          // Al TOCAR la pestaña "Más" mostrar el menú (no el último módulo). Solo se
          // dispara en un toque real: al recargar no corre, así se conserva la vista.
          tabPress: () => {
            navigation.navigate('More', { screen: 'MoreMenu' });
          },
        })}
      />
    </Tab.Navigator>
  );
}

/** Pantallas de "Más" (Stack anidado dentro del tab "More" del árbol `tabs`).
 *  Debe reflejar EXACTAMENTE los `Stack.Screen` de `MoreStack()` de arriba. */
const moreScreens = {
  MoreMenu: 'mas',
  Combustible: 'combustible',
  Tanks: 'tanques',
  Intakes: 'ingresos',
  Dispatches: 'consumos',
  Authorizations: 'solicitudes',
  ControlPagos: 'control-pagos',
  MargenGanancia: 'margen-ganancia',
  MantenimientoMaquinaria: 'mantenimiento',
  Operadores: 'operadores',
  Supervision: 'inspecciones',
  HistoricoJornadas: 'historico',
  InspectorTlf: 'vista-inspector',
  Camiones: 'camiones',
  Comida: 'comida',
  Empleados: 'empleados',
  EmployeeCard: 'ficha-empleado',
  Aliados: 'aliados',
  AliadoCard: 'ficha-aliado',
  Nomina: 'nomina',
  PagoPersonal: 'pago-personal',
  Uniformes: 'uniformes',
  Asistencia: 'asistencia',
  AsistenciaCamiones: 'asistencia-camiones',
  Compras: 'compras',
  Inventario: 'inventario',
  InspeccionesMaq: 'inspecciones-maquinaria',
  FabricacionHub: 'fabricacion',
  Mangueras: 'fabricacion/mangueras',
  WorkCenters: 'fabricacion/centros-trabajo',
  Bom: 'fabricacion/recetas',
  Routes: 'fabricacion/rutas',
  ScanQr: 'escanear',
  MachineQuick: 'maquina',
  Transfers: 'traslados',
  Reports: 'reportes',
  Users: 'usuarios',
  Audit: 'auditoria',
  Empresas: 'empresas',
  Manual: 'manual',
  Ajustes: 'ajustes',
};

/** Cada sesión monta UN SOLO árbol de navegación, elegido por rol/teléfono/PC
 *  (ver `pickTree` más abajo). `operador`/`cocina` son una pantalla suelta sin
 *  Stack/Tab, así que no tienen config de `linking` propia. */
type TreeKey = 'tabs' | 'supervisorTabs' | 'patio' | 'coordinador' | 'fuelDriver' | 'combustible' | 'operador' | 'cocina';

/**
 * LINKING (web) por árbol: sincroniza la URL con la pantalla activa, así la
 * URL pasa de `soslaguaira.com` a `soslaguaira.com/inventario` y al RECARGAR
 * el navegador React Navigation restaura la pantalla DIRECTO desde la URL
 * (incluida la pantalla honda dentro de "Más"). El flujo de QR (?maquina=,
 * ?empleado=, …) renderiza pantallas planas ANTES de montar cualquier
 * navegador, así que este linking no lo afecta.
 *
 * ANTES había un único config "superconjunto" con las pantallas de TODOS los
 * árboles mezcladas como si fueran hermanas de un solo navegador. Eso rompía
 * `getPathFromState`/`getStateFromPath` para los roles que no usan "Más"
 * (coordinador, patio, chofer de combustible…): pantallas como
 * Asistencia/Manual/Camiones solo estaban declaradas ANIDADAS bajo "More",
 * pero en esos árboles son pantallas de primer nivel — así que el botón
 * "atrás" del navegador podía no encontrar una ruta válida y la app se
 * quedaba sin pantalla. Ahora cada árbol tiene su PROPIA config, que solo
 * describe lo que ese árbol realmente monta.
 */
const TREE_LINKING: Partial<Record<TreeKey, NonNullable<LinkingOptions<any>['config']>['screens']>> = {
  tabs: {
    Dashboard: 'inicio',
    ControlMaquinaria: 'control',
    Map: 'mapa',
    Equipos: 'catalogo',
    More: { screens: moreScreens },
  },
  supervisorTabs: { Revisar: 'revisar', Map: 'mapa', Equipos: 'catalogo' },
  patio: { PatioHome: 'patio', Camiones: 'camiones', Asistencia: 'asistencia', Manual: 'manual' },
  coordinador: {
    RoleHome: 'panel',
    MantenimientoMaquinaria: 'mantenimiento',
    Operadores: 'operadores',
    Supervision: 'inspecciones',
    HistoricoJornadas: 'historico',
    Equipos: 'catalogo',
    Map: 'mapa',
    Reports: 'reportes',
    Inventario: 'inventario',
    InspeccionesMaq: 'inspecciones-maquinaria',
    Comida: 'comida',
    ControlMaquinaria: 'control',
    EmployeeCard: 'ficha-empleado',
    Asistencia: 'asistencia',
    AsistenciaCamiones: 'asistencia-camiones',
    Manual: 'manual',
  },
  fuelDriver: { FuelDriverHome: 'surtir', Manual: 'manual' },
  combustible: { CombustibleHome: 'combustible-directo', Manual: 'manual' },
};

/** URL "de inicio" de cada árbol (su pantalla raíz). Al entrar SIN deep link
 *  (URL "/") se fija la barra de direcciones a esta ruta, así el botón
 *  "atrás" del navegador siempre parte de una URL que la config sí reconoce,
 *  en vez de una "/" que ninguna config mapea a una pantalla. */
const TREE_HOME_PATH: Partial<Record<TreeKey, string>> = {
  tabs: '/inicio',
  supervisorTabs: '/revisar',
  patio: '/patio',
  coordinador: '/panel',
  fuelDriver: '/surtir',
  combustible: '/combustible-directo',
};

/** Elige el árbol de navegación (y su pantalla) del usuario logueado, EN EL
 *  MISMO ORDEN de condiciones que antes vivía inline en el `return` de
 *  `RootNavigator`. Se extrajo a función para poder saber, además de qué
 *  renderizar, la `key` con la que buscar su config de `linking` (arriba). */
function pickTree(ctx: {
  phone: boolean;
  role: UserRole | null;
  appRole: AppRole | null;
  isJesusLozada: boolean;
  sistemaMode: boolean;
  goSistema: () => void;
}): { key: TreeKey; node: React.ReactNode } {
  const { phone, role, appRole, isJesusLozada, sistemaMode, goSistema } = ctx;
  if (appRole && role !== 'admin' && appRole.panel_type === 'chofer_combustible') return { key: 'fuelDriver', node: <FuelDriverStack /> };
  if (role === 'coordinador_patio') return { key: 'patio', node: <PatioStack /> };
  if (phone && (role === 'admin' || isJesusLozada) && sistemaMode) return { key: 'tabs', node: <Tabs /> };
  if (phone && (role === 'admin' || isJesusLozada)) return { key: 'supervisorTabs', node: <SupervisorTabs onSistema={goSistema} /> };
  if (role === 'supervisor') return { key: 'supervisorTabs', node: <SupervisorTabs /> };
  if (appRole && role !== 'admin' && appRole.panel_type === 'coordinador_qr') return { key: 'coordinador', node: <CoordinadorStack /> };
  if (phone && appRole && role !== 'admin' && esRolCombustible(appRole)) return { key: 'combustible', node: <CombustibleStack /> };
  if (appRole && role !== 'admin') return { key: 'tabs', node: <Tabs /> };
  if (role === 'operador') return { key: 'operador', node: <OperatorScreen /> };
  if (role === 'cocina') return { key: 'cocina', node: <CocinaScreen /> };
  return { key: 'tabs', node: <Tabs /> };
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
  const { session, configured, locked, role, appRole, fullName, signOut, loading } = useAuth();
  // Excepción puntual: Jesús Lozada entra a la Vista de Inspector como cualquier
  // otro rol en teléfono (no se toca su enrutamiento), pero además ve el botón
  // "SISTEMA" para saltar al módulo administrativo general (Tabs), igual que el
  // admin. Comparación case-insensitive/trim para no fallar por tildes o espacios.
  const isJesusLozada = React.useMemo(() => {
    // NFD separa la tilde de la letra (é → e + acento); el rango ̀-ͯ
    // son las marcas diacríticas combinantes, que se descartan para comparar
    // "JESUS LOZADA" sin importar tildes.
    const n = (fullName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
    return n.includes('JESUS LOZADA');
  }, [fullName]);
  const [qrMachineId, clearQr] = useQrParam('maquina');
  const [qrMachineSerial] = useQrParam('s'); // serial sellado del QR (para vencer QR viejos)
  const [qrEmployeeId, clearQrEmp] = useQrParam('empleado');
  const [qrAliadoId, clearQrAliado] = useQrParam('aliado');
  const [qrComidaId, clearQrComida] = useQrParam('comida');
  const [wantLogin, clearWantLogin] = useQrParam('login');
  // Al escanear el QR de la máquina se elige "Operadores" (vista de operador con
  // carnet) o "Usuarios" (login). Este flag marca que se eligió operador.
  const [qrOperator, setQrOperator] = React.useState(false);
  // Al escanear el QR SIEMPRE se muestra primero la pantalla de entrada (logo +
  // botones). Este flag marca que ya pasó por ahí (tocó "Usuarios") y puede caer
  // en la vista de inspección de la máquina.
  const [qrEntered, setQrEntered] = React.useState(false);
  const { colors } = useTheme();
  // Sesión anónima (operador que escaneó el QR sin loguearse): NO da acceso a la app.
  const isAnon = !!(session as any)?.user?.is_anonymous;
  // Al salir de una vista abierta por QR: SIEMPRE se cierra la sesión y se vuelve al
  // login. Escanear un QR NO es una puerta al sistema: la vista (operador / control de
  // cocina) queda aislada; su única salida es cerrar sesión (no entrar a la app).
  const exitQr = React.useCallback(() => { signOut(); clearQr(); clearWantLogin(); setQrOperator(false); setQrEntered(false); }, [signOut, clearQr, clearWantLogin]);
  const exitQrEmp = React.useCallback(() => { signOut(); clearQrEmp(); clearWantLogin(); }, [signOut, clearQrEmp, clearWantLogin]);
  const exitQrComida = React.useCallback(() => { signOut(); clearQrComida(); }, [signOut, clearQrComida]);
  // El QR de aliado es solo INFORMACIÓN pública: si era anónimo, cierra esa sesión temporal.
  const exitQrAliado = React.useCallback(() => { if (isAnon) { signOut(); } clearQrAliado(); }, [isAnon, signOut, clearQrAliado]);
  // Pide iniciar sesión desde una vista abierta por QR (para que quede el nombre
  // de quien registra). Cierra la sesión anónima y marca ?login=1 conservando el
  // parámetro del QR (?maquina o ?empleado).
  const goQrLogin = React.useCallback(async (param: 'maquina' | 'empleado', id: string) => {
    // SIEMPRE cerrar la sesión actual (anónima o real) antes de mostrar el login,
    // para que "INICIAR SESIÓN" realmente pida usuario y contraseña aunque ya
    // hubiera alguien logueado en el teléfono. Hay que esperar a que se limpie el
    // almacenamiento; si recargamos antes, la sesión se restauraría y no pediría login.
    try { await signOut(); } catch {}
    if (Platform.OS === 'web') {
      try {
        const w: any = globalThis;
        w.history.replaceState({}, '', `${w.location.pathname}?${param}=${id}&login=1`);
        w.location.reload();
      } catch {}
    }
  }, [signOut]);
  const goSupervisorLogin = React.useCallback(() => goQrLogin('maquina', qrMachineId ?? ''), [goQrLogin, qrMachineId]);
  const goCocinaLogin = React.useCallback(() => goQrLogin('empleado', qrEmployeeId ?? ''), [goQrLogin, qrEmployeeId]);
  // ¿La sesión corre en un TELÉFONO/tablet? En teléfono todos los usuarios caen en
  // el módulo de Inspectores; en PC ven la app normal según su rol (y se mantiene
  // la sesión iniciada). Se calcula una sola vez (el dispositivo no cambia en vivo).
  const phone = React.useMemo(() => isPhoneDevice(), []);
  // Admin en teléfono: cae en Inspectores, pero con el botón SISTEMA salta a la
  // app completa (este flag lo activa). Se reinicia al recargar / cerrar sesión.
  const [sistemaMode, setSistemaMode] = React.useState(false);
  // Callback ESTABLE para el botón SISTEMA. Si se pasara inline (`() => ...`), su
  // identidad cambiaría en cada render del provider (p. ej. cuando la presencia
  // actualiza `onlineIds`), y eso REMONTABA la pantalla de Inspectores del teléfono
  // cada pocos segundos (perdía el modal de CHECK, el scroll y recargaba). Con
  // useCallback la referencia es fija y la pestaña ya no se remonta.
  const goSistema = React.useCallback(() => setSistemaMode(true), []);
  // PERSISTENCIA DE NAVEGACIÓN (web): la maneja `linking` (se arma más abajo,
  // según el árbol). La URL refleja la pantalla activa (soslaguaira.com/inventario)
  // y al RECARGAR React Navigation restaura la vista DIRECTO desde la URL —
  // incluida la pantalla honda dentro de "Más". No se guarda estado en localStorage.
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
  // Árbol de navegación + URL de esta sesión. Se calculan aquí (ANTES de los
  // `return` de carga/QR de abajo) porque son Hooks: deben correr siempre, en
  // el mismo orden, en cada render. Durante un flujo de QR (?maquina=, …) no
  // aplica: esas pantallas son planas, sin rutas con nombre que enlazar.
  const inQrFlow = !!(qrComidaId || qrAliadoId || qrEmployeeId || qrMachineId);
  const treePick = !inQrFlow && showApp && !locked && !(phone && roleLoading)
    ? pickTree({ phone, role, appRole, isJesusLozada, sistemaMode, goSistema })
    : null;
  const treeKey = treePick?.key ?? null;
  const linking = React.useMemo<LinkingOptions<any>>(() => ({
    prefixes: [],
    config: { screens: (treeKey && TREE_LINKING[treeKey]) || {} },
  }), [treeKey]);
  // Al entrar SIN deep link (URL "/") fija la barra de direcciones a la
  // pantalla de inicio del rol, para que el botón "atrás" del navegador
  // siempre parta de una URL válida en vez de una "/" que ninguna config
  // reconoce (la causa más común de quedarse "sin pantalla" al ir atrás).
  React.useEffect(() => {
    if (inQrFlow || Platform.OS !== 'web' || !treeKey) return;
    const home = TREE_HOME_PATH[treeKey];
    if (!home) return;
    try {
      const w: any = globalThis;
      if (w.location.pathname === '/' || w.location.pathname === '') {
        w.history.replaceState({}, '', home + w.location.search);
      }
    } catch {}
  }, [treeKey, inQrFlow]);
  // ⏳ NO montar el navegador hasta que el auth resuelva (la sesión de Supabase se
  // restaura de forma ASÍNCRONA) y, si hay sesión, hasta saber el ROL. Motivo: si
  // <Tabs/> (u otro navegador por rol) monta DESPUÉS del contenedor, React
  // Navigation ya no aplica `initialState` y se pierde la pantalla al recargar;
  // peor aún, el primer `onStateChange` guarda el estado por defecto y PISA el que
  // estaba. Con este gate, al terminar la carga el navegador CORRECTO es el primero
  // en montar y `initialState` sí restaura la última pantalla. (Un QR sin sesión no
  // dispara roleLoading, así que su pantalla de entrada aparece igual de rápido.)
  if (loading || roleLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <NavigationContainer
      theme={navTheme}
      // Sincroniza la URL con la pantalla (web) y restaura la vista al recargar.
      linking={linking}
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
        <EmployeeCardScreen employeeId={qrEmployeeId} onExit={exitQrEmp} onCocinaLogin={goCocinaLogin} scanned />
      ) : qrMachineId && wantLogin && !loggedInReal ? (
        // Tocó "INICIAR SESIÓN" sin sesión: login (con su nombre) para la máquina.
        <LoginScreen />
      ) : qrMachineId && !loggedInReal && qrOperator ? (
        // Eligió "Operadores": vista de operador ANÓNIMA. Se identifica DENTRO con
        // su carnet + cédula (deben coincidir) antes de ver los botones; si no
        // escanea, no ve ni registra nada. "Volver" regresa a la pantalla de entrada.
        <MachineQuickScreen machineId={qrMachineId} qrSerial={qrMachineSerial} onExit={() => { if (isAnon) signOut(); setQrOperator(false); }} onSupervisorLogin={goSupervisorLogin} />
      ) : qrMachineId && !qrEntered && !wantLogin ? (
        // Al escanear el QR de la máquina SIEMPRE se muestra primero esta pantalla
        // (logo + botones), tengas sesión o no. 🔓 INICIAR SESIÓN → login (o, si ya
        // hay sesión, entra directo a la vista de inspección). 🚜 Operadores →
        // vista de operador (escanea carnet).
        <MachineQrEntry
          onLogin={goSupervisorLogin}
          onOperator={() => setQrOperator(true)}
        />
      ) : qrMachineId && roleLoading ? (
        // Hay sesión real pero aún no sabemos el rol: esperar para no parpadear.
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : qrMachineId ? (
        // QR de máquina + sesión iniciada (CUALQUIER rol): cae en la VISTA DE
        // INSPECCIÓN de esa máquina (check-in: nombre/empresa/serial + marcar
        // estado/ubicación, iniciar la jornada del operador escaneando su carnet,
        // avería, gasoil, etc.). Incluye a los coordinadores de patio, que así
        // tienen su pantalla normal + todo lo de la máquina. El login NORMAL (sin
        // escanear) sigue viendo la app como siempre según su rol.
        <SupervisorScreen
          initialMachineId={qrMachineId}
          onConsumed={() => {
            // Limpia SOLO la URL (?maquina=) sin tumbar el estado de esta sesión: el
            // check-in actual se mantiene, pero al RECARGAR/entrar de nuevo ya no
            // reaparece como si se hubiera escaneado una máquina (bug de Frank y otros).
            if (Platform.OS === 'web') { try { const w: any = globalThis; w.history.replaceState({}, '', w.location.pathname); } catch {} }
          }}
        />
      ) : !showApp ? (
        <LoginScreen />
      ) : locked ? (
        <BiometricLockScreen />
      ) : phone && roleLoading ? (
        // En teléfono, mientras carga el rol esperamos (para saber si es patio).
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : treePick ? (
        // Árbol de navegación según el rol (ver `pickTree`, arriba del componente):
        // chofer de combustible, patio, admin/Jesús Lozada por teléfono (con o sin
        // SISTEMA), supervisor, coordinador QR, rol de combustible por teléfono,
        // rol personalizado por módulos, operador o cocina.
        treePick.node
      ) : (
        <Tabs />
      )}
    </NavigationContainer>
  );
}
