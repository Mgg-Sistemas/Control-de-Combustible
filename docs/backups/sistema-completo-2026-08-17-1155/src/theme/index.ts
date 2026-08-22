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
  // ── Identidad de marca del REDISEÑO (aditivo; no reemplaza los tokens de arriba).
  //    Navy = color ancla de marca; ámbar = ÚNICO acento para lo accionable/urgente.
  //    Los tokens `tank*` colorean el medidor de nivel según el porcentaje.
  brand: string;            // navy de marca (fondo) — NO usar como texto sobre fondo oscuro
  brandContrast: string;    // texto sobre navy
  brandText: string;        // azul de marca para TEXTO/encabezados: adapta por tema (navy en claro, azul claro en oscuro)
  accent: string;           // ámbar accionable (#FFB020)
  accentContrast: string;   // texto sobre ámbar
  accentSoftBg: string;     // pastel ámbar (chips/badges)
  accentSoftText: string;
  tankTrack: string;        // fondo de la barra de nivel
  tankFill: string;         // nivel normal
  tankWarn: string;         // nivel bajo (ámbar)
  tankCrit: string;         // nivel crítico (rojo)
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
  brand: '#1D3D60',        // azul EXACTO del logo (muestreado de assets/logo.png)
  brandContrast: '#FFFFFF',
  brandText: '#1D3D60',    // texto/encabezados en claro: navy del logo (buen contraste sobre fondo claro)
  accent: '#FFB020',
  accentContrast: '#3A2703',
  accentSoftBg: '#FFF3DA',
  accentSoftText: '#8A5B00',
  tankTrack: '#EDF1F5',
  tankFill: '#2C5486',
  tankWarn: '#FFB020',
  tankCrit: '#D93A32',
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
  brand: '#1D3D60',        // azul EXACTO del logo (mismo en oscuro; banner navy con texto blanco)
  brandContrast: '#FFFFFF',
  brandText: '#8FB4DC',    // texto/encabezados en OSCURO: azul claro derivado del logo (legible sobre fondo oscuro)
  accent: '#FFB020',
  accentContrast: '#3A2703',
  accentSoftBg: '#3A2C0F',
  accentSoftText: '#F5CB7A',
  tankTrack: '#3F3F46',
  tankFill: '#4E7CB0',
  tankWarn: '#FFB020',
  tankCrit: '#EF4444',
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
