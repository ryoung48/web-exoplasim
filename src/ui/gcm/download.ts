import type { GcmDownload } from "@/ui/gcm/types"

function file({ name, bytes }: GcmDownload) {
	const url = URL.createObjectURL(new Blob([bytes]))
	const link = document.createElement("a")
	link.href = url
	link.download = name
	link.click()
	URL.revokeObjectURL(url)
}

async function png(canvas: HTMLCanvasElement) {
	const bytes = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob)
			else reject(new Error("Unable to export map. Please try again."))
		}, "image/png")
	})
	file({ name: "exoplasim-map.png", bytes })
}

export const GCM_DOWNLOAD = { file, png }
