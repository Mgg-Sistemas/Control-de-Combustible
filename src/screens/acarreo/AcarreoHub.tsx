// Módulo de ACARREO / TRANSPORTE — panel de entrada (router/dashboard).
// Cada tarjeta navega a su pantalla. Se irá ampliando por fases (maestros →
// órdenes → ejecución → financiero → reportes).
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Card, SectionTitle } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';

type Item = { label: string; desc: string; icon: string; route: string };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: 'Operación',
    items: [
      { label: 'Panel (KPIs y alertas)', desc: 'Acarreos, tiempo de tránsito, a tiempo, costo/km y alertas de vencimientos/retrasos', icon: '📊', route: 'HaulDashboard' },
      { label: 'Órdenes de acarreo', desc: 'Crear y despachar viajes, con validación de peso, vencimientos y solapamiento', icon: '📋', route: 'HaulOrders' },
    ],
  },
  {
    title: 'Datos maestros',
    items: [
      { label: 'Chutos (camiones)', desc: 'Camiones de arrastre: placa, capacidad, kilometraje y estado', icon: '🚛', route: 'HaulTrucks' },
      { label: 'Bateas / lowboys', desc: 'Remolques: tipo, ejes, capacidad de carga y dimensiones', icon: '🛻', route: 'HaulTrailers' },
      { label: 'Choferes', desc: 'Licencias, vigencias y disponibilidad (disponible, en ruta, reposo…)', icon: '👷', route: 'HaulDrivers' },
      { label: 'Equipos a trasladar', desc: 'Peso y dimensiones de la maquinaria (para validar la carga)', icon: '🚜', route: 'HaulEquipos' },
      { label: 'Clientes y proyectos', desc: 'Emisor y receptor, internos o externos (con tarifario)', icon: '🏢', route: 'HaulClients' },
      { label: 'Ubicaciones', desc: 'Obras, almacenes, talleres, minas y pozos de origen/destino', icon: '📍', route: 'HaulLocations' },
      { label: 'Documentos y vencimientos', desc: 'Permisos de carga pesada, pólizas, revisiones y licencias', icon: '📄', route: 'HaulDocuments' },
    ],
  },
  {
    title: 'Financiero',
    items: [
      { label: 'Tarifario', desc: 'Precios por km, tonelada, hora o tarifa plana para valorizar acarreos a terceros', icon: '🧾', route: 'HaulTariffs' },
    ],
  },
];

export default function AcarreoHub() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const sinAcceso = moduleLevel('acarreo') === 'none';
  const navigation = useNavigation<any>();

  return (
    <Screen>
      <Card>
        <SectionTitle>🚛 Acarreo / Transporte</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
          Traslado de maquinaria en chutos y bateas: flota, choferes, órdenes de acarreo,
          ejecución del viaje, control de costos y reportes.
        </Text>
        {sinAcceso ? (
          <Text style={{ color: colors.dangerSoftText, fontSize: 12.5, fontWeight: '700', marginTop: spacing.sm }}>
            No tienes permiso para este módulo. Pídeselo a un administrador.
          </Text>
        ) : null}
      </Card>

      {!sinAcceso ? GROUPS.map((g) => (
        <View key={g.title} style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs }}>{g.title}</Text>
          <View style={{ gap: spacing.sm }}>
            {g.items.map((it) => (
              <TouchableOpacity
                key={it.route}
                onPress={() => navigation.navigate(it.route)}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}
              >
                <Text style={{ fontSize: 26 }}>{it.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>{it.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{it.desc}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )) : null}
    </Screen>
  );
}
