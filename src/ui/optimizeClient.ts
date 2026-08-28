import { DEFAULT_MAX_RUNS, optimize } from '../core'
import type { OptimizeMessage, OptimizeRequest } from './optimizeProtocol'
import type { Store } from './state'

export interface OptimizeController {
  start(): void
  cancel(): void
}

/**
 * Runs the optimizer in a Web Worker so the page stays responsive, and
 * mirrors progress and the result into the store. Cancelling terminates the
 * worker; the next run gets a fresh one.
 */
export function createOptimizeController(store: Store): OptimizeController {
  let worker: Worker | null = null

  function dispose(): void {
    worker?.terminate()
    worker = null
  }

  function finish(message: OptimizeMessage): void {
    switch (message.type) {
      case 'progress':
        store.setOptimize({ runs: message.progress.runs, bestKept: message.progress.bestKept })
        break
      case 'done':
        dispose()
        store.setOptimize({ status: 'done', result: message.result, runs: message.result.runs })
        break
      case 'error':
        dispose()
        store.setOptimize({ status: 'failed', error: message.message })
        break
    }
  }

  function runInline(request: OptimizeRequest): void {
    try {
      const result = optimize(request.container, request.types, {
        keepUpright: request.keepUpright,
        objective: request.objective,
        maxRuns: request.maxRuns,
      })
      finish({ type: 'done', result })
    } catch (error) {
      finish({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  // An edit resets the optimize state to idle; a worker still running for the old input is stale.
  store.subscribe((state) => {
    if (state.optimize.status !== 'running' && worker) dispose()
  })

  return {
    start() {
      const { derived, optimize: current } = store.get()
      const scenario = derived.scenario
      if (!scenario || current.status === 'running') return
      const request: OptimizeRequest = {
        container: scenario.container,
        types: scenario.types,
        keepUpright: scenario.keepUpright,
        objective: current.objective,
        maxRuns: DEFAULT_MAX_RUNS,
      }
      store.setOptimize({
        status: 'running',
        runs: 0,
        maxRuns: request.maxRuns,
        bestKept: 0,
        result: null,
        error: null,
      })
      if (typeof Worker === 'undefined') {
        runInline(request)
        return
      }
      dispose()
      worker = new Worker(new URL('./optimizeWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }: MessageEvent<OptimizeMessage>) => finish(data)
      worker.onerror = (event) => {
        dispose()
        store.setOptimize({ status: 'failed', error: event.message || 'The optimizer crashed.' })
      }
      worker.postMessage(request)
    },
    cancel() {
      dispose()
      store.setOptimize({ status: 'idle', result: null, error: null })
    },
  }
}
