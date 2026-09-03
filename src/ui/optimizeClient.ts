import { DEFAULT_OPTIMIZE_RUNS, packMany } from '../core'
import type { OptimizeMessage, OptimizeRequest } from './optimizeProtocol'
import type { Store } from './state'

export interface AutoOptimizer {
  dispose(): void
}

/**
 * Improves the container fill in the background. Whenever the inputs settle
 * on a packing that needs more than one container, the optimizer runs in a
 * Web Worker and its packing replaces the first-fit one as soon as it is in
 * (see shownResult). An edit discards the run; the next recompute starts a
 * fresh one. Progress is mirrored into the store for the status panel.
 */
export function startAutoOptimizer(store: Store): AutoOptimizer {
  let worker: Worker | null = null

  function dispose(): void {
    worker?.terminate()
    worker = null
  }

  function finish(message: OptimizeMessage): void {
    switch (message.type) {
      case 'progress':
        store.setOptimize({
          runs: message.progress.runs,
          maxRuns: message.progress.maxRuns,
          containers: message.progress.containers,
        })
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
      const result = packMany(request.container, request.types, {
        keepUpright: request.keepUpright,
        optimizeRuns: request.optimizeRuns,
      })
      finish({ type: 'done', result })
    } catch (error) {
      finish({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function start(): void {
    const { derived } = store.get()
    const scenario = derived.scenario
    if (!scenario) return
    const request: OptimizeRequest = {
      container: scenario.container,
      types: scenario.types,
      keepUpright: scenario.keepUpright,
      optimizeRuns: DEFAULT_OPTIMIZE_RUNS,
    }
    store.setOptimize({
      status: 'running',
      runs: 0,
      maxRuns: request.optimizeRuns,
      containers: 0,
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
  }

  /** Worth a run: the inputs are settled and first fit needed more than one container. */
  function pending(): boolean {
    const { derived, optimize } = store.get()
    return (
      !derived.stale &&
      optimize.status === 'idle' &&
      derived.result !== null &&
      derived.result.containers.length >= 2
    )
  }

  // Starting from inside a store notification would nest notifications; defer by a tick.
  const maybeStart = () => queueMicrotask(() => pending() && start())

  const unsubscribe = store.subscribe((state) => {
    // An edit resets the optimize state to idle; a worker still running for the old input is stale.
    if (state.optimize.status !== 'running' && worker) dispose()
    if (pending()) maybeStart()
  })
  maybeStart()

  return {
    dispose() {
      unsubscribe()
      dispose()
    },
  }
}
