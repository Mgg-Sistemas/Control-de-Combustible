import React from 'react';
import QrScanner from '../components/QrScanner';

/** Extrae el id de máquina del texto del QR (URL con ?maquina=… o texto suelto). */
export function parseMachineId(text: string): string | null {
  if (!text) return null;
  try {
    const u = new URL(text);
    const id = u.searchParams.get('maquina');
    if (id) return id;
  } catch {}
  const m = text.match(/maquina=([\w-]+)/i);
  if (m) return m[1];
  // Si el QR trae solo un UUID.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim())) return text.trim();
  return null;
}

/** Extrae el id de empleado del texto del QR del carnet (URL con ?empleado=…). */
export function parseEmployeeId(text: string): string | null {
  if (!text) return null;
  try {
    const u = new URL(text);
    const id = u.searchParams.get('empleado');
    if (id) return id;
  } catch {}
  const m = text.match(/empleado=([\w-]+)/i);
  if (m) return m[1];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim())) return text.trim();
  return null;
}

/** Extrae el id de empresa del QR de distribución de comida (URL con ?comida=…). */
export function parseComidaId(text: string): string | null {
  if (!text) return null;
  try {
    const u = new URL(text);
    const id = u.searchParams.get('comida');
    if (id) return id;
  } catch {}
  const m = text.match(/comida=([\w-]+)/i);
  if (m) return m[1];
  return null;
}

/** Pantalla del escáner: al detectar el QR de una máquina abre su vista rápida. */
export default function ScanQrScreen({ navigation }: any) {
  const onDetected = (text: string) => {
    const id = parseMachineId(text);
    if (id) navigation.replace('MachineQuick', { machineId: id });
    else navigation.goBack();
  };
  return <QrScanner onDetected={onDetected} onClose={() => navigation.goBack()} />;
}
