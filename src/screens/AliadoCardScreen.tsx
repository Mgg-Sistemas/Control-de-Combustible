import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Screen, Card, Loading } from '../components/ui';
import { supabase } from '../lib/supabase';
import { Aliado } from '../types/database';
import { qrPngDataUri, aliadoQrUrl } from '../lib/qr';
import { carnetAliadoHtml, carnetAliadoFront, carnetAliadoBack, carnetAliadoStyles, CARNET_ALIADO_MM } from '../lib/carnet';
import { exportPdf, exportCardImage, urlToDataUri } from '../lib/pdf';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const LOGO = require('../../assets/logo.png');

// Paleta fija del carnet del aliado.
const FICHA = { bg: '#EAF1FB', card: '#FFFFFF', brand: '#1E3A5F', text: '#1F2937', muted: '#6B7280', border: '#D7E3F4' };

const fullName = (a: Pick<Aliado, 'first_name' | 'last_name'>) => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();

/**
 * Carnet del aliado (la ficha y el carnet son lo MISMO). Se abre al escanear su QR
 * (deep-link ?aliado=<id>) o desde el módulo Aliados. Muestra el carnet y permite
 * descargar el FRENTE y el REVERSO como imagen (300 dpi) o el PDF con ambas caras.
 */
export default function AliadoCardScreen(props: { aliadoId?: string; onExit?: () => void; route?: any; navigation?: any }) {
  const { colors } = useTheme();
  const aliadoId: string = props.aliadoId ?? props.route?.params?.aliadoId ?? '';
  const onExit = props.onExit ?? (() => props.navigation?.goBack?.());

  const [loading, setLoading] = useState(true);
  const [ali, setAli] = useState<Aliado | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { try { await supabase.auth.signInAnonymously(); } catch {} }
      const { data } = await supabase.from('aliados').select('*').eq('id', aliadoId).maybeSingle();
      setAli((data as any) ?? null);
      if (data) { try { setQrUri(await qrPngDataUri(aliadoQrUrl((data as any).id), 320)); } catch {} }
      setLoading(false);
    })();
  }, [aliadoId]);

  const getSvg = async () => { try { return await qrPngDataUri(aliadoQrUrl(ali!.id), 420); } catch { return ''; } };

  const carnetPdf = async () => {
    if (!ali) return;
    const svg = await getSvg();
    const photoData = await urlToDataUri(ali.photo_url);
    await exportPdf(carnetAliadoHtml(ali, { qrSvg: svg, photoOverride: photoData ?? undefined }), `Carnet Aliado - ${fullName(ali)}`);
  };

  const imagenFrente = async () => {
    if (!ali) return;
    const svg = await getSvg();
    const photoData = await urlToDataUri(ali.photo_url);
    await exportCardImage({
      styles: carnetAliadoStyles, card: carnetAliadoFront(ali, { photoOverride: photoData ?? undefined }),
      mmW: CARNET_ALIADO_MM.w, mmH: CARNET_ALIADO_MM.h, dpi: 300,
      fileName: `Carnet Aliado (frente) - ${fullName(ali)}`,
      htmlForFallback: carnetAliadoHtml(ali, { qrSvg: svg, photoOverride: photoData ?? undefined }),
    });
  };

  const imagenReverso = async () => {
    if (!ali) return;
    const svg = await getSvg();
    await exportCardImage({
      styles: carnetAliadoStyles, card: carnetAliadoBack(ali, { qrSvg: svg }),
      mmW: CARNET_ALIADO_MM.w, mmH: CARNET_ALIADO_MM.h, dpi: 300,
      fileName: `Carnet Aliado (reverso) - ${fullName(ali)}`,
      htmlForFallback: carnetAliadoHtml(ali, { qrSvg: svg }),
    });
  };

  if (loading) return <Screen><Loading /></Screen>;
  if (!ali) {
    return (
      <Screen>
        <Card><Text style={{ color: colors.danger, fontWeight: '700' }}>No se encontró el carnet de este código QR.</Text></Card>
        <TouchableOpacity onPress={onExit} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>← Ir al sistema</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  // Vista previa (frente y reverso) al estilo de la credencial 54×86.
  const CardFace = ({ children }: { children: React.ReactNode }) => (
    <View style={{ width: 210, height: 334, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: FICHA.border, overflow: 'hidden', alignItems: 'center', paddingTop: 24, paddingHorizontal: 14 }}>
      {/* olas decorativas */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 54, backgroundColor: FICHA.brand, borderBottomRightRadius: 80 }} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 44, backgroundColor: FICHA.brand, borderTopLeftRadius: 80 }} />
      {children}
    </View>
  );

  return (
    <Screen bg={FICHA.bg}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
        <Image source={LOGO} style={{ width: 34, height: 34 }} resizeMode="contain" />
        <Text style={{ color: FICHA.brand, fontWeight: '800', fontSize: 15 }}>Carnet de aliado</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' }}>
        {/* FRENTE */}
        <CardFace>
          <Image source={LOGO} style={{ width: 52, height: 34, marginBottom: 4, zIndex: 1 }} resizeMode="contain" />
          {ali.photo_url ? (
            <Image source={{ uri: ali.photo_url }} style={{ width: 92, height: 110, borderRadius: 6, borderWidth: 1, borderColor: FICHA.brand, zIndex: 1 }} resizeMode="cover" />
          ) : (
            <View style={{ width: 92, height: 110, borderRadius: 6, backgroundColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}><Text style={{ fontSize: 44 }}>👤</Text></View>
          )}
          <Text style={{ color: FICHA.brand, fontWeight: '900', fontSize: 15, textAlign: 'center', marginTop: 6, zIndex: 1 }}>{fullName(ali)}</Text>
          <View style={{ backgroundColor: FICHA.brand, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 2, marginTop: 4, zIndex: 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 1 }}>ALIADO</Text>
          </View>
          <Text style={{ color: FICHA.muted, fontSize: 9, fontWeight: '700', marginTop: 6, zIndex: 1 }}>N° DE FICHA</Text>
          <Text style={{ color: FICHA.brand, fontSize: 22, fontWeight: '900', letterSpacing: 4, zIndex: 1 }}>{ali.ficha_number || '----'}</Text>
        </CardFace>

        {/* REVERSO */}
        <CardFace>
          <Image source={LOGO} style={{ width: 58, height: 38, marginBottom: 6, zIndex: 1 }} resizeMode="contain" />
          {qrUri ? (
            <Image source={{ uri: qrUri }} style={{ width: 112, height: 112, zIndex: 1, backgroundColor: '#fff' }} resizeMode="contain" />
          ) : null}
          <Text style={{ color: FICHA.brand, fontSize: 10, fontWeight: '800', textAlign: 'center', marginTop: 6, zIndex: 1 }}>QR de acceso y control</Text>
          <Text style={{ color: FICHA.text, fontSize: 9, textAlign: 'center', marginTop: 8, zIndex: 1 }}>En caso de pérdida, por favor comunicarse a la empresa.</Text>
          <Text style={{ color: FICHA.brand, fontSize: 10, fontWeight: '800', marginTop: 3, zIndex: 1 }}>N° de ficha {ali.ficha_number || '----'}</Text>
        </CardFace>
      </View>

      <Text style={{ color: FICHA.muted, fontSize: 12, marginTop: spacing.md, textAlign: 'center' }}>Descargar (54 × 86 mm · 300 dpi)</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        <TouchableOpacity onPress={imagenFrente} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#059669' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🖼️ Frente</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={imagenReverso} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: '#0891B2' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🖼️ Reverso</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={carnetPdf} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: FICHA.brand }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>🪪 PDF</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
