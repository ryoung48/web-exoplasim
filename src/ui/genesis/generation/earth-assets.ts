/** A server may already transparently decode a *.gz file via the standard
 * Content-Encoding response header (e.g. Vite's dev static middleware does
 * this) -- decompressing again here would double-decode garbage. Only run
 * DecompressionStream when the bytes are still actually gzipped. */
async function fetchMaybeGzippedBinary(
	url: string,
	compression: "gzip" | undefined,
	label: string,
): Promise<ArrayBuffer> {
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`Failed to load ${label}: ${res.status}`)
	}
	const alreadyDecoded = res.headers.get("content-encoding") === "gzip"
	return compression === "gzip" && !alreadyDecoded
		? await new Response(
				res.body?.pipeThrough(new DecompressionStream("gzip")),
			).arrayBuffer()
		: await res.arrayBuffer()
}

export async function loadEarthRealElevation(): Promise<{
	raster: Int16Array
	width: number
	height: number
	scale: number
	nodata: number
}> {
	const metaRes = await fetch("/earth-data/earth-real-elevation.json")
	if (!metaRes.ok) {
		throw new Error(
			`Failed to load observed elevation metadata: ${metaRes.status}`,
		)
	}
	const meta = (await metaRes.json()) as {
		bin: string
		width: number
		height: number
		scale: number
		nodata: number
		compression?: "gzip"
	}
	const buffer = await fetchMaybeGzippedBinary(
		`/earth-data/${meta.bin}`,
		meta.compression,
		"observed elevation raster",
	)
	return {
		raster: new Int16Array(buffer),
		width: meta.width,
		height: meta.height,
		scale: meta.scale,
		nodata: meta.nodata,
	}
}
