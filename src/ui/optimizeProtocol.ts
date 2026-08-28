import type { BoxType, Container, Objective, OptimizeProgress, OptimizeResult } from '../core'

/** Message from the page to the optimize worker. */
export interface OptimizeRequest {
  container: Container
  types: BoxType[]
  keepUpright: boolean
  objective: Objective
  maxRuns: number
}

/** Messages from the worker back to the page. */
export type OptimizeMessage =
  | { type: 'progress'; progress: OptimizeProgress }
  | { type: 'done'; result: OptimizeResult }
  | { type: 'error'; message: string }
