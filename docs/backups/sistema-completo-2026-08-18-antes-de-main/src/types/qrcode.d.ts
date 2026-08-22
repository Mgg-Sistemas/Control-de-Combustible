// Declaración mínima para el paquete `qrcode` (usamos solo la generación de SVG).
declare module 'qrcode' {
  export function toString(text: string, opts?: Record<string, unknown>): Promise<string>;
  export function toDataURL(text: string, opts?: Record<string, unknown>): Promise<string>;
  const _default: {
    toString: typeof toString;
    toDataURL: typeof toDataURL;
  };
  export default _default;
}
