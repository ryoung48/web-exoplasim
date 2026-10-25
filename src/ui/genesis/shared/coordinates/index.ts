import type { GeographicCoordinates } from "@/ui/genesis/shared/coordinates/types"

function format({
	latitude,
	longitude,
}: GeographicCoordinates): [string, string] {
	return [
		`${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`,
		`${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`,
	]
}

export const COORDINATES = { format }
