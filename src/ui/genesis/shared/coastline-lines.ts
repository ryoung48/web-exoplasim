export interface CoastlineLineData {
	rings: number[][] // each ring: flat [lon0, lat0, lon1, lat1, ...] in degrees
}

let cachedLines: Promise<CoastlineLineData> | null = null

function fetchLineData(url: string): Promise<CoastlineLineData> {
	return fetch(url).then((res) => {
		if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
		return res.json() as Promise<CoastlineLineData>
	})
}

// Fetched once and reused across globe rebuilds — this is static vector
// data (Natural Earth land + lake polygons), independent of any generated
// world. Lake shorelines are included so the coastline overlay draws real
// lake outlines too, not just the continental coastline.
export function loadCoastlineLines(): Promise<CoastlineLineData> {
	if (!cachedLines) {
		cachedLines = Promise.all([
			fetchLineData(
				`${import.meta.env.BASE_URL}earth-data/coastline-lines.json`,
			),
			fetchLineData(`${import.meta.env.BASE_URL}earth-data/lake-lines.json`),
		]).then(([coastline, lakes]) => ({
			rings: [...coastline.rings, ...lakes.rings],
		}))
	}
	return cachedLines
}
