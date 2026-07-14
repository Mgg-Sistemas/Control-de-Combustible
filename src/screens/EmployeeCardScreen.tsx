import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { supabase } from '../lib/supabase';
import { Employee } from '../types/database';
import { qrSvg, employeeQrUrl } from '../lib/qr';
import { carnetHtml, carnetCard, carnetStyles, CARNET_MM, fullName, ageFrom } from '../lib/carnet';
import { exportPdf, exportCardImage, urlToDataUri } from '../lib/pdf';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const LOGO = require('../../assets/logo.png');
const FICHA_BG = require('../../assets/ficha-bg.jpg');

// Paleta fija de la ficha (estilo documento/carnet): fondo azulito como el logo,
// tarjetas blancas y texto oscuro, sin importar el tema claro/oscuro de la app.
const FICHA = {
  bg: '#EAF1FB',
  card: '#FFFFFF',
  brand: '#1E3A5F',
  text: '#1F2937',
  muted: '#6B7280',
  border: '#D7E3F4',
};

const STATUS: Record<string, { label: string; color: string }> = {
  activo: { label: '● Activo', color: '#16A34A' },
  inactivo: { label: '● Inactivo', color: '#DC2626' },
  suspendido: { label: '● Suspendido', color: '#F59E0B' },
};

/**
 * Ficha del trabajador. Se abre al escanear su QR (deep-link ?empleado=<id>) o
 * desde el módulo Empleados. Muestra TODOS los datos + botón para imprimir el carnet.
 */
export default function EmployeeCardScreen(props: { employeeId?: string; onExit?: () => void; onCocinaLogin?: () => void; route?: any; navigation?: any }) {
  const { colors } = useTheme();
  const employeeId: string = props.employeeId ?? props.route?.params?.employeeId ?? '';
  const onExit = props.onExit ?? (() => props.navigation?.goBack?.());
  const onCocinaLogin = props.onCocinaLogin;

  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<(Employee & { companyName?: string }) | null>(null);
  // Horas trabajadas como operador (de operator_assignments, por cédula), agrupadas por máquina.
  const [maquinas, setMaquinas] = useState<{ code: string; hours: number; jornadas: number }[]>([]);
  const [totalHoras, setTotalHoras] = useState(0);

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
      const e = data ? ({ ...(data as any), companyName: (data as any).company?.name ?? 'Sin empresa' }) : null;
      setEmp(e);

      // Horas trabajadas: buscar jornadas por la cédula del empleado y agrupar por máquina.
      if (e?.cedula) {
        const { data: asg } = await supabase
          .from('operator_assignments')
          .select('worked_hours, machinery:machinery_id(code)')
          .eq('cedula', String(e.cedula).trim());
        const acc = new Map<string, { code: string; hours: number; jornadas: number }>();
        let total = 0;
        (asg ?? []).forEach((r: any) => {
          const code = r.machinery?.code ?? '—';
          const h = Number(r.worked_hours) || 0;
          total += h;
          const g = acc.get(code) ?? { code, hours: 0, jornadas: 0 };
          g.hours += h; g.jornadas += 1;
          acc.set(code, g);
        });
        setMaquinas([...acc.values()].sort((a, b) => b.hours - a.hours));
        setTotalHoras(Math.round(total * 100) / 100);
      }
      setLoading(false);
    })();
  }, [employeeId]);

  const carnetPdf = async () => {
    if (!emp) return;
    let svg = '';
    try { svg = await qrSvg(employeeQrUrl(emp.id), 220); } catch {}
    const html = carnetHtml(emp, { companyName: emp.companyName, qrSvg: svg });
    await exportPdf(html, `Carnet - ${fullName(emp)}`);
  };

  const carnetImagen = async () => {
    if (!emp) return;
    let svg = '';
    try { svg = await qrSvg(employeeQrUrl(emp.id), 220); } catch {}
    // Incrusta la foto como data-URI para que la imagen se genere sin bloqueos.
    const photoData = await urlToDataUri(emp.photo_url);
    const card = carnetCard(emp, { companyName: emp.companyName, qrSvg: svg, photoOverride: photoData ?? undefined });
    await exportCardImage({
      styles: carnetStyles, card, mmW: CARNET_MM.w, mmH: CARNET_MM.h, dpi: 300,
      fileName: `Carnet - ${fullName(emp)}`,
      htmlForFallback: carnetHtml(emp, { companyName: emp.companyName, qrSvg: svg }),
    });
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: FICHA.border }}>
        <Text style={{ color: FICHA.muted, fontSize: 13 }}>{k}</Text>
        <Text style={{ color: FICHA.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' }}>{v}</Text>
      </View>
    ) : null;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card style={{ backgroundColor: FICHA.card, borderColor: FICHA.border }}>
      <Text style={{ color: FICHA.brand, fontWeight: '800', fontSize: 14, marginBottom: spacing.xs }}>{title}</Text>
      {children}
    </Card>
  );

  return (
    <Screen bg={FICHA.bg} bgImage={FICHA_BG} bgImageOpacity={0.08}>
      {/* Encabezado con logo */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Image source={LOGO} style={{ width: 34, height: 34 }} resizeMode="contain" />
          <Text style={{ color: FICHA.brand, fontWeight: '800', fontSize: 15 }}>Ficha del trabajador</Text>
        </View>
      </View>

      {/* Foto + nombre + cargo + estado */}
      <Card style={{ backgroundColor: FICHA.card, borderColor: FICHA.border }}>
        <View style={{ alignItems: 'center' }}>
          {emp.photo_url ? (
            <View style={{ width: 130, height: 150, borderRadius: 12, borderWidth: 3, borderColor: FICHA.brand, backgroundColor: '#EEF2F7', overflow: 'hidden' }}>
              <Image source={{ uri: emp.photo_url }} style={{ width: '100%', height: '100%', transform: [{ scale: 1.32 }, { translateY: -8 }] }} resizeMode="cover" />
            </View>
          ) : (
            <View style={{ width: 130, height: 150, borderRadius: 12, backgroundColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: FICHA.brand }}>
              <Text style={{ fontSize: 56 }}>👤</Text>
            </View>
          )}
          <Text style={{ color: FICHA.text, fontSize: 22, fontWeight: '900', marginTop: spacing.sm, textAlign: 'center' }}>{fullName(emp)}</Text>
          <Text style={{ color: FICHA.muted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{emp.cargo || 'Trabajador'}</Text>
          <View style={{ marginTop: spacing.xs, backgroundColor: '#EEF2F7', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 }}>
            <Text style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{st.label}</Text>
          </View>
        </View>
      </Card>

      {maquinas.length > 0 ? (
        <Section title="⏱️ Horas trabajadas">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
            <Text style={{ color: FICHA.muted, fontSize: 13, fontWeight: '700' }}>TOTAL</Text>
            <Text style={{ color: FICHA.brand, fontSize: 20, fontWeight: '900' }}>{totalHoras} h</Text>
          </View>
          {maquinas.map((m) => (
            <View key={m.code} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: FICHA.border }}>
              <Text style={{ color: FICHA.text, fontSize: 13, fontWeight: '700' }}>🚜 {m.code}</Text>
              <Text style={{ color: FICHA.muted, fontSize: 13 }}>{m.jornadas} jornada(s) · <Text style={{ color: FICHA.text, fontWeight: '800' }}>{m.hours} h</Text></Text>
            </View>
          ))}
        </Section>
      ) : null}

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
        <Row k="Cargo" v={emp.cargo} />
        <Row k="Departamento" v={emp.department} />
        <Row k="Grupo / zona" v={emp.grupo} />
        <Row k="Fecha de ingreso" v={emp.hire_date} />
      </Section>

      {emp.notes ? (
        <Section title="📝 Notas">
          <Text style={{ color: FICHA.text, fontSize: 13 }}>{emp.notes}</Text>
        </Section>
      ) : null}

      {/* Cocina: entrar con su nombre para registrar la comida de esta persona. */}
      {onCocinaLogin ? (
        <TouchableOpacity onPress={onCocinaLogin} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#1E9E4A' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🍽️ ¿Eres de cocina? Inicia sesión para registrar comida</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={{ color: FICHA.muted, fontSize: 12, marginTop: spacing.sm, textAlign: 'center' }}>Descargar carnet (54 × 86 mm)</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        <TouchableOpacity onPress={carnetPdf} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: FICHA.brand }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🪪 PDF</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={carnetImagen} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#059669' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🖼️ Imagen (300 dpi)</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
