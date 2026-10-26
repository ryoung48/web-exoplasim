import { cx } from "@/ui/components/lib"
import { Button } from "@/ui/components/primitives/Button"
import { FilePicker } from "@/ui/components/primitives/FilePicker"
import { LabeledSlider } from "@/ui/components/primitives/LabeledSlider"
import { LabeledValueRow } from "@/ui/components/primitives/LabeledValueRow"
import { ToggleRow } from "@/ui/components/primitives/ToggleRow"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_INPUT_HELP } from "@/ui/gcm/input-help"
import { TerrainPreview } from "@/ui/gcm/terrain/TerrainPreview"
import type { GcmTerrainPanelProps } from "@/ui/gcm/terrain/types"
import { useTerrainImport } from "@/ui/gcm/terrain/useTerrainImport"
import { formatElevation, formatWithUnit } from "@/ui/genesis/shared/ui-format"

export function TerrainPanel({
	terrain,
	latitudes,
	disabled,
	unitSystem,
	onChange,
}: GcmTerrainPanelProps) {
	const upload = useTerrainImport(latitudes)
	return (
		<div className="min-w-0 space-y-2">
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
					<details>
						<summary className={uiTokens.field.disclosure}>Options</summary>
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
										labelClassName={uiTokens.text.primary}
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
							{upload.heightmap?.encoding === "normalized" && (
								<>
									<LabeledSlider
										label="Black elevation"
										help={GCM_INPUT_HELP.blackElevation}
										value={formatElevation(
											upload.mapping.blackM / 1000,
											unitSystem,
										)}
										min={-12000}
										max={20000}
										step={1}
										numericValue={upload.mapping.blackM}
										onChange={(blackM) =>
											upload.setMapping({ ...upload.mapping, blackM })
										}
									/>
									<LabeledSlider
										label="White elevation"
										help={GCM_INPUT_HELP.whiteElevation}
										value={formatElevation(
											upload.mapping.whiteM / 1000,
											unitSystem,
										)}
										min={-12000}
										max={20000}
										step={1}
										numericValue={upload.mapping.whiteM}
										onChange={(whiteM) =>
											upload.setMapping({ ...upload.mapping, whiteM })
										}
									/>
								</>
							)}
							{upload.heightmap && (
								<LabeledSlider
									label="Sea level"
									help={GCM_INPUT_HELP.seaLevel}
									value={formatElevation(
										upload.mapping.seaLevelM / 1000,
										unitSystem,
									)}
									min={-12000}
									max={20000}
									step={1}
									numericValue={upload.mapping.seaLevelM}
									onChange={(seaLevelM) =>
										upload.setMapping({ ...upload.mapping, seaLevelM })
									}
								/>
							)}
						</div>
					</details>
				)}
			</fieldset>
			{upload.busy && (
				<p role="status" className={uiTokens.type.valueSm}>
					Reading terrain…
				</p>
			)}
			{upload.error && (
				<p role="alert" className={uiTokens.type.valueSm}>
					{upload.error}
				</p>
			)}
			{upload.terrain && !upload.error && (
				<details>
					<summary className={uiTokens.field.disclosure}>
						Preview · {formatWithUnit(upload.summary.landPercent, "%", 1)} land
					</summary>
					<div className="grid grid-cols-2 gap-2 pt-2">
						<TerrainPreview
							terrain={upload.terrain}
							boundary={null}
							label="Terrain"
						/>
						<TerrainPreview
							terrain={upload.terrain}
							boundary={upload.boundary}
							label={`Model · ${latitudes * 2} × ${latitudes}`}
						/>
					</div>
					<LabeledValueRow
						label="Elevation"
						value={`${formatElevation(upload.summary.minM / 1000, unitSystem)} to ${formatElevation(upload.summary.maxM / 1000, unitSystem)}`}
					/>
				</details>
			)}

			<div className={uiTokens.field.actions}>
				<Button
					size="md"
					className={cx(
						uiTokens.uploadAction.base,
						uiTokens.uploadAction.primary,
					)}
					disabled={
						disabled || upload.busy || !upload.terrain || !!upload.error
					}
					onClick={() => onChange(upload.terrain)}
				>
					Apply terrain
				</Button>
				<Button
					size="md"
					className={cx(
						uiTokens.uploadAction.base,
						uiTokens.uploadAction.secondary,
					)}
					disabled={disabled || !terrain}
					onClick={() => onChange(null)}
				>
					Use Earth
				</Button>
			</div>
			{disabled && (
				<p className={cx(uiTokens.type.valueSm, uiTokens.text.muted)}>
					Clear run to edit terrain.
				</p>
			)}
		</div>
	)
}
