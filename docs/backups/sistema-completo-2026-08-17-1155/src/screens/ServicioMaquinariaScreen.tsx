import React from 'react';
import { TallerMaquinariaScreen } from './MantenimientoMaquinariaScreen';

/**
 * 🔧 SERVICIO DE MAQUINARIA — sección de lo que se DAÑÓ.
 *
 * Averías reportadas (por QR, por el inspector desde el teléfono o escaneando
 * desde acá), envío al taller, retorno operativo y el reporte de averías/gasto
 * por empresa.
 *
 * Es la misma pantalla que Mantenimiento con `seccion="servicio"`: mismas
 * consultas y mismas tablas, solo cambia QUÉ se muestra. Lo programado por
 * horómetro vive en `MantenimientoMaquinariaScreen`. La frontera entre las dos
 * es `machinery_repairs.tipo` ('correctivo' acá, 'preventivo' allá) — ver el
 * comentario de las secciones en `MantenimientoMaquinariaScreen.tsx`.
 */
export default function ServicioMaquinariaScreen() {
  return <TallerMaquinariaScreen seccion="servicio" />;
}
