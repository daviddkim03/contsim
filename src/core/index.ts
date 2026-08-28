export type * from './types'
export { covered, insideContainer, orientations, overlaps, sizeVolume, volume } from './geometry'
export {
  describeImpossibility,
  findImpossibility,
  maxOfTypeAlone,
  type FeasibilityOptions,
  type ImpossibilityFormat,
} from './feasibility'
export { MAX_DIM, MAX_QTY, validateScenario, type ValidationIssue } from './validate'
