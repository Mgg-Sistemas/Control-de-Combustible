import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Screen } from '../components/ui';
import { cmpText } from '../lib/text';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const items: { label: string; route: string; desc: string; icon: string; module: string }[] = [
  { label: 'Control de Pagos', route: 'ControlPagos', desc: 'Cuentas por pagar por empresa y semana', icon: '💰', module: 'control_pagos' },
  { label: 'Margen de ganancia', route: 'MargenGanancia', desc: 'Costo inicial, valor útil y % de ganancia por máquina y empresa', icon: '🚜', module: 'margen_ganancia' },
  { label: 'Mantenimiento de Maquinaria', route: 'MantenimientoMaquinaria', desc: 'Averías por máquina, enviar a reparación (salida, tiempo, cambios) y retorno operativo', icon: '🛠️', module: 'mantenimiento' },
  { label: 'Operadores', route: 'Operadores', desc: 'Operadores por semana, con la máquina asignada y su empresa (reporte PDF)', icon: '👷', module: 'operadores' },
  { label: 'Coordinador de Operadores', route: 'CoordOperadores', desc: 'Asignar operadores a máquinas por turno, marcar su asistencia y avisar novedades', icon: '👷‍♂️', module: 'coordinacion_operadores' },
  { label: 'Inspecciones', route: 'Supervision', desc: 'Rondas de inspectores: quién marcó cada máquina (GPS + estado), jornadas e histórico por inspector', icon: '🪖', module: 'supervision' },
  { label: 'Ubicaciones', route: 'Ubicaciones', desc: 'Catálogo de edificios/ubicaciones (Macuto, Caraballeda…): agregar, editar y eliminar; se sincroniza con el EDIFICIO del inspector y el catálogo', icon: '📍', module: 'supervision' },
  { label: 'Obras Públicas', route: 'ObrasPublicasDashboard', desc: 'Panel del módulo Obras Públicas: KPIs, estado de flota, horas y visitas de todos los supervisores externos', icon: '🏛️', module: 'obras_publicas' },
  { label: 'Inspecciones de Maquinaria', route: 'InspeccionesMaq', desc: 'Control por equipo: inventario de herramientas/accesorios y REPORTE DE INSPECCIÓN en PDF', icon: '🔍', module: 'inspecciones_maq' },
  { label: 'Geodesta', route: 'Geodesta', desc: 'Topografía: levantamientos ligados a obra, curvas de nivel y cubicaciones (UTM SIRGAS-REGVEN 19N)', icon: '📐', module: 'geodesta' },
  { label: 'Distribución de comida', route: 'Comida', desc: 'Comidas repartidas por día y por persona (registradas por Cocina al escanear el carnet)', icon: '🍽️', module: 'comida' },
  { label: 'Cocina (escanear)', route: 'CocinaScan', desc: 'Registra las comidas del personal escaneando su carnet — la misma vista que usa Cocina', icon: '🍳', module: 'comida' },
  { label: 'Empresas', route: 'Empresas', desc: 'Editar nombre y RIF de las empresas contratistas, ocultar/mostrar', icon: '🏢', module: 'equipos' },
  { label: 'Nómina', route: 'Nomina', desc: 'Pago del personal, uniformes, asistencia y organigrama por empresa y período', icon: '🧾', module: 'nomina' },
  { label: 'Control de asistencia', route: 'Asistencia', desc: 'Marcar entrada/salida del personal escaneando el carnet (hora y fecha), con reporte', icon: '🕒', module: 'asistencia' },
  { label: 'Asistencia de camiones', route: 'AsistenciaCamiones', desc: 'Volteos/volquetas: presente/ausente (auto al iniciar jornada + manual), avería y gasoil por escáner o manual', icon: '🚚', module: 'asistencia_camiones' },
  { label: 'Aliados', route: 'Aliados', desc: 'Colaboradores externos con ficha y carnet propios (QR con sus datos)', icon: '🤝', module: 'aliados' },
  { label: 'Compras', route: 'Compras', desc: 'Solicitudes de pedido, órdenes de compra con aprobación y proveedores', icon: '🛒', module: 'compras' },
  { label: 'Inventario', route: 'Inventario', desc: 'Existencias por material con PMP, entradas desde compras, salidas y consumo', icon: '📦', module: 'inventario' },
  { label: 'Escanear QR', route: 'ScanQr', desc: 'Escanea el QR de una máquina con la cámara', icon: '📷', module: 'equipos' },
  { label: 'Reportes', route: 'Reports', desc: 'Combustible y rondas (PDF)', icon: '📊', module: 'reportes' },
  { label: 'Fabricación', route: 'FabricacionHub', desc: 'Taller: mangueras, centros de trabajo, recetas (BoM) y rutas de producción', icon: '🏭', module: 'mangueras' },
  { label: 'Acarreo / Transporte', route: 'AcarreoHub', desc: 'Traslado de maquinaria: flota (chutos/bateas), choferes, órdenes de acarreo y costos', icon: '🚛', module: 'acarreo' },
  // (Kiosco de planta se quitó del menú: salía duplicado con la tarjeta del hub de
  //  Fabricación. Los roles "solo kiosco" entran directo al Kiosco por su panel, ver
  //  navigation `fabricacionPlanta`. La pantalla/ruta PlantaKiosk sigue existiendo.)
];

export default function MoreScreen({ navigation }: any) {
  const { role, canSee, canAudit } = useAuth();
  const { colors } = useTheme();

  // Menú unificado de módulos en ORDEN ALFABÉTICO (una fila por módulo). Las
  // preferencias de cuenta/dispositivo (apariencia, seguridad, cerrar sesión)
  // viven ahora en su propio módulo "Ajustes".
  const menu = useMemo(() => {
    const list: { label: string; route: string; desc: string; icon: string }[] = [];
    if (canSee('tanques') || canSee('ingresos') || canSee('consumos') || canSee('traslados')) {
      list.push({ label: 'Combustible', route: 'Combustible', desc: 'Tanques, ingresos, consumos y traslados — todo en un solo lugar', icon: '⛽' });
    }
    items.filter((it) => canSee(it.module)).forEach((it) => list.push({ label: it.label, route: it.route, desc: it.desc, icon: it.icon }));
    list.push({ label: 'Manual / Ayuda', route: 'Manual', desc: 'Guía paso a paso para usar el sistema, en lenguaje simple', icon: '📖' });
    if (role === 'admin') list.push({ label: 'Usuarios', route: 'Users', desc: 'Crear personas, ver conectados y asignar roles', icon: '👥' });
    if (canAudit) list.push({ label: 'Auditoría', route: 'Audit', desc: 'Quién crea, modifica o elimina cada cosa', icon: '🕵️' });
    // "Ajustes" ya NO va como fila del menú: vive en la TUERCA ⚙️ del encabezado
    // (junto a la campana) → modo oscuro, huella y contraseña, con "Más ajustes"
    // para las herramientas avanzadas.
    return list.sort((a, b) => cmpText(a.label, b.label));
  }, [canSee, role, canAudit]);

  return (
    <Screen>
      <ConfigBanner />

      {/* Menú: una fila por módulo (ícono + nombre + descripción + chevron), en
          orden alfabético. */}
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: spacing.sm }}>MENÚ</Text>
      <View style={{ gap: 4 }}>
        {menu.map((m) => {
          return (
            <TouchableOpacity
              key={m.route}
              onPress={() => navigation.navigate(m.route)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13, paddingLeft: spacing.md, paddingRight: spacing.md, borderRadius: radius.md, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ fontSize: 24, width: 30, textAlign: 'center' }}>{m.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '700', color: colors.text }}>{m.label}</Text>
                <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>{m.desc}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Screen>
  );
}
