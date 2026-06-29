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
