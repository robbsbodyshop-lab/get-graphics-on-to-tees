declare module 'imagetracerjs' {
  interface ImageTracerApi {
    imagedataToSVG(imgd: { width: number; height: number; data: Uint8ClampedArray }, options?: Record<string, unknown>): string
  }
  const tracer: ImageTracerApi
  export default tracer
}
