if (import.meta.env.PROD && !window.crossOriginIsolated) {
	if (!("serviceWorker" in navigator)) {
		throw new Error(
			"This browser does not support the service worker needed to run ExoPlaSim.",
		)
	}
	await navigator.serviceWorker.register(
		`${import.meta.env.BASE_URL}isolation-worker.js`,
	)
	if (!navigator.serviceWorker.controller) {
		await new Promise<void>((resolve) => {
			navigator.serviceWorker.addEventListener(
				"controllerchange",
				() => resolve(),
				{
					once: true,
				},
			)
			if (navigator.serviceWorker.controller) resolve()
		})
		window.location.reload()
	} else {
		throw new Error(
			"Cross-origin isolation is unavailable. Reload the page or check your browser settings.",
		)
	}
} else {
	await import("@/main")
}
