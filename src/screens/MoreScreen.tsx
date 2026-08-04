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

/** Rediseño: ícono del módulo dentro de una pastilla suave de marca (ámbar tenue). */
function IconBadge({ icon }: { icon: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accentSoftBg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 24 }}>{icon}</Text>
    </View>
  );
}

export default function MoreScreen({ navigation }: any) {
  const { signOut, session, configured, role, canSee, canAudit } = useAuth();
  const { colors, scheme, toggle } = useTheme();
  const toast = useToast();
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [showNames, setShowNames] = useState(false); // menú: colapsado (íconos) ↔ expandido (nombres completos)

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

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Menú</SectionTitle>
        <TouchableOpacity
          onPress={() => setShowNames((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: showNames ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: showNames ? colors.brand : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}
        >
          <Text style={{ color: showNames ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
            {showNames ? '▴ Ocultar nombres' : '▾ Ver nombres'}
          </Text>
        </TouchableOpacity>
      </View>

      {showNames ? (
        // EXPANDIDO: cada módulo con su nombre y descripción completos.
        menu.map((m) => (
          <TouchableOpacity key={m.route} onPress={() => navigation.navigate(m.route)}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <IconBadge icon={m.icon} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>{m.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{m.desc}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      ) : (
        // COLAPSADO: solo íconos (rejilla compacta). Toca uno para entrar.
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-start' }}>
            {menu.map((m) => (
              <TouchableOpacity
                key={m.route}
                onPress={() => navigation.navigate(m.route)}
                accessibilityLabel={m.label}
                style={{ width: 72, alignItems: 'center' }}
              >
                <IconBadge icon={m.icon} />
                <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 4 }}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
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
