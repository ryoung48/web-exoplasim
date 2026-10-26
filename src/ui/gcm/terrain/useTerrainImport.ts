import { useMemo, useRef, useState } from "react"
import { GCM_BOUNDARY } from "@/model/climate/gcm/boundary"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_TERRAIN } from "@/model/climate/gcm/terrain"
import { GCM_TERRAIN_IMPORT } from "@/model/climate/gcm/terrain/import"
import type {
	GcmTerrainImage,
	GcmTerrainMapping,
} from "@/model/climate/gcm/terrain/import/types"
import type { GcmTerrainUpload } from "@/ui/gcm/terrain/types"

export function useTerrainImport(latitudes: number) {
	const [heightmap, setHeightmap] = useState<GcmTerrainImage | null>(null)
	const [mask, setMask] = useState<GcmTerrainImage | null>(null)
	const [mapping, setMapping] = useState<GcmTerrainMapping>({
		blackM: -8000,
		whiteM: 8000,
		seaLevelM: 0,
		invertMask: false,
	})
	const [fileError, setFileError] = useState("")
	const [pending, setPending] = useState(0)
	const versions = useRef({ heightmap: 0, mask: 0 })
	const result = useMemo(() => {
		try {
			if (!heightmap)
				return { terrain: null, summary: null, boundary: null, error: "" }
			const terrain = GCM_TERRAIN_IMPORT.create({ heightmap, mask, mapping })
			return {
				terrain,
				summary: GCM_TERRAIN.summary(terrain),
				boundary: GCM_BOUNDARY.fromTerrain({
					gravityMs2: 9.80665,
					grid: GCM_GRID.forLatitudes(latitudes),
					terrain,
				}),
				error: "",
			}
		} catch (error) {
			return {
				terrain: null,
				summary: null,
				boundary: null,
				error: String(error instanceof Error ? error.message : error),
			}
		}
	}, [heightmap, mask, mapping, latitudes])
	const read = async ({ file, kind }: GcmTerrainUpload) => {
		const version = ++versions.current[kind]
		setPending((value) => value + 1)
		setFileError("")
		if (kind === "heightmap") setHeightmap(null)
		else setMask(null)
		try {
			if (file.size > GCM_TERRAIN_IMPORT.MAX_FILE_BYTES)
				throw new Error("Terrain files must be smaller than 64 MiB")
			const image = GCM_TERRAIN_IMPORT.read({
				name: file.name,
				buffer: await file.arrayBuffer(),
			})
			if (version !== versions.current[kind]) return
			if (kind === "mask" && image.encoding !== "normalized")
				throw new Error("Choose a PNG land mask")
			if (kind === "heightmap") setHeightmap(image)
			else setMask(image)
		} catch (error) {
			if (version === versions.current[kind])
				setFileError(error instanceof Error ? error.message : String(error))
		} finally {
			setPending((value) => value - 1)
		}
	}
	return {
		...result,
		error: fileError || result.error,
		heightmap,
		mask,
		mapping,
		setMapping,
		read,
		busy: pending > 0,
		removeMask: () => {
			versions.current.mask++
			setMask(null)
			setFileError("")
		},
	}
}
