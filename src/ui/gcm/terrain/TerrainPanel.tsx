import { useCallback, useRef, useState } from "react"

import { cx } from "@/ui/components/lib"

import { Button } from "@/ui/components/primitives/Button"

import { FilePicker } from "@/ui/components/primitives/FilePicker"

import { LabeledNumberInput } from "@/ui/components/primitives/LabeledNumberInput"
import { LabeledSlider } from "@/ui/components/primitives/LabeledSlider"

import { ToggleRow } from "@/ui/components/primitives/ToggleRow"

import { uiTokens } from "@/ui/components/tokens"

import { GCM_INPUT_HELP } from "@/ui/gcm/input-help"

import { TerrainPreview } from "@/ui/gcm/terrain/TerrainPreview"

import type { GcmTerrainPanelProps } from "@/ui/gcm/terrain/types"

import { useTerrainImport } from "@/ui/gcm/terrain/useTerrainImport"

import { formatWithUnit, KM_TO_FT } from "@/ui/genesis/shared/ui-format"

export function TerrainPanel({
	hasTerrain,

	disabled,

	unitSystem,

	onChange,
}: GcmTerrainPanelProps) {
	const upload = useTerrainImport()

	const readTerrain = useCallback(() => upload.terrain, [upload.terrain])
	const dialog = useRef<HTMLDialogElement>(null)
	const [emptyElevation, setEmptyElevation] = useState(false)
	const elevationFactor = unitSystem === "imperial" ? KM_TO_FT / 1000 : 1

	return (
		<div className="min-w-0 space-y-2">
			<div className={uiTokens.field.actions}>
				<Button
					size="md"
					disabled={disabled}
					onClick={() => dialog.current?.showModal()}
				>
					Import terrain
				</Button>
				<Button
					size="md"
					disabled={disabled || !hasTerrain}
					onClick={() => onChange(null)}
				>
					Use Earth
				</Button>
			</div>
			<dialog
				ref={dialog}
				aria-labelledby="terrain-import-title"
				className={cx(
					"m-auto max-h-[90vh] w-[min(36rem,95vw)] overflow-y-auto p-4",
					uiTokens.surface.panel,
					uiTokens.radius.md,
					uiTokens.shadow.lg,
				)}
			>
				<div className="mb-3 flex items-center justify-between gap-2">
					<h2 id="terrain-import-title" className={uiTokens.type.title}>
						Import terrain
					</h2>
					<Button
						onClick={() => dialog.current?.close()}
						aria-label="Close terrain import"
					>
						Close
					</Button>
				</div>
				<fieldset disabled={disabled || upload.busy} className="space-y-2">
					<FilePicker
						label="Heightmap"
						help={GCM_INPUT_HELP.heightmap}
						action="Choose heightmap"
						accept=".png,.bin"
						emptyLabel="Required"
						fileName={upload.heightmap?.name ?? null}
						disabled={disabled || upload.busy}
						onSelect={(file) => void upload.read({ file, kind: "heightmap" })}
					/>
					<FilePicker
						label="Land mask"
						help={GCM_INPUT_HELP.landMask}
						action="Choose land mask"
						accept=".png"
						emptyLabel="Optional"
						fileName={upload.mask?.name ?? null}
						disabled={disabled || upload.busy}
						onSelect={(file) => void upload.read({ file, kind: "mask" })}
					/>
					{(upload.heightmap || upload.mask) && (
						<div className="space-y-2 pt-2">
							{upload.mask && (
								<div className="flex items-center gap-2">
									<ToggleRow
										className="flex-1"
										label="Invert mask"
										help={GCM_INPUT_HELP.invertMask}
										checked={upload.mapping.invertMask}
										onChange={(invertMask) =>
											upload.setMapping({ ...upload.mapping, invertMask })
										}
									/>
									<Button
										className={cx(
											uiTokens.uploadAction.base,

											uiTokens.uploadAction.secondary,
										)}
										onClick={upload.removeMask}
										aria-label="Remove mask"
									>
										Remove
									</Button>
								</div>
							)}
							{upload.heightmap && (
								<div className="grid grid-cols-2 items-start gap-3">
									<LabeledNumberInput
										label="Maximum elevation"
										help={GCM_INPUT_HELP.maxElevation}
										unit={unitSystem === "imperial" ? "ft" : "m"}
										value={
											emptyElevation
												? null
												: Number(
														(
															upload.mapping.maxElevationM * elevationFactor
														).toFixed(2),
													)
										}
										placeholder="Enter elevation"
										min={0}
										disabled={disabled || upload.busy}
										onChange={(value) => {
											setEmptyElevation(value === null)
											if (value !== null)
												upload.setMapping({
													...upload.mapping,
													maxElevationM: value / elevationFactor,
												})
										}}
									/>
									<LabeledSlider
										label="Sea level"
										rangeClassName={uiTokens.field.grayscaleRange}
										help={GCM_INPUT_HELP.seaLevel}
										value={`${upload.mapping.seaLevel} / 255`}
										min={0}
										max={255}
										step={1}
										numericValue={upload.mapping.seaLevel}
										onChange={(seaLevel) =>
											upload.setMapping({ ...upload.mapping, seaLevel })
										}
									/>
								</div>
							)}
						</div>
					)}
				</fieldset>
				{upload.busy && (
					<p role="status" className={uiTokens.field.note}>
						Reading terrain…
					</p>
				)}
				{upload.error && (
					<p role="alert" className={uiTokens.field.note}>
						{upload.error}
					</p>
				)}
				{upload.terrain && !upload.error && (
					<div className="space-y-2 pt-2">
						<TerrainPreview
							readTerrain={readTerrain}
							label={`Land mask · ${formatWithUnit(upload.summary.landPercent, "%", 1)} land`}
						/>
					</div>
				)}

				<div className={cx(uiTokens.field.actions, "mt-3")}>
					<Button
						size="md"
						className={cx(
							uiTokens.uploadAction.base,

							uiTokens.uploadAction.primary,
						)}
						disabled={
							disabled ||
							emptyElevation ||
							upload.busy ||
							upload.updating ||
							!upload.terrain ||
							!!upload.error
						}
						onClick={() => {
							onChange(upload.terrain)
							dialog.current?.close()
						}}
					>
						Apply terrain
					</Button>
				</div>
			</dialog>
		</div>
	)
}
