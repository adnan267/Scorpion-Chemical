// Colours come from Scorpion Chemical's own printed rate list and logo:
// the blue rate boxes, the teal flask and the lime drop.
export const C = {
  ink: '#16283A',
  sub: '#56667A',
  faint: '#8A97A6',
  line: '#DDE4EC',
  paper: '#F2F5F9',
  surface: '#FFFFFF',
  blue: '#0B5CAD',
  blueDark: '#084683',
  blueSoft: '#E5EFF9',
  teal: '#1FA3B2',
  tealSoft: '#E1F4F6',
  lime: '#A8CF3A',
  green: '#23804E',
  greenSoft: '#E2F3E9',
  amber: '#A8690A',
  amberSoft: '#FBEFD7',
  red: '#C3352B',
  redSoft: '#FBE8E6',
  graySoft: '#E9EDF2',
  white: '#FFFFFF',
};

export const F = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semi: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
};

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const R = { tag: 4, input: 8, card: 10 };

export const WIDE = 900;
export const CONTENT_MAX = 1040;

export type Tone = 'blue' | 'teal' | 'green' | 'amber' | 'red' | 'gray';

export const TONES: Record<Tone, { fg: string; bg: string }> = {
  blue: { fg: C.blue, bg: C.blueSoft },
  teal: { fg: '#127A86', bg: C.tealSoft },
  green: { fg: C.green, bg: C.greenSoft },
  amber: { fg: C.amber, bg: C.amberSoft },
  red: { fg: C.red, bg: C.redSoft },
  gray: { fg: C.sub, bg: C.graySoft },
};

export const ORDER_TONE: Record<string, Tone> = {
  pending: 'amber',
  confirmed: 'blue',
  dispatched: 'teal',
  delivered: 'green',
  cancelled: 'gray',
};

export const PAYMENT_TONE: Record<string, Tone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
};
