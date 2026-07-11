import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { supabase } from '../lib/supabase';
import { Employee } from '../types/database';
import { qrSvg, employeeQrUrl } from '../lib/qr';
import { carnetHtml, fullName, ageFrom } from '../lib/carnet';
import { exportPdf } from '../lib/pdf';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const LOGO = require('../../assets/logo.jpeg');

const STATUS: Record<string, { label: string; color: string }> = {
  activo: { label: '● Activo', color: '#16A34A' },
  inactivo: { label: '● Inactivo', color: '#DC2626' },
  suspendido: { label: '● Suspendido', color: '#F59E0B' },
};

/**
 * Ficha del trabajador. Se abre al escanear su QR (deep-link ?empleado=<id>) o
 * desde el módulo Empleados. Muestra TODOS los datos + botón para imprimir el carnet.
 */
export default function EmployeeCardScreen(props: { employeeId?: string; onExit?: () => void; route?: any; navigation?: any }) {
  const { colors } = useTheme();
  const employeeId: string = props.employeeId ?? props.route?.params?.employeeId ?? '';
  const onExit = props.onExit ?? (() => props.navigation?.goBack?.());

  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<(Employee & { companyName?: string }) | null>(null);

  useEffect(() => {
    (async () => {
      // Si se abrió por QR sin sesión, iniciar una anónima para poder leer la ficha.
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
      const { data } = await supabase
        .from('employees')
        .select('*, company:company_id(name)')
        .eq('id', employeeId)
        .maybeSingle();
      setEmp(data ? ({ ...(data as any), companyName: (data as any).company?.name ?? 'Sin empresa' }) : null);
      setLoading(false);
    })();
  }, [employeeId]);

  const imprimirCarnet = async () => {
    if (!emp) return;
    let svg = '';
    try { svg = await qrSvg(employeeQrUrl(emp.id), 220); } catch {}
    const html = carnetHtml(emp, { companyName: emp.companyName, qrSvg: svg });
    await exportPdf(html, `Carnet - ${fullName(emp)}`);
  };

  if (loading) return <Screen><Loading /></Screen>;
  if (!emp) {
    return (
      <Screen>
        <Card><Text style={{ color: colors.danger, fontWeight: '700' }}>No se encontró la ficha de este código QR.</Text></Card>
        <TouchableOpacity onPress={onExit} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>← Ir al sistema</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  const st = STATUS[emp.status] ?? STATUS.activo;
  const age = ageFrom(emp.birth_date);

  const Row = ({ k, v }: { k: string; v?: string | null }) =>
    v ? (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{k}</Text>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' }}>{v}</Text>
      </View>
    ) : null;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card>
      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>{title}</Text>
      {children}
    </Card>
  );

  return (
    <Screen>
      {/* Encabezado con logo */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Image source={LOGO} style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: '#fff' }} resizeMode="contain" />
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>Ficha del trabajador</Text>
        </View>
        <TouchableOpacity onPress={onExit} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Sistema</Text>
        </TouchableOpacity>
      </View>

      {/* Foto + nombre + cargo + estado */}
      <Card>
        <View style={{ alignItems: 'center' }}>
          {emp.photo_url ? (
            <Image source={{ uri: emp.photo_url }} style={{ width: 130, height: 150, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 3, borderColor: colors.primary }} resizeMode="cover" />
          ) : (
            <View style={{ width: 130, height: 150, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.primary }}>
              <Text style={{ fontSize: 56 }}>👤</Text>
            </View>
          )}
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900', marginTop: spacing.sm, textAlign: 'center' }}>{fullName(emp)}</Text>
          <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{emp.cargo || 'Trabajador'}</Text>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 2 }}>🏢 {emp.companyName}</Text>
          <View style={{ marginTop: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 }}>
            <Text style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{st.label}</Text>
          </View>
        </View>
      </Card>

      <Section title="🪪 Identificación">
        <Row k="N° de ficha" v={emp.ficha_number} />
        <Row k="Cédula" v={emp.cedula} />
        <Row k="Grupo sanguíneo" v={emp.blood_type} />
        <Row k="Fecha de nacimiento" v={emp.birth_date} />
        <Row k="Edad" v={age != null ? `${age} años` : null} />
        <Row k="Género" v={emp.gender} />
        <Row k="Nacionalidad" v={emp.nationality} />
        <Row k="Estado civil" v={emp.marital_status} />
      </Section>

      <Section title="📞 Contacto">
        <Row k="Teléfono" v={emp.phone} />
        <Row k="Correo" v={emp.email} />
        <Row k="Dirección" v={emp.address} />
        <Row k="Ciudad" v={emp.city} />
        <Row k="Estado" v={emp.state} />
      </Section>

      {(emp.emergency_contact_name || emp.emergency_contact_phone) ? (
        <Section title="🚑 Contacto de emergencia">
          <Row k="Nombre" v={emp.emergency_contact_name} />
          <Row k="Teléfono" v={emp.emergency_contact_phone} />
          <Row k="Parentesco" v={emp.emergency_contact_relation} />
        </Section>
      ) : null}

      <Section title="💼 Datos laborales">
        <Row k="Empresa" v={emp.companyName} />
        <Row k="Cargo" v={emp.cargo} />
        <Row k="Departamento" v={emp.department} />
        <Row k="Grupo / zona" v={emp.grupo} />
        <Row k="Fecha de ingreso" v={emp.hire_date} />
      </Section>

      {emp.notes ? (
        <Section title="📝 Notas">
          <Text style={{ color: colors.text, fontSize: 13 }}>{emp.notes}</Text>
        </Section>
      ) : null}

      <TouchableOpacity onPress={imprimirCarnet} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>🪪 Imprimir carnet</Text>
      </TouchableOpacity>
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
