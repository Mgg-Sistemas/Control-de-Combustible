// ⛏️ FRENTES DE TRABAJO DE LA MAQUINARIA — pestaña de Reportes (02-oct-2026).
//
// Pedido del cliente: «una cosa son las ubicaciones y otra los frentes; vamos a
// crear un apartado en Reportes para hacer frentes, que sea como el de viajes de
// camiones pero de frentes, y que no choque ni rompa nada».
//
// Es el MISMO componente de viajes (`FrentesTrabajo`) con `tipo="maquinas"`:
// la misma lista de frentes, la misma asignación diaria por equipo, la misma
// hoja del día en PDF y el mismo historial — pero con TODAS las máquinas del
// catálogo y hablando de «equipos». Las tablas son las mismas (un frente es un
// frente, y un equipo tiene UN frente por día); cada apartado solo ve y cuenta
// los equipos de su lista, así que ninguno pisa al otro.
//
// ⚠️ NO es la ubicación. La ubicación/edificio la marca el inspector al revisar la
//    máquina y sale en 📍 Ubicaciones; el frente lo asigna la oficina acá.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { FrentesTrabajo, type CamionParaFrente } from './FrentesTrabajo';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { levelMeets } from '../lib/permissions';
import { selectAllRows } from '../lib/supabase';
import { caracasBusinessToday } from '../lib/caracasDay';
import { listFrentes, type FrenteTrabajo } from '../lib/camionViajes';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function FrentesReportesCard() {
  const { colors } = useTheme();
  const { session, fullName, moduleLevel } = useAuth();
  const [frentes, setFrentes] = useState<FrenteTrabajo[]>([]);
  const [faltaSql, setFaltaSql] = useState(false);
  const [maquinas, setMaquinas] = useState<CamionParaFrente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  // Asigna quien tiene Reportes completo o Viajes de camiones completo (la base
  // exige lo mismo). Los demás lo ven y sacan la hoja del día.
  const canFull = levelMeets(moduleLevel('reportes'), 'full') || levelMeets(moduleLevel('viajes_camiones'), 'full');

  const cargar = useCallback(async () => {
    setError(null);
    const [r, rows] = await Promise.all([
      listFrentes(),
      selectAllRows('machinery', 'id, code, plate, serial, marca, modelo, company:company_id(name)').catch((e: any) => { setError(String(e?.message ?? e)); return [] as any[]; }),
    ]);
    setFrentes(r.frentes); setFaltaSql(r.missing);
    if (r.error && !r.missing) setError(r.error);
    setMaquinas((rows as any[]).map((m) => ({
      id: String(m.id), code: limpio(m.code) || '—', plate: limpio(m.plate) || null, serial: limpio(m.serial) || null,
      companyName: limpio(m.company?.name) || null, marca: limpio(m.marca) || null, modelo: limpio(m.modelo) || null,
    })).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })));
  }, []);

  useEffect(() => { void cargar(); }, [cargar, recarga]);
  const lista = useMemo(() => maquinas, [maquinas]);

  return (
    <View>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>⛏️ Frentes de trabajo de la maquinaria</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.xs }}>
        Dónde trabaja cada equipo cada día. No es la ubicación (eso lo marca el inspector y sale en 📍 Ubicaciones):
        el frente lo asigna la oficina aquí, a una máquina, a varias o a toda una empresa, y sale en su hoja del día.
      </Text>
      {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error}</Text> : null}
      <FrentesTrabajo
        tipo="maquinas"
        frentes={frentes}
        faltaSql={faltaSql}
        canFull={canFull}
        camiones={lista}
        jornadaHoy={caracasBusinessToday()}
        uid={session?.user?.id ?? null}
        userName={fullName}
        onCambio={() => setRecarga((n) => n + 1)}
      />
    </View>
  );
}
