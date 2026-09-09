import { packMany } from '../core'
import type { OptimizeMessage, OptimizeRequest } from './optimizeProtocol'

const post = (message: OptimizeMessage) => self.postMessage(message)

self.onmessage = ({ data }: MessageEvent<OptimizeRequest>) => {
  try {
    let reported = -1
    const result = packMany(data.container, data.types, {
      keepUpright: data.keepUpright,
      mode: data.mode,
      allocation: data.allocation,
      optimizeRuns: data.optimizeRuns,
      budgetMs: data.budgetMs,
      onProgress: (progress) => {
        // A run takes a few milliseconds; every fifth is plenty for a progress line.
        if (progress.runs - reported >= 5) {
          reported = progress.runs
          post({ type: 'progress', progress })
        }
      },
    })
    post({ type: 'done', result })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
