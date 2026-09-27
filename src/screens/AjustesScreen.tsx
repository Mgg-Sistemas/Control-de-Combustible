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
  const { signOut, session, configured, fullName, role } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();

  // ⭐ REGLA DE LA CASA (27-sep-2026, pedido explícito): UN ADMIN TIENE ACCESO A
  //    TODO. El respaldo estaba gateado SOLO por nombre propio, y un admin
  //    llamado de otra forma abría Ajustes y veía únicamente «Cerrar sesión»,
  //    como si el módulo estuviera roto. El rol manda; los nombres quedan solo
  //    para quien puede descargar sin ser admin (Antoni Vargas).
  const nfull = (fullName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const esSuperadmin = nfull.includes('ANTHONY') || nfull.includes('ANGELICA');
  // "frank vargas" también existe, por eso se exige ANTONI + VARGAS.
  const esAntoniVargas = nfull.includes('ANTONI') && nfull.includes('VARGAS');
  const puedeBackup = role === 'admin' || esSuperadmin || esAntoniVargas;
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const doBackup = async () => {
    setBackupBusy(true); setBackupMsg('Preparando…');
    try {
      const { runBackup } = await import('../lib/backup');
      const res = await runBackup((name, i, total) => setBackupMsg(`Respaldando ${i}/${total}: ${name}…`));
      // ⚠️ SI ALGUNA TABLA FALLÓ, SE DICE CON SU NOMBRE. Un respaldo incompleto que
      //    parece completo es peor que uno que falla: nadie lo revisa hasta el día
      //    que hace falta restaurarlo.
      if (res.fallidas.length) {
        setBackupMsg(
          `⚠️ Respaldo descargado PERO INCOMPLETO: ${res.fallidas.length} tabla(s) no se pudieron leer `
          + `(${res.fallidas.map((f) => f.tabla).join(', ')}). Vuelve a generarlo antes de confiar en él. `
          + `Se llevó ${res.filas.toLocaleString('es-VE')} filas de ${res.tablas} tablas.`,
        );
        toast.error(`Respaldo INCOMPLETO: fallaron ${res.fallidas.length} tabla(s).`);
      } else {
        setBackupMsg(`✓ Respaldo .sql descargado: ${res.filas.toLocaleString('es-VE')} filas de ${res.tablas} tablas.`);
        toast.success('Respaldo descargado.');
      }
    } catch (e: any) {
      setBackupMsg(`❌ No se pudo generar el respaldo (${e?.message ?? 'revisa la conexión'}).`);
      toast.error('No se pudo generar el respaldo.');
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
            <Text style={{ fontWeight: '700', color: colors.text }}>Respaldo de la base de datos</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Descarga un archivo <Text style={{ fontWeight: '800' }}>.sql</Text> con los datos de TODAS las tablas
              (máquinas, jornadas, empleados, pagos, inventario, ventas, compras…), listo para volver a meterlo en
              Supabase. No trae el esquema ni la bitácora de auditoría. Tarda unos minutos: no cierres la pestaña.
              Acceso para administradores.
            </Text>
            <TouchableOpacity onPress={doBackup} disabled={backupBusy} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', opacity: backupBusy ? 0.6 : 1 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{backupBusy ? 'Generando…' : '⬇️ Descargar respaldo (.sql)'}</Text>
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
