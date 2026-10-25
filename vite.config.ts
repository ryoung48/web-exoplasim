import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig(({ command }) => {
	const base = process.env.VITE_BASE_PATH ?? "/"
	// The shared-memory ranks need SharedArrayBuffer, which needs a
	// cross-origin isolated page.
	const isolationHeaders = {
		"Cross-Origin-Opener-Policy": "same-origin",
		"Cross-Origin-Embedder-Policy": "credentialless",
	}

	return {
		base,
		worker: { format: "es" },
		server: {
			headers: isolationHeaders,
			watch: {
				ignored: [
					"**/.claude/**",
					"**/*.md",
					"**/scripts/**",
					"**/stats/**",
					"**/tsconfig.json",
				],
			},
		},
		preview: { headers: isolationHeaders },
		optimizeDeps: {
			entries: ["index.html"],
			include: ["react-router-dom", "three"],
		},
		plugins: [
			react(
				command === "build"
					? {
							babel: {
								plugins: [["babel-plugin-react-compiler"]],
							},
						}
					: {},
			),
			tailwindcss(),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
	}
})
