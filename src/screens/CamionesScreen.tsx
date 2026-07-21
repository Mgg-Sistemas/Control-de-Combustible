import React from 'react';
import { Screen, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import TruckYardCalendar from '../components/TruckYardCalendar';

/** Submódulo "Entrada y salida de camiones": calendario de movimientos del patio.
 *  Visible para el administrador (desde Inspecciones) y el Coordinador de Patio. */
export default function CamionesScreen() {
  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>🚚 Entrada y salida de camiones</SectionTitle>
      <TruckYardCalendar />
    </Screen>
  );
}
