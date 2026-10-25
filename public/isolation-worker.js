self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
	if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") return
	if (new URL(event.request.url).origin !== self.location.origin) return

	event.respondWith(
		fetch(event.request).then((response) => {
			if (response.status === 0) return response
			const headers = new Headers(response.headers)
			headers.set("Cross-Origin-Opener-Policy", "same-origin")
			headers.set("Cross-Origin-Embedder-Policy", "require-corp")
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			})
		}),
	)
})
