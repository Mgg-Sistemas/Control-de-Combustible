import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { supabase } from '../lib/supabase';
import { Aliado } from '../types/database';
import { qrSvg, aliadoQrUrl } from '../lib/qr';
import { carnetAliadoHtml, carnetAliadoCard, carnetStyles, CARNET_MM } from '../lib/carnet';
import { exportPdf, exportCardImage, urlToDataUri } from '../lib/pdf';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const LOGO = require('../../assets/logo.png');
const FICHA_BG = require('../../assets/ficha-bg.jpg');

// Paleta fija de la ficha del aliado (documento/carnet).
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

const fullName = (a: Pick<Aliado, 'first_name' | 'last_name'>) => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();

/**
 * Ficha del aliado. Se abre al escanear su QR (deep-link ?aliado=<id>) o desde el
 * módulo Aliados. Muestra los datos + botones para descargar el carnet (PDF/imagen).
 */
export default function AliadoCardScreen(props: { aliadoId?: string; onExit?: () => void; route?: any; navigation?: any }) {
  const { colors } = useTheme();
  const aliadoId: string = props.aliadoId ?? props.route?.params?.aliadoId ?? '';
  const onExit = props.onExit ?? (() => props.navigation?.goBack?.());

  const [loading, setLoading] = useState(true);
  const [ali, setAli] = useState<Aliado | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
      const { data } = await supabase.from('aliados').select('*').eq('id', aliadoId).maybeSingle();
      setAli((data as any) ?? null);
      setLoading(false);
    })();
  }, [aliadoId]);

  const carnetPdf = async () => {
    if (!ali) return;
    let svg = '';
    try { svg = await qrSvg(aliadoQrUrl(ali.id), 220); } catch {}
    await exportPdf(carnetAliadoHtml(ali, { qrSvg: svg }), `Carnet Aliado - ${fullName(ali)}`);
  };

  const carnetImagen = async () => {
    if (!ali) return;
    let svg = '';
    try { svg = await qrSvg(aliadoQrUrl(ali.id), 220); } catch {}
    const photoData = await urlToDataUri(ali.photo_url);
    const card = carnetAliadoCard(ali, { qrSvg: svg, photoOverride: photoData ?? undefined });
    await exportCardImage({
      styles: carnetStyles, card, mmW: CARNET_MM.w, mmH: CARNET_MM.h, dpi: 300,
      fileName: `Carnet Aliado - ${fullName(ali)}`,
      htmlForFallback: carnetAliadoHtml(ali, { qrSvg: svg }),
    });
  };

  if (loading) return <Screen><Loading /></Screen>;
  if (!ali) {
    return (
      <Screen>
        <Card><Text style={{ color: colors.danger, fontWeight: '700' }}>No se encontró la ficha de este código QR.</Text></Card>
        <TouchableOpacity onPress={onExit} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>← Ir al sistema</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  const st = STATUS[ali.status] ?? STATUS.activo;

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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Image source={LOGO} style={{ width: 34, height: 34 }} resizeMode="contain" />
          <Text style={{ color: FICHA.brand, fontWeight: '800', fontSize: 15 }}>Ficha de aliado</Text>
        </View>
      </View>

      <Card style={{ backgroundColor: FICHA.card, borderColor: FICHA.border }}>
        <View style={{ alignItems: 'center' }}>
          {ali.photo_url ? (
            <View style={{ width: 130, height: 150, borderRadius: 12, borderWidth: 3, borderColor: FICHA.brand, backgroundColor: '#EEF2F7', overflow: 'hidden' }}>
              <Image source={{ uri: ali.photo_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            </View>
          ) : (
            <View style={{ width: 130, height: 150, borderRadius: 12, backgroundColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: FICHA.brand }}>
              <Text style={{ fontSize: 56 }}>🤝</Text>
            </View>
          )}
          <Text style={{ color: FICHA.muted, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.sm }}>Aliado</Text>
          <Text style={{ color: FICHA.text, fontSize: 22, fontWeight: '900', textAlign: 'center' }}>{fullName(ali)}</Text>
          {ali.ficha_number ? (
            <Text style={{ color: FICHA.brand, fontSize: 14, fontWeight: '800' }}>N° de ficha {ali.ficha_number}</Text>
          ) : null}
          <View style={{ marginTop: spacing.xs, backgroundColor: '#EEF2F7', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 }}>
            <Text style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{st.label}</Text>
          </View>
        </View>
      </Card>

      <Section title="🪪 Identificación">
        <Row k="N° de ficha" v={ali.ficha_number} />
        <Row k="Cédula" v={ali.cedula} />
        <Row k="Grupo sanguíneo" v={ali.blood_type} />
        <Row k="Rol" v={ali.rol} />
        <Row k="Organización" v={ali.organizacion} />
      </Section>

      <Section title="📞 Contacto">
        <Row k="Teléfono" v={ali.phone} />
        <Row k="Correo" v={ali.email} />
        <Row k="Dirección" v={ali.address} />
        <Row k="Ciudad" v={ali.city} />
        <Row k="Estado" v={ali.state} />
      </Section>

      {ali.notes ? (
        <Section title="📝 Notas">
          <Text style={{ color: FICHA.text, fontSize: 13 }}>{ali.notes}</Text>
        </Section>
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
