// Sistema de diseño — paletas de tonos neutros (claro y oscuro)
export type AppColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  primary: string;
  primaryContrast: string;
  text: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  // Variantes "soft" (fondo pastel/tenue + texto legible) para banners de aviso
  // dentro de una pantalla — a diferencia de success/warning/danger (pensados
  // para texto/bordes sólidos), estas SÍ cambian entre claro/oscuro para que un
  // banner de éxito/error/aviso no se vea "roto" (fondo claro fijo) en modo oscuro.
  successSoftBg: string;
  successSoftBorder: string;
  successSoftText: string;
  warningSoftBg: string;
  warningSoftBorder: string;
  warningSoftText: string;
  dangerSoftBg: string;
  dangerSoftBorder: string;
  dangerSoftText: string;
  infoSoftBg: string;
  infoSoftBorder: string;
  infoSoftText: string;
};

export const lightColors: AppColors = {
  background: '#F5F5F4',
  surface: '#FFFFFF',
  surfaceAlt: '#EAEAE8',
  border: '#D6D5D2',
  primary: '#3F3F46',
  primaryContrast: '#FFFFFF',
  text: '#1C1C1E',
  muted: '#6B7280',
  success: '#15803D',
  warning: '#B45309',
  danger: '#B91C1C',
  successSoftBg: '#E8F5EC',
  successSoftBorder: '#1E9E4A',
  successSoftText: '#0F5C2E',
  warningSoftBg: '#FFF7E6',
  warningSoftBorder: '#F0C36D',
  warningSoftText: '#7A4A0B',
  dangerSoftBg: '#FDECEC',
  dangerSoftBorder: '#D22B2B',
  dangerSoftText: '#8A1C1C',
  infoSoftBg: '#EAF1FB',
  infoSoftBorder: '#2563EB',
  infoSoftText: '#12356B',
};

export const darkColors: AppColors = {
  background: '#18181B',
  surface: '#27272A',
  surfaceAlt: '#3F3F46',
  border: '#3F3F46',
  primary: '#E4E4E7',
  primaryContrast: '#18181B',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  successSoftBg: '#123420',
  successSoftBorder: '#22C55E',
  successSoftText: '#8FE3AE',
  warningSoftBg: '#3A2C0F',
  warningSoftBorder: '#F59E0B',
  warningSoftText: '#F5CB7A',
  dangerSoftBg: '#3B1518',
  dangerSoftBorder: '#EF4444',
  dangerSoftText: '#F5A3A3',
  infoSoftBg: '#132A4A',
  infoSoftBorder: '#3B82F6',
  infoSoftText: '#9DC0F5',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export function makeTypography(c: AppColors) {
  return {
    title: { fontSize: 22, fontWeight: '700' as const, color: c.text },
    subtitle: { fontSize: 16, fontWeight: '600' as const, color: c.text },
    body: { fontSize: 15, color: c.text },
    muted: { fontSize: 13, color: c.muted },
  };
}

export type AppTypography = ReturnType<typeof makeTypography>;
