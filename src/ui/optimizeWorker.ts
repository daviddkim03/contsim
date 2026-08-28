import { optimize } from '../core'
import type { OptimizeMessage, OptimizeRequest } from './optimizeProtocol'

const post = (message: OptimizeMessage) => self.postMessage(message)

self.onmessage = ({ data }: MessageEvent<OptimizeRequest>) => {
  try {
    const result = optimize(data.container, data.types, {
      keepUpright: data.keepUpright,
      objective: data.objective,
      maxRuns: data.maxRuns,
      onProgress: (progress) => post({ type: 'progress', progress }),
    })
    post({ type: 'done', result })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
