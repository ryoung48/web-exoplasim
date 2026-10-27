// The model's assets in public/gcm, for both engines' runners.
function url(path: string): URL {
	return new URL(`${import.meta.env.BASE_URL}gcm/${path}`, self.location.origin)
}

// A JSON asset, or null when it is not built.
async function json<T>(path: string): Promise<T | null> {
	const response = await fetch(url(path))
	if (!response.ok) return null
	return (await response.json()) as T
}

export const GCM_ASSETS = {
	url,
	json,
}
