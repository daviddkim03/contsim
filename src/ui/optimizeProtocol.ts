import type { BoxType, Container, LoadMode, MultiPackProgress, MultiPackResult } from '../core'

/** Message from the page to the optimize worker. */
export interface OptimizeRequest {
  container: Container
  types: BoxType[]
  keepUpright: boolean
  mode: LoadMode
  allocation: Record<string, number>[] | undefined
  optimizeRuns: number
  budgetMs: number
}

/** Messages from the worker back to the page. */
export type OptimizeMessage =
  | { type: 'progress'; progress: MultiPackProgress }
  | { type: 'done'; result: MultiPackResult }
  | { type: 'error'; message: string }
