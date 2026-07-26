declare module 'svgdom' {
  export function createSVGWindow(): Window & typeof globalThis;
}
