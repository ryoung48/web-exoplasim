import { useCallback, useMemo, useRef, useState } from "react"
import { GCM_CLASSIFICATION } from "@/model/climate/gcm/classification"
import { GCM_DOWNSCALE } from "@/model/climate/gcm/downscale"
import { GCM_FIELDS } from "@/model/climate/gcm/fields"
import type { GcmLevel, GcmMapMode } from "@/model/climate/gcm/fields/types"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { GCM_TERRAIN } from "@/model/climate/gcm/terrain"
import { PanelHeader } from "@/ui/components/composites/PanelHeader"
import { cx } from "@/ui/components/lib"
import { Button } from "@/ui/components/primitives/Button"
import { ContinuousLegend } from "@/ui/components/primitives/charts/ContinuousLegend"
import { IconButton } from "@/ui/components/primitives/IconButton"
import { DetailsIcon } from "@/ui/components/primitives/icons/DetailsIcon"
import { LabeledValueRow } from "@/ui/components/primitives/LabeledValueRow"
import { SegmentedControl } from "@/ui/components/primitives/SegmentedControl"
import { Tooltip } from "@/ui/components/primitives/Tooltip"
import { uiTokens } from "@/ui/components/tokens"
import { GCM_BALANCE_VIEW } from "@/ui/gcm/balance-view"
import { GCM_DISPLAY } from "@/ui/gcm/field-display"
import { GcmClimateLegend } from "@/ui/gcm/GcmClimateLegend"
import { GcmConfigPanel } from "@/ui/gcm/GcmConfigPanel"
import { GcmHoverReadout } from "@/ui/gcm/GcmHoverReadout"
import { GcmMap } from "@/ui/gcm/GcmMap"
import type { GcmHoverPoint } from "@/ui/gcm/hover/types"
import { GCM_LIVE } from "@/ui/gcm/live-store"
import { GCM_MODE_GROUPS } from "@/ui/gcm/map-mode-options"
import { GCM_PERIOD_VIEW } from "@/ui/gcm/period-view"
import { GCM_TARGETING_VIEW } from "@/ui/gcm/targeting-view"
import type {
	GcmMapDetail,
	GcmMapLayer,
	GcmPeriod,
	GcmViewMode,
} from "@/ui/gcm/types"
import { useGcmRun } from "@/ui/gcm/useGcmRun"
import { rgbToCss, type UnitSystem } from "@/ui/genesis/shared/ui-format"

const UNIT_OPTIONS = [
	{ value: "metric", label: "Metric" },
	{ value: "imperial", label: "Imperial" },
] as const
const SUMMARY_MODES: ReadonlyArray<GcmMapMode> = [
	"airTemperature",
	"precipitation",
	"cloudCover",
	"seaIce",
	"outgoingLongwave",
]

const DETAIL_OPTIONS = [
	{ value: "model", label: "Model grid" },
	{ value: "downscaled", label: "Downscaled" },
] as const
const LAPSE_CORRECTED_MODES: ReadonlyArray<GcmMapMode> = [
	"surfaceTemperature",
	"airTemperature",
]
const PERIOD_OPTIONS = [
	{ value: "now", label: "Now" },
	{ value: "month", label: "Monthly" },
	{ value: "year", label: "Annual" },
] as const

export function GcmView() {
	const gcm = useGcmRun()
	const [requestedView, setView] = useState<GcmViewMode>("airTemperature")
	const supportedView: GcmViewMode =
		gcm.engine === "gpu" &&
		requestedView !== "elevation" &&
		requestedView !== "koppen" &&
		requestedView !== "pasta" &&
		!GCM_FIELDS.gpuSupports(requestedView)
			? "surfaceTemperature"
			: requestedView
	const requestedLayer = GCM_FIELDS.layer(supportedView)
	const view =
		requestedLayer && requestedLayer.level > gcm.config.layers
			? GCM_FIELDS.layerMode({ ...requestedLayer, level: gcm.config.layers })
			: supportedView
	const levelOptions = GCM_FIELDS.levels(gcm.config.layers).map((level) => ({
		value: String(level),
		label:
			level === 1
				? "1 · top"
				: level === gcm.config.layers
					? `${level} · bottom`
					: String(level),
	}))
	const [period, setPeriod] = useState<GcmPeriod>("now")
	const [monthIndex, setMonthIndex] = useState<number | null>(null)
	const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric")
	const [detail, setDetail] = useState<GcmMapDetail>("model")
	const [hover, setHover] = useState<GcmHoverPoint | null>(null)
	const [sidebarOpen, setSidebarOpen] = useState(true)
	const atmosphere = GCM_FIELDS.layer(view)
	const groupView = atmosphere
		? GCM_FIELDS.layerMode({ ...atmosphere, level: 10 })
		: view
	const modeGroup = GCM_MODE_GROUPS.find(
		(group) =>
			group.defaultView === groupView ||
			group.children.some((child) => child.value === groupView),
	)
	const terrainView = view === "elevation"
	const climateView = view === "koppen" || view === "pasta"
	const scheme = view === "pasta" ? "pasta" : "koppen"
	const climateDefinition = GCM_CLASSIFICATION.definition(scheme)
	const mode: GcmMapMode =
		climateView || terrainView ? "surfaceTemperature" : view
	const definition = GCM_FIELDS.definition(mode)
	const terrainSummary = useMemo(
		() => (gcm.displayTerrain ? GCM_TERRAIN.summary(gcm.displayTerrain) : null),
		[gcm.displayTerrain],
	)
	const { status } = gcm.state
	const active =
		status === "loading" ||
		status === "running" ||
		status === "paused" ||
		status === "checkpointing"
	const checkpointFile = useRef<HTMLInputElement>(null)
	const { averages, snapshot: latest } = GCM_LIVE.useLive(gcm.live)
	const climate = averages[scheme]
	const selection = GCM_PERIOD_VIEW.select({
		period: climateView ? "year" : period,
		monthIndex,
		snapshot: latest,
		averages,
	})
	const { snapshot } = selection
	const { downscale } = gcm
	const downscaled = detail === "downscaled" && downscale
	const downscaledClimate = useMemo(
		() =>
			downscaled && climateView
				? GCM_CLASSIFICATION.classes({
						config: gcm.config,
						scheme,
						downscale: downscaled,
						months: averages.months,
					})
				: null,
		[downscaled, climateView, scheme, averages.months, gcm.config],
	)
	const layer = useMemo<GcmMapLayer | null>(() => {
		if (terrainView)
			return gcm.displayTerrain
				? {
						kind: "terrain",
						terrain: gcm.displayTerrain,
						maxElevationM: terrainSummary?.maxM ?? 1,
					}
				: null
		if (!snapshot) return null
		if (climateView) {
			if (downscaled && downscaledClimate) {
				return {
					kind: "downscaled-classes",
					scheme,
					width: downscaled.width,
					height: downscaled.height,
					classes: downscaledClimate,
				}
			}
			return climate
				? { kind: "classes", snapshot, classes: climate, scheme }
				: null
		}
		if (!downscaled) return { kind: "field", snapshot, mode }
		const values = GCM_FIELDS.values({ snapshot, mode })
		return {
			kind: "downscaled-field",
			snapshot,
			mode,
			width: downscaled.width,
			height: downscaled.height,
			values: LAPSE_CORRECTED_MODES.includes(mode)
				? GCM_DOWNSCALE.temperature({ downscale: downscaled, values })
				: GCM_DOWNSCALE.interpolate({ downscale: downscaled, values }),
		}
	}, [
		snapshot,
		climateView,
		scheme,
		mode,
		terrainView,
		gcm.displayTerrain,
		climate,
		downscaled,
		downscaledClimate,
		terrainSummary?.maxM,
	])
	// React's development profiler traverses arrays in changed props on both
	// entry and exit. Keep raster data behind a reader at component boundaries.
	const readLayer = useCallback(() => layer, [layer])
	const readClasses = useCallback(
		() => downscaledClimate ?? climate,
		[downscaledClimate, climate],
	)
	const balance = useMemo(
		() => GCM_BALANCE_VIEW.rows({ averages, targeting: gcm.targeting }),
		[averages, gcm.targeting],
	)
	const means = useMemo(
		() =>
			snapshot
				? SUMMARY_MODES.map((summary) => ({
						mode: summary,
						value: GCM_GRID.globalMean(
							GCM_FIELDS.values({ snapshot, mode: summary }),
						),
					}))
				: [],
		[snapshot],
	)

	return (
		<div
			className={cx(
				"flex h-full w-full overflow-hidden",
				uiTokens.surface.canvas,
			)}
		>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4">
				<header className="flex flex-wrap items-start justify-between gap-2">
					<div>
						<h1 className={cx(uiTokens.type.title, uiTokens.text.primary)}>
							ExoPlaSim · Web
						</h1>
						<p className={cx(uiTokens.type.label, uiTokens.text.muted)}>
							{gcm.state.truncation > 0 ? `T${gcm.state.truncation} ` : ""}
							general circulation model running in your browser
						</p>
					</div>
					<div className="relative text-right">
						<div className={cx(uiTokens.type.value, uiTokens.text.primary)}>
							{climateView && climate
								? `${climateDefinition.label} from the ${selection.label}`
								: terrainView
									? "Terrain elevation"
									: selection.label}
						</div>
						<GcmHoverReadout
							point={hover}
							readLayer={readLayer}
							unitSystem={unitSystem}
						/>
					</div>
				</header>
				<div className="flex flex-wrap gap-1">
					{GCM_MODE_GROUPS.map((group) => (
						<Button
							key={group.defaultView}
							selected={group === modeGroup}
							disabled={group.defaultView === "koppen" && !averages.koppen}
							title={
								group.defaultView === "koppen"
									? averages.koppen
										? "Climate classes from the last 12 model months"
										: "Available after 12 model months"
									: group.label
							}
							onClick={() => setView(group.defaultView)}
						>
							{group.label}
						</Button>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{!terrainView && (
						<SegmentedControl
							options={PERIOD_OPTIONS}
							value={climateView ? "year" : period}
							onChange={(next) => {
								setPeriod(next)
								if (climateView) setView("airTemperature")
							}}
						/>
					)}
					{!terrainView && (
						<SegmentedControl
							options={DETAIL_OPTIONS}
							value={detail}
							onChange={setDetail}
						/>
					)}
					{modeGroup && modeGroup.children.length > 0 && (
						<div className={cx("flex border-l pl-2", uiTokens.border.default)}>
							<SegmentedControl
								options={modeGroup.children.filter(
									(child) =>
										gcm.engine === "cpu" ||
										child.value === "elevation" ||
										child.value === "koppen" ||
										child.value === "pasta" ||
										GCM_FIELDS.gpuSupports(child.value),
								)}
								value={groupView}
								onChange={setView}
							/>
						</div>
					)}
					{atmosphere && (
						<div className="flex items-center gap-2">
							<span className={uiTokens.type.label}>Model layer</span>
							<SegmentedControl
								options={levelOptions}
								value={String(atmosphere.level)}
								onChange={(value) =>
									setView(
										GCM_FIELDS.layerMode({
											variable: atmosphere.variable,
											level: Number(value) as GcmLevel,
										}),
									)
								}
							/>
						</div>
					)}
					{!terrainView && period === "month" && !climateView && (
						<div className="flex flex-wrap gap-1">
							{averages.months.map((month, index) => (
								<Button
									key={`${month.year}-${month.month}`}
									size="sm"
									selected={
										index === (monthIndex ?? averages.months.length - 1)
									}
									onClick={() =>
										setMonthIndex(
											index === averages.months.length - 1 ? null : index,
										)
									}
								>
									{GCM_PERIOD_VIEW.monthName(month.month)}
								</Button>
							))}
						</div>
					)}
				</div>
				<div className="relative min-h-0 flex-1">
					<GcmMap
						loading={status === "loading" || (status === "running" && !latest)}
						onHover={setHover}
						readLayer={readLayer}
						coastlines={gcm.coastlines}
						emptyMessage={
							terrainView
								? "Import terrain in the settings panel to view it"
								: active && period === "now"
									? gcm.state.message
									: selection.emptyMessage
						}
					/>
					{!sidebarOpen && (
						<div className="absolute top-3 right-3 z-20">
							<Tooltip
								content="Show settings panel"
								position="bottom"
								align="end"
							>
								<IconButton
									tone="overlay"
									size="sm"
									aria-label="Show settings panel"
									aria-expanded={false}
									aria-controls="gcm-sidebar"
									onClick={() => setSidebarOpen(true)}
								>
									<DetailsIcon className="h-4 w-4 text-white" />
								</IconButton>
							</Tooltip>
						</div>
					)}
				</div>
				{terrainView ? (
					gcm.displayTerrain && terrainSummary ? (
						<ContinuousLegend
							min={0}
							max={terrainSummary.maxM}
							title="Elevation"
							steps={24}
							colorForValue={(value) =>
								rgbToCss(
									GCM_DISPLAY.terrainColor({
										value,
										min: 0,
										max: terrainSummary.maxM,
										land: 1,
									}),
								)
							}
							formatValue={(value) => `${Math.round(value).toLocaleString()} m`}
						/>
					) : null
				) : climateView && climate ? (
					<GcmClimateLegend readClasses={readClasses} scheme={scheme} />
				) : (
					<ContinuousLegend
						min={definition.min}
						max={definition.max}
						title={definition.label}
						steps={24}
						colorForValue={(value) =>
							rgbToCss(GCM_DISPLAY.color({ mode, value }))
						}
						formatValue={(value) =>
							GCM_DISPLAY.format({ mode, value, unitSystem })
						}
					/>
				)}
			</main>
			<aside
				id="gcm-sidebar"
				hidden={!sidebarOpen}
				className={cx(
					sidebarOpen
						? "flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l p-4"
						: "hidden",
					uiTokens.border.default,
					uiTokens.surface.panel,
				)}
			>
				<section>
					<PanelHeader
						title="Run"
						action={
							<IconButton
								tone="borderless"
								size="xs"
								title="Hide settings panel"
								aria-label="Hide settings panel"
								aria-expanded={true}
								aria-controls="gcm-sidebar"
								onClick={() => setSidebarOpen(false)}
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<line x1="18" y1="6" x2="6" y2="18" />
									<line x1="6" y1="6" x2="18" y2="18" />
								</svg>
							</IconButton>
						}
					/>
					<div className="flex flex-wrap gap-2">
						{active ? (
							status === "paused" ? (
								<Button onClick={gcm.resume}>Resume</Button>
							) : (
								<Button onClick={gcm.pause} disabled={status !== "running"}>
									Pause
								</Button>
							)
						) : (
							<Button selected onClick={() => void gcm.start()}>
								Start
							</Button>
						)}
						<Button
							onClick={gcm.save}
							disabled={status !== "running" && status !== "paused"}
							title="Save the model state and climate averages to a file, preserving the current pause state"
						>
							Save
						</Button>
						<Button onClick={() => checkpointFile.current?.click()}>
							Load
						</Button>
						<Button
							onClick={() => {
								gcm.clear()
								setPeriod("now")
								setMonthIndex(null)
								setView("airTemperature")
								setHover(null)
							}}
							disabled={status === "idle" && !latest}
							title="Stops the run and clears results so settings can be changed"
						>
							Clear
						</Button>
						<input
							ref={checkpointFile}
							type="file"
							accept=".ckpt"
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0]
								event.target.value = ""
								if (file) void gcm.load(file)
							}}
						/>
					</div>
					<div className="mt-3 space-y-1">
						<LabeledValueRow
							label="Status"
							value={gcm.state.message.split("\n")[0]}
						/>
						{gcm.state.device && (
							<LabeledValueRow
								label={gcm.engine === "gpu" ? "GPU" : "Workers"}
								value={gcm.state.device}
							/>
						)}
						{gcm.state.stepsPerSecond > 0 && (
							<LabeledValueRow
								label="Speed"
								value={`${((gcm.state.stepsPerSecond * gcm.config.timestepMinutes) / 1440).toFixed(2)} model days/s`}
							/>
						)}
						{latest &&
							balance.map((row) => (
								<LabeledValueRow
									key={row.label}
									label={row.label}
									value={row.value}
								/>
							))}
					</div>
					{gcm.targeting && (
						<div
							className="mt-3 space-y-1"
							aria-label="Temperature targeting progress"
							aria-live="polite"
						>
							{GCM_TARGETING_VIEW.rows({
								state: gcm.targeting,
								targetK: gcm.config.targetTemperatureK,
								unitSystem,
							}).map((row) => (
								<LabeledValueRow
									key={row.label}
									label={row.label}
									value={row.value}
								/>
							))}
							<p className={uiTokens.field.note}>{gcm.targeting.message}</p>
						</div>
					)}
					{status === "failed" && (
						<pre
							className={cx(
								"mt-2 max-h-40 overflow-auto whitespace-pre-wrap",
								uiTokens.type.valueSm,
								uiTokens.text.muted,
							)}
						>
							{gcm.state.message}
						</pre>
					)}
				</section>
				<section>
					<PanelHeader
						title={
							period === "now" || climateView
								? "Global means"
								: `Global means · ${period === "month" ? "monthly" : "annual"}`
						}
						action={
							<SegmentedControl
								size="xs"
								options={UNIT_OPTIONS}
								value={unitSystem}
								onChange={setUnitSystem}
							/>
						}
					/>
					<div className="space-y-1">
						{means.length === 0 && (
							<p className={uiTokens.field.note}>
								Appears once the model is running
							</p>
						)}
						{means.map((entry) => (
							<LabeledValueRow
								key={entry.mode}
								label={GCM_FIELDS.definition(entry.mode).label}
								value={GCM_DISPLAY.format({
									mode: entry.mode,
									value: entry.value,
									unitSystem,
								})}
							/>
						))}
					</div>
				</section>
				<section>
					<PanelHeader title="Settings" />
					{active && (
						<p className={cx("-mt-2 mb-3", uiTokens.field.note)}>
							Pause to edit climate settings, then resume to apply them. Model
							and structural settings stay locked until you clear the run.
						</p>
					)}
					<GcmConfigPanel
						config={gcm.config}
						terrain={gcm.terrain}
						latitudes={
							gcm.resolutions.find(
								(entry) =>
									entry.truncation === gcm.config.truncation &&
									entry.layers === gcm.config.layers,
							)?.latitudes ?? 32
						}
						unitSystem={unitSystem}
						resolutions={gcm.resolutions}
						engine={gcm.engine}
						gpuAvailable={gcm.gpuAvailable}
						onEngineChange={gcm.setEngine}
						workerChoice={gcm.workerChoice}
						workerOptions={gcm.workerOptions}
						onWorkerChange={gcm.setWorkerChoice}
						locked={gcm.locked}
						disabled={gcm.locked && status !== "paused"}
						onChange={gcm.setConfig}
						onTerrainChange={gcm.setTerrain}
					/>
				</section>
			</aside>
		</div>
	)
}
