import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View, Switch, Modal, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { cmpText } from '../lib/text';
import { ConfigBanner } from '../components/ConfigBanner';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  isBiometricSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from '../lib/biometric';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { ChangePasswordButton } from '../components/ChangePasswordButton';

const items: { label: string; route: string; desc: string; icon: string; module: string }[] = [
  { label: 'Control de Pagos', route: 'ControlPagos', desc: 'Cuentas por pagar por empresa y semana', icon: '💰', module: 'control_pagos' },
  { label: 'Margen de ganancia', route: 'MargenGanancia', desc: 'Costo inicial, valor útil y % de ganancia por máquina y empresa', icon: '🚜', module: 'margen_ganancia' },
  { label: 'Mantenimiento de Maquinaria', route: 'MantenimientoMaquinaria', desc: 'Averías por máquina, enviar a reparación (salida, tiempo, cambios) y retorno operativo', icon: '🛠️', module: 'mantenimiento' },
  { label: 'Operadores', route: 'Operadores', desc: 'Operadores por semana, con la máquina asignada y su empresa (reporte PDF)', icon: '👷', module: 'operadores' },
  { label: 'Inspecciones', route: 'Supervision', desc: 'Rondas de inspectores: quién marcó cada máquina (GPS + estado), jornadas e histórico por inspector', icon: '🪖', module: 'supervision' },
  { label: 'Inspecciones de Maquinaria', route: 'InspeccionesMaq', desc: 'Control por equipo: inventario de herramientas/accesorios y REPORTE DE INSPECCIÓN en PDF', icon: '🔍', module: 'inspecciones_maq' },
  { label: 'Distribución de comida', route: 'Comida', desc: 'Comidas repartidas por día y por persona (registradas por Cocina al escanear el carnet)', icon: '🍽️', module: 'comida' },
  { label: 'Empresas', route: 'Empresas', desc: 'Editar nombre y RIF de las empresas contratistas, ocultar/mostrar', icon: '🏢', module: 'equipos' },
  { label: 'Nómina', route: 'Nomina', desc: 'Pago del personal por empresa y período, con recibos y reportes', icon: '🧾', module: 'nomina' },
  { label: 'Control de asistencia', route: 'Asistencia', desc: 'Marcar entrada/salida del personal escaneando el carnet (hora y fecha), con reporte', icon: '🕒', module: 'asistencia' },
  { label: 'Asistencia de camiones', route: 'AsistenciaCamiones', desc: 'Volteos/volquetas: presente/ausente (auto al iniciar jornada + manual), avería y gasoil por escáner o manual', icon: '🚚', module: 'asistencia_camiones' },
  { label: 'Aliados', route: 'Aliados', desc: 'Colaboradores externos con ficha y carnet propios (QR con sus datos)', icon: '🤝', module: 'aliados' },
  { label: 'Compras', route: 'Compras', desc: 'Solicitudes de pedido, órdenes de compra con aprobación y proveedores', icon: '🛒', module: 'compras' },
  { label: 'Inventario', route: 'Inventario', desc: 'Existencias por material con PMP, entradas desde compras, salidas y consumo', icon: '📦', module: 'inventario' },
  { label: 'Escanear QR', route: 'ScanQr', desc: 'Escanea el QR de una máquina con la cámara', icon: '📷', module: 'equipos' },
  { label: 'Reportes', route: 'Reports', desc: 'Combustible y rondas (PDF)', icon: '📊', module: 'reportes' },
];

export default function MoreScreen({ navigation }: any) {
  const { signOut, session, configured, role, canSee, canAudit } = useAuth();
  const { colors, scheme, toggle } = useTheme();
  const toast = useToast();
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [expanded, setExpanded] = useState(false); // menú: colapsado (columna de íconos) por defecto ↔ desplegado (nombres) al tocar "Más"

  useEffect(() => {
    (async () => {
      setBioSupported(await isBiometricSupported());
      setBioOn(await isBiometricEnabled());
    })();
  }, []);

  const toggleBio = async (value: boolean) => {
    if (value) {
      const ok = await enableBiometric();
      if (!ok) {
        toast.error('No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.');
        return;
      }
    } else {
      await disableBiometric();
    }
    setBioOn(value);
  };

  // Menú unificado en ORDEN ALFABÉTICO. Colapsable: por defecto se ven solo los
  // íconos (compacto); al tocar "Ver nombres" se despliega cada módulo con su
  // nombre y descripción completos.
  const menu = useMemo(() => {
    const list: { label: string; route: string; desc: string; icon: string }[] = [];
    if (canSee('tanques') || canSee('ingresos') || canSee('consumos') || canSee('traslados')) {
      list.push({ label: 'Combustible', route: 'Combustible', desc: 'Tanques, ingresos, consumos y traslados — todo en un solo lugar', icon: '⛽' });
    }
    items.filter((it) => canSee(it.module)).forEach((it) => list.push({ label: it.label, route: it.route, desc: it.desc, icon: it.icon }));
    list.push({ label: 'Manual / Ayuda', route: 'Manual', desc: 'Guía paso a paso para usar el sistema, en lenguaje simple', icon: '📖' });
    if (role === 'admin') list.push({ label: 'Usuarios', route: 'Users', desc: 'Crear personas, ver conectados y asignar roles', icon: '👥' });
    if (canAudit) list.push({ label: 'Auditoría', route: 'Audit', desc: 'Quién crea, modifica o elimina cada cosa', icon: '🕵️' });
    return list.sort((a, b) => cmpText(a.label, b.label));
  }, [canSee, role, canAudit]);

  return (
    <Screen>
      <ConfigBanner />

      {/* Encabezado del menú + botón "Más": tocarlo DESPLIEGA el menú (íconos + nombres);
          cuando NO está desplegado, se ve una columna angosta de solo íconos. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }}>MENÚ</Text>
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: expanded ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: expanded ? colors.brand : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 }}
        >
          <Text style={{ color: expanded ? colors.brandContrast : colors.text, fontWeight: '900', fontSize: 12.5 }}>
            {expanded ? '▴ Menos' : '☰ Más'}
          </Text>
        </TouchableOpacity>
      </View>

      {expanded ? (
        // DESPLEGADO: fila por módulo con ícono + nombre + chevron (alfabético).
        // Combustible va destacado (acento ámbar) por ser el eje del sistema.
        <View style={{ gap: 3 }}>
          {menu.map((m) => {
            const feat = m.route === 'Combustible';
            return (
              <TouchableOpacity
                key={m.route}
                onPress={() => navigation.navigate(m.route)}
                activeOpacity={0.7}
                style={{ position: 'relative', flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13, paddingLeft: spacing.md, paddingRight: spacing.md, borderRadius: radius.md, backgroundColor: feat ? colors.surface : 'transparent', borderWidth: feat ? 1 : 0, borderColor: feat ? colors.accent : 'transparent', overflow: 'hidden' }}
              >
                {feat ? <View style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 4, backgroundColor: colors.accent, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} /> : null}
                <Text style={{ fontSize: 22, width: 28, textAlign: 'center' }}>{m.icon}</Text>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 15.5, fontWeight: feat ? '900' : '700', color: colors.text }}>{m.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        // COLAPSADO: columna angosta de SOLO íconos (toca uno para entrar; "Más" despliega los nombres).
        <View style={{ gap: 6, alignItems: 'flex-start' }}>
          {menu.map((m) => {
            const feat = m.route === 'Combustible';
            return (
              <TouchableOpacity
                key={m.route}
                onPress={() => navigation.navigate(m.route)}
                accessibilityLabel={m.label}
                activeOpacity={0.7}
                style={{ position: 'relative', width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: feat ? colors.surface : colors.surfaceAlt, borderWidth: 1, borderColor: feat ? colors.accent : colors.border, overflow: 'hidden' }}
              >
                {feat ? <View style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 4, backgroundColor: colors.accent, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} /> : null}
                <Text style={{ fontSize: 24 }}>{m.icon}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <SectionTitle>Apariencia</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Modo oscuro</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {scheme === 'dark' ? 'Activado' : 'Desactivado'} · cambia el tema de la app
            </Text>
          </View>
          <Switch value={scheme === 'dark'} onValueChange={toggle} />
        </View>
      </Card>

      <SectionTitle>Seguridad</SectionTitle>
      <View style={{ marginBottom: spacing.md }}>
        <ChangePasswordButton variant="row" />
      </View>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Iniciar sesión con huella</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {bioSupported
                ? 'Pide tu huella o Face ID al abrir la app.'
                : 'Tu dispositivo no tiene huella o Face ID configurado.'}
            </Text>
          </View>
          <Switch value={bioOn} onValueChange={toggleBio} disabled={!bioSupported} />
        </View>
      </Card>

      <View style={{ height: spacing.lg }} />
      {configured && session ? (
        <TouchableOpacity onPress={signOut}>
          <Card style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>Cerrar sesión</Text>
          </Card>
        </TouchableOpacity>
      ) : null}
    </Screen>
  );
}
