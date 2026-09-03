import type { BoxType, Container, MultiPackProgress, MultiPackResult } from '../core'

/** Message from the page to the optimize worker. */
export interface OptimizeRequest {
  container: Container
  types: BoxType[]
  keepUpright: boolean
  optimizeRuns: number
}

/** Messages from the worker back to the page. */
export type OptimizeMessage =
  | { type: 'progress'; progress: MultiPackProgress }
  | { type: 'done'; result: MultiPackResult }
  | { type: 'error'; message: string }
