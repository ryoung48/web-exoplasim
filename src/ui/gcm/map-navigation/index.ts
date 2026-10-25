import {
	MathUtils,
	MOUSE,
	OrthographicCamera,
	TOUCH,
	Vector2,
	Vector3,
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import type {
	GcmMapNavigation,
	GcmMapNavigationRequest,
} from "@/ui/gcm/map-navigation/types"

const LONGITUDE_HALF_SPAN = 180
const LATITUDE_HALF_SPAN = 90
const MIN_ZOOM = 1
const MAX_ZOOM = 60
const BUTTON_ZOOM_FACTOR = 1.5

function create({
	canvas,
	onView,
	onHover,
}: GcmMapNavigationRequest): GcmMapNavigation {
	const camera = new OrthographicCamera(-180, 180, 90, -90, 0.1, 100)
	camera.position.z = 10
	const controls = new OrbitControls(camera, canvas)
	controls.enableRotate = false
	controls.screenSpacePanning = true
	controls.panSpeed = 1.4
	controls.zoomToCursor = true
	controls.minZoom = MIN_ZOOM
	controls.maxZoom = MAX_ZOOM
	controls.mouseButtons = {
		LEFT: MOUSE.PAN,
		MIDDLE: MOUSE.PAN,
		RIGHT: MOUSE.PAN,
	}
	controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }
	const cursor = new Vector2()
	const point = new Vector3()
	let hovered = false
	let dragging = false

	const hover = () => {
		if (!hovered || dragging) {
			onHover(null)
			return
		}
		const bounds = canvas.getBoundingClientRect()
		if (!bounds.width || !bounds.height) return
		point
			.set(
				((cursor.x - bounds.left) / bounds.width) * 2 - 1,
				1 - ((cursor.y - bounds.top) / bounds.height) * 2,
				0,
			)
			.unproject(camera)
		if (point.y < -90 || point.y > 90) {
			onHover(null)
			return
		}
		onHover({
			latitude: point.y,
			longitude: MathUtils.euclideanModulo(point.x + 180, 360) - 180,
		})
	}
	const redraw = () => {
		const aspect = canvas.width / canvas.height
		const halfFrustumHeight = Math.max(
			LATITUDE_HALF_SPAN,
			LONGITUDE_HALF_SPAN / aspect,
		)
		camera.left = -halfFrustumHeight * aspect
		camera.right = halfFrustumHeight * aspect
		camera.top = halfFrustumHeight
		camera.bottom = -halfFrustumHeight
		camera.updateProjectionMatrix()
		const halfWidth = camera.right / camera.zoom
		const halfHeight = camera.top / camera.zoom
		const x = MathUtils.euclideanModulo(camera.position.x + 180, 360) - 180
		const y =
			halfHeight >= LATITUDE_HALF_SPAN
				? 0
				: MathUtils.clamp(camera.position.y, -90 + halfHeight, 90 - halfHeight)
		controls.target.x += x - camera.position.x
		controls.target.y += y - camera.position.y
		camera.position.x = x
		camera.position.y = y
		camera.updateMatrixWorld()
		onView({
			west: x - halfWidth,
			north: y + halfHeight,
			longitudeSpan: 2 * halfWidth,
			latitudeSpan: 2 * halfHeight,
		})
		hover()
	}
	const move = (event: PointerEvent) => {
		const bounds = canvas.getBoundingClientRect()
		hovered =
			event.clientX >= bounds.left &&
			event.clientX <= bounds.right &&
			event.clientY >= bounds.top &&
			event.clientY <= bounds.bottom
		cursor.set(event.clientX, event.clientY)
		hover()
	}
	const leave = () => {
		hovered = false
		onHover(null)
	}
	const start = () => {
		dragging = true
		onHover(null)
		canvas.style.cursor = "grabbing"
	}
	const end = () => {
		dragging = false
		canvas.style.cursor = "grab"
		hover()
	}
	const zoom = (factor: number) => {
		camera.zoom = MathUtils.clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM)
		camera.updateProjectionMatrix()
		controls.update()
		redraw()
	}
	canvas.style.cursor = "grab"
	controls.addEventListener("change", redraw)
	controls.addEventListener("start", start)
	controls.addEventListener("end", end)
	canvas.addEventListener("pointermove", move)
	canvas.addEventListener("pointerleave", leave)
	controls.update()
	redraw()
	return {
		redraw,
		reset: () => {
			camera.zoom = MIN_ZOOM
			camera.position.set(0, 0, 10)
			controls.target.set(0, 0, 0)
			camera.updateProjectionMatrix()
			controls.update()
			redraw()
		},
		zoomIn: () => zoom(BUTTON_ZOOM_FACTOR),
		zoomOut: () => zoom(1 / BUTTON_ZOOM_FACTOR),
		dispose: () => {
			controls.removeEventListener("change", redraw)
			controls.removeEventListener("start", start)
			controls.removeEventListener("end", end)
			controls.dispose()
			canvas.removeEventListener("pointermove", move)
			canvas.removeEventListener("pointerleave", leave)
			onHover(null)
		},
	}
}

export const GCM_MAP_NAVIGATION = { create }
