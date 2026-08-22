import React, { useState } from 'react';
import { Text, TouchableOpacity, View, Platform } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

/**
 * AJUSTES — preferencias de la cuenta y del dispositivo, reunidas en un módulo
 * propio: apariencia (modo oscuro), seguridad (contraseña + huella/Face ID) y
 * cerrar sesión. Antes vivían al final de la pantalla "Más"; se separaron para
 * que "Más" sea solo el menú de módulos.
 */
export default function AjustesScreen() {
  const { signOut, session, configured, fullName } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();

  // Acceso "superadmin/desarrollador": SOLO Anthony y Angelica (por nombre, sin
  // tildes). Gatea el Backup de la BD y el panel masivo de activar/desactivar
  // máquinas (ambos son herramientas sensibles, no de uso diario del resto de
  // admins). Web.
  const nfull = (fullName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const esSuperadmin = nfull.includes('ANTHONY') || nfull.includes('ANGELICA');
  const puedeBackup = esSuperadmin;
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const doBackup = async () => {
    setBackupBusy(true); setBackupMsg('Preparando…');
    try {
      const { runBackup } = await import('../lib/backup');
      const res = await runBackup((name, i, total) => setBackupMsg(`Respaldando ${i}/${total}: ${name}…`));
      setBackupMsg(`✓ Backup descargado: ${res.rows.toLocaleString('es-VE')} filas de ${res.tables} tablas.`);
      toast.success('Backup descargado.');
    } catch {
      setBackupMsg('❌ No se pudo generar el backup.');
      toast.error('No se pudo generar el backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <Screen>
      {/* Apariencia (modo oscuro) y Seguridad (contraseña + huella) viven SOLO en la
          tuerca ⚙️ del encabezado (HeaderSettings). Aquí quedan el respaldo y
          cerrar sesión, para no repetir las mismas opciones. */}
      {puedeBackup && Platform.OS === 'web' ? (
        <>
          <SectionTitle>Respaldo</SectionTitle>
          <Card>
            <Text style={{ fontWeight: '700', color: colors.text }}>Backup de la base de datos</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Descarga un archivo JSON con TODOS los datos (máquinas, jornadas, empleados, pagos, inventario…). Acceso restringido a Anthony y Angelica.
            </Text>
            <TouchableOpacity onPress={doBackup} disabled={backupBusy} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', opacity: backupBusy ? 0.6 : 1 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{backupBusy ? 'Generando…' : '⬇️ Descargar backup'}</Text>
            </TouchableOpacity>
            {backupMsg ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>{backupMsg}</Text> : null}
          </Card>
        </>
      ) : null}

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
