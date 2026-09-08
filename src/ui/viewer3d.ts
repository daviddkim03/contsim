import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { BoxType, Container, Placement } from '../core'
import { query } from './dom'
import type { Panel } from './sidebar'
import { shownContainer, type AppState, type Store } from './state'
import {
  EDGE_FLOATS_PER_BOX,
  EDGE_VERTICES_PER_BOX,
  FOV,
  boxCenter,
  boxSize,
  frameContainer,
  visibleCount,
  writeBoxEdges,
} from './viewerMath'

const BACKGROUND = '#eef1f5'
const FLOOR = '#f7f8fa'
const CONTAINER_LINE = '#6b7280'
const EDGE = '#1b1e2b'
const EDGE_OPACITY = 0.55
const DIMMED_BOX = 0.08
const DIMMED_EDGE = 0.04

export interface Viewer extends Panel {
  resetView(): void
}

/**
 * Every box of one type, drawn in two calls: an instanced mesh for the solids
 * and one buffer for all the wireframes. A container holding a thousand boxes
 * costs the same as one holding ten, which per-box objects did not.
 */
interface TypeGroup {
  /** Sorted bottom-up, so the layer slider shows a prefix of them. */
  placements: Placement[]
  mesh: InstancedMesh
  edges: LineSegments
}

/** One geometry for every box: the instance matrix carries each box's size. */
const UNIT_BOX = new BoxGeometry(1, 1, 1)

/**
 * three.js view of the packing. Renders on demand (after input, state changes
 * and resizes) rather than in a loop, so an idle page costs nothing.
 */
export function mountViewer(root: HTMLElement, store: Store): Viewer {
  root.innerHTML = `
    <div class="viewer-canvas"></div>
    <div class="viewer-overlay hint" hidden></div>
  `
  const host = query<HTMLElement>(root, '.viewer-canvas')
  const overlay = query<HTMLElement>(root, '.viewer-overlay')

  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ antialias: true })
  } catch {
    overlay.hidden = false
    overlay.textContent =
      'The 3D view needs WebGL, which this browser does not provide. The Table view still works.'
    store.setView({ mode: 'table' })
    return { render() {}, resetView() {} }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.append(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(BACKGROUND)
  const camera = new PerspectiveCamera(FOV, 1, 1, 10000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.addEventListener('change', requestRender)
  // Until the user orbits, the camera follows the container and the viewport size.
  let userMoved = false
  controls.addEventListener('start', () => {
    userMoved = true
  })

  scene.add(new AmbientLight(0xffffff, 1.4))
  const key = new DirectionalLight(0xffffff, 2.2)
  key.position.set(1, 2, 1.5)
  scene.add(key)
  const fill = new DirectionalLight(0xffffff, 0.7)
  fill.position.set(-1.5, 1, -1)
  scene.add(fill)

  const containerGroup = new Group()
  const boxesGroup = new Group()
  scene.add(containerGroup, boxesGroup)

  const materials = new Map<string, MeshLambertMaterial>()
  const edgeMaterials = new Map<string, LineBasicMaterial>()
  let groups: TypeGroup[] = []
  let lastPlacements: Placement[] | null = null
  let lastContainer: Container | null = null
  let lastLayer: number | null | undefined
  const matrix = new Matrix4()

  function materialFor(typeId: string, color: string): MeshLambertMaterial {
    let m = materials.get(typeId)
    if (!m) {
      m = new MeshLambertMaterial({ color })
      materials.set(typeId, m)
    } else if (m.color.getHexString() !== new Color(color).getHexString()) {
      m.color.set(color)
    }
    return m
  }

  function edgeMaterialFor(typeId: string): LineBasicMaterial {
    let m = edgeMaterials.get(typeId)
    if (!m) {
      m = new LineBasicMaterial({ color: EDGE, transparent: true, opacity: EDGE_OPACITY })
      edgeMaterials.set(typeId, m)
    }
    return m
  }

  function rebuildContainer(c: Container): void {
    for (const child of containerGroup.children) {
      if (child instanceof Mesh || child instanceof LineSegments) child.geometry.dispose()
    }
    containerGroup.clear()
    const outline = new LineSegments(
      new EdgesGeometry(new BoxGeometry(c.l, c.h, c.w)),
      new LineBasicMaterial({ color: CONTAINER_LINE }),
    )
    outline.position.set(c.l / 2, c.h / 2, c.w / 2)
    const floor = new Mesh(
      new PlaneGeometry(c.l, c.w),
      new MeshBasicMaterial({
        color: FLOOR,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(c.l / 2, 0, c.w / 2)
    containerGroup.add(floor, outline)
  }

  function frame(c: Container): void {
    userMoved = false
    const f = frameContainer(c, camera.aspect)
    camera.position.set(f.position.x, f.position.y, f.position.z)
    camera.near = Math.max(f.extent / 200, 0.01)
    camera.far = f.extent * 20
    camera.updateProjectionMatrix()
    controls.target.set(f.target.x, f.target.y, f.target.z)
    controls.minDistance = f.extent * 0.15
    controls.maxDistance = f.extent * 6
    controls.update()
  }

  /** One instanced mesh and one edge buffer per box type, sized for every box of that type. */
  function rebuildBoxes(placements: Placement[], types: Map<string, BoxType>): void {
    for (const group of groups) {
      group.mesh.dispose()
      group.edges.geometry.dispose()
    }
    boxesGroup.clear()

    const byType = new Map<string, Placement[]>()
    for (const p of placements) {
      const list = byType.get(p.typeId)
      if (list) list.push(p)
      else byType.set(p.typeId, [p])
    }

    groups = [...byType].map(([typeId, ofType]) => {
      // Bottom-up, so the layer slider only has to draw fewer of them.
      ofType.sort((a, b) => a.z - b.z)
      const mesh = new InstancedMesh(
        UNIT_BOX,
        materialFor(typeId, types.get(typeId)?.color ?? '#888888'),
        ofType.length,
      )
      // A handful of draw calls, all inside the container: culling would only cost time.
      mesh.frustumCulled = false

      const positions = new Float32Array(ofType.length * EDGE_FLOATS_PER_BOX)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(positions, 3))
      const edges = new LineSegments(geometry, edgeMaterialFor(typeId))
      edges.frustumCulled = false

      ofType.forEach((p, i) => {
        const c = boxCenter(p)
        const s = boxSize(p)
        matrix.makeScale(s.x, s.y, s.z)
        matrix.setPosition(c.x, c.y, c.z)
        mesh.setMatrixAt(i, matrix)
        writeBoxEdges(positions, i, p)
      })
      mesh.instanceMatrix.needsUpdate = true

      boxesGroup.add(mesh, edges)
      return { placements: ofType, mesh, edges }
    })
    lastLayer = undefined
  }

  /** Draws only the boxes at or below the layer height. */
  function applyLayer(layer: number | null): void {
    let visible = 0
    for (const group of groups) {
      const shown = visibleCount(group.placements, layer)
      group.mesh.count = shown
      group.edges.geometry.setDrawRange(0, shown * EDGE_VERTICES_PER_BOX)
      visible += shown
    }
    lastLayer = layer
    root.dataset.boxes = String(visible)
  }

  function applyView({ view }: AppState): void {
    containerGroup.visible = view.showContainer
    if (view.layer !== lastLayer) applyLayer(view.layer)
    for (const [typeId, m] of materials) {
      const dim = view.hoverTypeId !== null && view.hoverTypeId !== typeId
      m.transparent = dim
      m.opacity = dim ? DIMMED_BOX : 1
      m.depthWrite = !dim
    }
    for (const [typeId, m] of edgeMaterials) {
      const dim = view.hoverTypeId !== null && view.hoverTypeId !== typeId
      m.opacity = dim ? DIMMED_EDGE : EDGE_OPACITY
    }
    root.dataset.hover = view.hoverTypeId ?? ''
  }

  let renderQueued = false
  function requestRender(): void {
    if (renderQueued) return
    renderQueued = true
    requestAnimationFrame(() => {
      renderQueued = false
      renderer.render(scene, camera)
    })
  }

  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = host
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    if (!userMoved && lastContainer) frame(lastContainer)
    requestRender()
  }).observe(host)

  return {
    render(state) {
      const { scenario } = state.derived
      const shown = shownContainer(state)
      root.dataset.container = String(shown.index)
      overlay.hidden = scenario !== null
      if (!scenario) overlay.textContent = 'Fix the inputs to see the packing.'

      if (scenario) {
        const c = scenario.container
        if (
          !lastContainer ||
          lastContainer.l !== c.l ||
          lastContainer.w !== c.w ||
          lastContainer.h !== c.h
        ) {
          lastContainer = c
          rebuildContainer(c)
          frame(c)
        }
        const placements = shown.packing?.placements ?? []
        if (placements !== lastPlacements) {
          lastPlacements = placements
          rebuildBoxes(placements, new Map(scenario.types.map((t) => [t.id, t])))
        }
      } else if (lastPlacements !== null) {
        lastPlacements = null
        rebuildBoxes([], new Map())
      }
      applyView(state)
      requestRender()
    },
    resetView() {
      if (lastContainer) {
        frame(lastContainer)
        requestRender()
      }
    },
  }
}
