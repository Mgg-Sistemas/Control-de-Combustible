// Sistema de diseño — paleta de tonos neutros
export const colors = {
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

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const typography = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  subtitle: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
};
