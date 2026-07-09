import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

/**
 * Escáner de QR en NATIVO (iOS/Android) con expo-camera. En web se usa
 * QrScanner.web.tsx (getUserMedia + jsQR); Metro elige el archivo por plataforma.
 */
export default function QrScanner({ onDetected, onClose }: { onDetected: (text: string) => void; onClose: () => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) requestPerm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm?.granted]);

  if (!perm) {
    return <View style={styles.c}><Text style={styles.t}>Solicitando cámara…</Text></View>;
  }
  if (!perm.granted) {
    return (
      <View style={styles.c}>
        <Text style={[styles.t, { marginBottom: 12 }]}>Se necesita permiso de cámara para escanear.</Text>
        <TouchableOpacity onPress={requestPerm} style={styles.btn}><Text style={styles.btnT}>Dar permiso</Text></TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={[styles.btn, { marginTop: 8, backgroundColor: '#333' }]}><Text style={[styles.btnT, { color: '#fff' }]}>Cerrar</Text></TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => { if (!done) { setDone(true); onDetected(data); } }}
      />
      <Text style={[styles.t, { position: 'absolute', top: 60, alignSelf: 'center' }]}>Apunta al QR de la máquina…</Text>
      <TouchableOpacity onPress={onClose} style={[styles.btn, { position: 'absolute', bottom: 50, alignSelf: 'center' }]}>
        <Text style={styles.btnT}>Cerrar</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 },
  t: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btn: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnT: { fontWeight: '800', fontSize: 15 },
});
