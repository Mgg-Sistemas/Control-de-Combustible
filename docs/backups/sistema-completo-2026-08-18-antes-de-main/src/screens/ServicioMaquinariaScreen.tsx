import React from 'react';
import { TallerMaquinariaScreen } from './MantenimientoMaquinariaScreen';

/**
 * 🔧 SERVICIO DE MAQUINARIA — sección de lo que se DAÑÓ.
 *
 * Averías reportadas (por QR, por el inspector desde el teléfono, escaneando desde
 * acá o cargándolas a mano), su corrección, el historial de lo resuelto y el
 * reporte de averías/gasto por empresa. Acá NO se manda nada al taller: el envío
 * a reparación y el retorno operativo viven solo en Mantenimiento.
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
