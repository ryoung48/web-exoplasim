import { KOPPEN } from "@/model/climate/classification/koppen"
import { PASTA } from "@/model/climate/classification/pasta"
import { PASTA_HYDROLOGY } from "@/model/climate/classification/pasta/hydrology"
import { GCM_ATMOSPHERE } from "@/model/climate/gcm/atmosphere"
import type {
	GcmClassificationRequest,
	GcmClimateScheme,
} from "@/model/climate/gcm/classification/types"
import { GCM_DOWNSCALE } from "@/model/climate/gcm/downscale"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmMapMode } from "@/model/climate/gcm/fields/types"

function definition(scheme: GcmClimateScheme) {
	return scheme === "pasta"
		? {
				label: "Pasta",
				name: (id: number) => PASTA.CLASSES[id].name,
				code: (id: number) => PASTA.CLASSES[id].code,
				color: (id: number) => PASTA.CLASSES[id].color,
			}
		: {
				label: "Köppen",
				name: KOPPEN.koppenClimateName,
				code: (id: number) => KOPPEN.koppenLabels[id],
				color: KOPPEN.koppenClimateColor,
			}
}

function classes({
	config,
	months,
	downscale,
	scheme,
}: GcmClassificationRequest): Uint8Array | null {
	if (months.length < 12) return null
	const monthDays = config.yearDays / 12
	if (!Number.isFinite(monthDays) || monthDays <= 0)
		throw new Error("Climate classification requires a positive year length")
	const ordered = months.toSorted((a, b) => a.month - b.month)
	const reference = ordered[0].snapshot
	const points = downscale
		? downscale.width * downscale.height
		: GCM_FIELDS.grid(reference).points
	const isLand =
		downscale?.land ??
		Uint8Array.from(
			GCM_FIELDS.field({ snapshot: reference, field: "landFraction" }),
			(value) => (value >= 0.5 ? 1 : 0),
		)
	const read = (mode: GcmMapMode) =>
		ordered.map(({ snapshot }) => {
			const values = GCM_FIELDS.values({ snapshot, mode })
			return !downscale
				? values
				: mode === "airTemperature" || mode === "surfaceTemperature"
					? GCM_DOWNSCALE.temperature({ downscale, values })
					: GCM_DOWNSCALE.interpolate({ downscale, values })
		})
	const temperatures = read("airTemperature")
	const rainfall = read("precipitation").map((values) =>
		values.map((value) => Math.max(0, value) * monthDays),
	)
	const result = new Uint8Array(points)
	if (scheme === "koppen") {
		const temperatureMonthly = new Float32Array(12 * points)
		const rainfallMonthly = new Float32Array(12 * points)
		const surfaceTemperatureMonthly = new Float32Array(12 * points)
		const seaIcePercentMonthly = new Float32Array(12 * points)
		const surface = read("surfaceTemperature")
		const ice = read("seaIce")
		for (let month = 0; month < 12; month++) {
			temperatureMonthly.set(temperatures[month], month * points)
			rainfallMonthly.set(rainfall[month], month * points)
			surfaceTemperatureMonthly.set(surface[month], month * points)
			seaIcePercentMonthly.set(ice[month], month * points)
		}
		KOPPEN.koppenCells({
			start: 0,
			end: points,
			isLand,
			temperatureMonthly,
			surfaceTemperatureMonthly,
			seaIcePercentMonthly,
			rainfallMonthly,
			classes: result,
		})
		return result
	}
	const corrections = downscale
		? ordered.map(({ snapshot }, month) => {
				const smooth = GCM_DOWNSCALE.interpolate({
					downscale,
					values: GCM_FIELDS.values({ snapshot, mode: "airTemperature" }),
				})
				return temperatures[month].map((value, point) => value - smooth[point])
			})
		: null
	const readExtreme = (field: "airTemperatureMin" | "airTemperatureMax") =>
		ordered.map(({ snapshot }, month) => {
			const values = GCM_FIELDS.field({ snapshot, field }).map(
				(value) => value - 273.15,
			)
			return downscale
				? GCM_DOWNSCALE.interpolate({ downscale, values }).map(
						(value, point) => value + corrections[month][point],
					)
				: values
		})
	const minimum = readExtreme("airTemperatureMin")
	const maximum = readExtreme("airTemperatureMax")
	const surface = read("surfaceTemperature")
	const solar = read("surfaceShortwave")
	const albedo = read("albedo")
	const ice = read("seaIce")
	const snow = read("snowDepth")
	const pressure = read("surfacePressure")
	const humidity = read("relativeHumidity")
	const wind = read("wind")
	const forest = read("forestCover")
	const longwave = read("surfaceLongwave")
	const actual = read("evaporation")
	const nativeLand = GCM_FIELDS.field({
		snapshot: reference,
		field: "landFraction",
	})
	const sourceLand = downscale
		? GCM_DOWNSCALE.interpolate({ downscale, values: nativeLand })
		: nativeLand
	const atmosphere = GCM_ATMOSPHERE.resolve(config.atmosphere)
	if (atmosphere.ok === false) throw new Error(atmosphere.message)
	for (let point = 0; point < points; point++) {
		result[point] = PASTA.classify({
			monthDays,
			pressureHpa: pressure.map((values) => values[point]),
			hydrology:
				isLand[point] === 1
					? {
							potential: temperatures.map((values, month) =>
								PASTA_HYDROLOGY.potentialMonth({
									temperature: values[point],
									netRadiationWm2: solar[month][point] + longwave[month][point],
									humidityPercent: humidity[month][point],
									pressureKpa: pressure[month][point] / 10,
									windMs: wind[month][point],
									forestFraction: forest[month][point] / 100,
									gasConstant: atmosphere.values.gasConstant,
									monthDays,
								}),
							),
							actual:
								downscale && sourceLand[point] < 0.5
									? null
									: actual.map(
											(values) => Math.max(0, values[point]) * monthDays,
										),
						}
					: null,
			land: isLand[point] === 1,
			downscaled: downscale !== null,
			minimum: minimum.map((values) => values[point]),
			maximum: maximum.map((values) => values[point]),
			temperature: temperatures.map((values) => values[point]),
			rainfall: rainfall.map((values) => values[point]),
			light: solar.map(
				(values, month) =>
					Math.max(0, values[point]) /
					Math.max(0.01, 1 - albedo[month][point] / 100),
			),
			surfaceTemperature: surface.map((values) => values[point]),
			seaIce: ice.map((values) => values[point] / 100),
			snow: snow.map((values) => values[point]),
		})
	}
	return result
}

export const GCM_CLASSIFICATION = { classes, definition }
