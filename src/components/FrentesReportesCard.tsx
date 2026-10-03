// ⛏️ FRENTES DE TRABAJO DE LA MAQUINARIA — pestaña de Reportes (02-oct-2026).
//
// Pedido del cliente: «una cosa son las ubicaciones y otra los frentes; vamos a
// crear un apartado en Reportes para hacer frentes, que sea como el de viajes de
// camiones pero de frentes, y que no choque ni rompa nada».
//
// Es el MISMO componente de viajes (`FrentesTrabajo`) con `tipo="maquinas"`:
// la misma lista de frentes, la misma asignación diaria por equipo, la misma
// hoja del día en PDF y el mismo historial — pero con TODAS las máquinas del
// catálogo y hablando de «equipos». Y con SUS PROPIAS TABLAS (02-oct-2026,
// aclaración del cliente: «es sin viajes, solo para hacer el reporte de los
// frentes asignados, más nada»): su lista de frentes y sus asignaciones no
// tienen nada que ver con las de viajes, y manda el permiso de Reportes.
//
// ⚠️ NO es la ubicación. La ubicación/edificio la marca el inspector al revisar la
//    máquina y sale en 📍 Ubicaciones; el frente lo asigna la oficina acá.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { FrentesTrabajo, type CamionParaFrente, type DatosDelDiaFrente } from './FrentesTrabajo';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme';
import { levelMeets } from '../lib/permissions';
import { selectAllRows } from '../lib/supabase';
import { caracasBusinessToday } from '../lib/caracasDay';
import { FRENTES_MAQUINARIA, listFrentes, type FrenteTrabajo } from '../lib/camionViajes';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const n2 = (v: unknown) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «alto × largo × ancho m» de la ficha, o null si falta alguna medida. */
function medidasFicha(alto: unknown, largo: unknown, ancho: unknown): string | null {
  const v = [alto, largo, ancho].map(Number);
  return v.every((x) => Number.isFinite(x) && x > 0) ? `${n2(v[0])} × ${n2(v[1])} × ${n2(v[2])} m` : null;
}

/**
 * Lo del DÍA para la hoja de frentes de maquinaria (03-oct-2026): operador y
 * turno salen de la JORNADA de ese día (`machine_rounds`), no de viajes — este
 * apartado sigue siendo «sin viajes». Solo LEE; si falla, lanza, y la hoja avisa
 * en vez de salir con columnas vacías.
 */
async function datosDelDiaMaquinas(jornadaISO: string): Promise<Map<string, DatosDelDiaFrente>> {
  const rows = await selectAllRows(
    'machine_rounds', 'id, machinery_id, day_hours, night_hours, day_operator, night_operator',
    (q: any) => q.eq('round_date', jornadaISO),
  );
  const m = new Map<string, DatosDelDiaFrente>();
  (rows as any[]).forEach((r) => {
    const dia = Number(r.day_hours) > 0, noche = Number(r.night_hours) > 0;
    const prev = m.get(String(r.machinery_id));
    const operadores = Array.from(new Set([prev?.chofer, limpio(r.day_operator), limpio(r.night_operator)].flatMap((x) => String(x ?? '').split(' / ')).filter(Boolean)));
    const turnos = new Set([...(prev?.turno ? prev.turno.split(' y ').map((s) => s.toLowerCase()) : []), ...(dia ? ['día'] : []), ...(noche ? ['noche'] : [])]);
    m.set(String(r.machinery_id), {
      chofer: operadores.join(' / ') || null,
      turno: turnos.has('día') && turnos.has('noche') ? 'Día y noche' : turnos.has('día') ? 'Día' : turnos.has('noche') ? 'Noche' : null,
    });
  });
  return m;
}

export function FrentesReportesCard() {
  const { colors } = useTheme();
  const { session, fullName, moduleLevel } = useAuth();
  const [frentes, setFrentes] = useState<FrenteTrabajo[]>([]);
  const [faltaSql, setFaltaSql] = useState(false);
  const [maquinas, setMaquinas] = useState<CamionParaFrente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  // «Sin viajes» (02-oct-2026): ASIGNA quien tiene el permiso «Frentes de maquinaria»
  // (admin = completo; a los demás se les da en Usuarios). Reportes está abierto para
  // casi todos los roles, así que no sirve de candado: con él solo se VE y se saca la
  // hoja del día. La base exige lo mismo.
  const canFull = levelMeets(moduleLevel('frentes_maquinaria'), 'escritura');

  const cargar = useCallback(async () => {
    setError(null);
    const [r, rows] = await Promise.all([
      listFrentes(FRENTES_MAQUINARIA),
      selectAllRows('machinery', 'id, code, plate, serial, marca, modelo, clasificacion, location, operational, en_espera, active, height_m, length_m, width_m, company:company_id(name)').catch((e: any) => { setError(String(e?.message ?? e)); return [] as any[]; }),
    ]);
    setFrentes(r.frentes); setFaltaSql(r.missing);
    if (r.error && !r.missing) setError(r.error);
    setMaquinas((rows as any[]).map((m) => ({
      id: String(m.id), code: limpio(m.code) || '—', plate: limpio(m.plate) || null, serial: limpio(m.serial) || null,
      companyName: limpio(m.company?.name) || null, marca: limpio(m.marca) || null, modelo: limpio(m.modelo) || null,
      // Para las columnas opcionales de la hoja (03-oct-2026): lo que la FICHA sabe.
      medidas: medidasFicha(m.height_m, m.length_m, m.width_m),
      clasificacion: limpio(m.clasificacion) || null,
      obra: limpio(m.location) || null,
      estado: m.active === false ? 'Inactiva' : m.en_espera === true ? 'En espera' : m.operational === false ? 'Inoperativa' : 'Operativa',
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
        Es independiente de Viajes de camiones: lista de frentes y asignaciones propias.
      </Text>
      {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error}</Text> : null}
      <FrentesTrabajo
        tipo="maquinas"
        fuente={FRENTES_MAQUINARIA}
        frentes={frentes}
        faltaSql={faltaSql}
        canFull={canFull}
        camiones={lista}
        jornadaHoy={caracasBusinessToday()}
        uid={session?.user?.id ?? null}
        userName={fullName}
        onCambio={() => setRecarga((n) => n + 1)}
        datosDelDia={datosDelDiaMaquinas}
      />
    </View>
  );
}
