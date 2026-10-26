export const uiPalette = {
	terrain: {
		ocean: [30, 90, 150],
	},
	war: "#b91c1c",
	siege: "#7f1d1d",
	treasury: {
		critical: "#b91c1c",
		caution: "#f59e0b",
		healthy: "#22c55e",
	},
	giantStar: "#ef4444",
	moonHighland: "#c2c2c2",
	martianHighland: "#d7724d",
	brownDwarfL: "#a95632",
	brownDwarfT: "#895949",
	brownDwarfY: "#685b60",
	neutronStarGlow: "#8cecff",
	accent: "#4f46e5",
	sectorBoundary: "#cbd5e1",
	sectorCapital: "#38bdf8",
	nationCapital: "#fbbf24",
	rebel: "#000000",
	activeDark: "#0f172a",
	fieldMap: {
		coastline: "rgba(15, 23, 42, 0.6)",
		vector: "rgba(15, 23, 42, 0.62)",
		vectorShadow: "rgba(255, 255, 255, 0.55)",
	},
	person: {
		noHouse: "#94a3b8",
		deceased: "#000000",
		health: {
			Excellent: "#15803d",
			Good: "#22c55e",
			Fine: "#84cc16",
			Poor: "#f59e0b",
			"Near death": "#ea580c",
			Dying: "#b91c1c",
		},
		trait: {
			virtue: "#0d9488",
			vice: "#e11d48",
			neutral: "#7c3aed",
			gift: "#0284c7",
			defect: "#ea580c",
			lineage: "#ca8a04",
		},
		kinship: {
			cousin: "#fca5a5",
			"uncle-niece": "#ef4444",
			"half-sibling": "#b91c1c",
			sibling: "#7f1d1d",
		},
		condition: ["#eab308", "#f59e0b", "#f97316", "#ea580c", "#b91c1c"],
		opinion: {
			positive: "#0d9488",
			negative: "#e11d48",
			neutral: "#94a3b8",
		},
	},
	swatch: {
		stripeBackground: "rgba(15, 23, 42, 0.85)",
		stripedBorder: "rgba(255, 255, 255, 0.15)",
		plainBorder: "rgba(203, 213, 225, 0.8)",
	},
} as const

export const uiChartPalette = {
	moon: ["#0ea5e9", "#8b5cf6", "#10b981"] as const,
	solar: "#f59e0b",
	total: "#1e293b",
	timingTiers: ["#0f172a", "#1e293b", "#334155"] as const,
	successFill: "rgba(22, 163, 74, 0.1)",
	successStroke: "#16a34a",
	bench: {
		current: "#4f46e5",
		baseline: "#94a3b8",
		secondary: "#f59e0b",
		annexation: "#0d9488",
		development: ["#e0e7ff", "#a5b4fc", "#6366f1", "#4338ca", "#1e1b4b"],
		knowledge: [
			"#ecfdf5",
			"#d1fae5",
			"#a7f3d0",
			"#6ee7b7",
			"#10b981",
			"#047857",
			"#064e3b",
		],
		boxStroke: "#334155",
		boxFill: "rgba(79, 70, 229, 0.18)",
		war: { winner: "#b91c1c", loser: "#fca5a5" },
		rebellion: { winner: "#7c3aed", loser: "#c4b5fd" },
		categories: [
			"#4f46e5",
			"#0ea5e9",
			"#10b981",
			"#f59e0b",
			"#ef4444",
			"#8b5cf6",
			"#14b8a6",
			"#f97316",
			"#64748b",
		] as const,
		better: "text-emerald-600",
		worse: "text-rose-600",
		targetBand: "rgba(16, 185, 129, 0.14)",
		targetBandStroke: "#10b981",
	},
	axisText: "#64748b",
	axisTextStrong: "#475569",
	gridLine: "#e2e8f0",
	gridLineTranslucent: "rgba(148, 163, 184, 0.2)",
	referenceLine: "#94a3b8",
	tooltipBg: "#ffffff",
	tone: {
		neutral: "bg-slate-500",
		warm: "bg-amber-500",
		cool: "bg-sky-500",
	},
} as const

export const uiTokens = {
	uploadAction: {
		base: "inline-flex min-h-8 items-center justify-center gap-1 px-2! py-1! text-xs! font-semibold normal-case! tracking-normal! shadow-sm enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50!",
		primary:
			"border-indigo-600! bg-indigo-600! text-white! enabled:hover:border-indigo-700! enabled:hover:bg-indigo-700!",
		secondary:
			"border-slate-300! bg-slate-100! text-slate-800! enabled:hover:border-slate-400! enabled:hover:bg-slate-200!",
	},
	field: {
		numberLabel:
			"flex items-center justify-between gap-2 text-xs font-medium text-slate-600",
		numberInput:
			"w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50",
		labelWithHelp: "inline-flex items-center gap-1",
		helpTrigger:
			"inline-flex shrink-0 cursor-help items-center rounded-full text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-500",
		helpIcon: "h-3.5 w-3.5",
		fileRow: "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2",
		label: "text-xs font-semibold text-slate-900",
		disclosure:
			"cursor-pointer select-none text-xs font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-indigo-500",
		fileName: "truncate text-xs text-slate-500",
		actions: "grid grid-cols-2 gap-2",
	},
	wiki: {
		page: "space-y-2 overflow-x-hidden",
		stats: "mt-3 grid grid-cols-2 gap-x-3 gap-y-1",
		rows: "space-y-1",
		row: "flex items-baseline justify-between gap-2",
	},
	tooltip: {
		anchor: "inline-flex items-center",
		body: "fixed z-50 w-64 max-w-[calc(100vw-1rem)] border border-slate-200 bg-white px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal whitespace-pre-line text-slate-600 shadow-lg rounded-md",
		gap: 8,
		viewportInset: 8,
	},
	surface: {
		canvas: "bg-slate-100",
		panel: "bg-white/95",
		panelMuted: "bg-slate-50/90",
		panelAccent: "bg-white/90",
		overlay: "bg-slate-950/85 text-white",
		overlaySubtle: "bg-slate-950/75 text-white",
	},
	border: {
		default: "border-slate-200",
		muted: "border-slate-200/80",
		inverse: "border-white/10",
		inverseStrong: "border-white/20",
	},
	text: {
		primary: "text-slate-950",
		muted: "text-slate-500",
		subtle: "text-slate-400",
		inverse: "text-white",
		inverseMuted: "text-slate-400",
		inverseSubtle: "text-slate-500",
		sectorCapital: "text-sky-400",
		nationCapital: "text-amber-400",
	},
	radius: {
		sm: "rounded-md",
		md: "rounded-lg",
		lg: "rounded-xl",
		xl: "rounded-2xl",
		pill: "rounded-full",
	},
	shadow: {
		sm: "shadow-sm",
		md: "shadow-lg",
		lg: "shadow-2xl",
	},
	blur: {
		sm: "backdrop-blur-sm",
		md: "backdrop-blur-md",
	},
	type: {
		label: "font-mono text-[9px] uppercase tracking-[0.12em]",
		labelWide: "font-mono text-[9px] uppercase tracking-[0.16em]",
		labelSm: "text-[8px] font-semibold uppercase tracking-[0.08em]",
		control: "text-[10px] font-semibold uppercase tracking-[0.08em]",
		controlSm: "text-[9px] font-semibold uppercase tracking-[0.08em]",
		controlTextSm: "text-[9px] font-semibold tracking-[0.08em]",
		controlWide: "text-[10px] font-semibold uppercase tracking-[0.12em]",
		controlLoose: "text-[10px] font-semibold uppercase tracking-[0.14em]",
		value: "font-mono text-[11px]",
		valueSm: "font-mono text-[10px]",
		title: "text-sm font-semibold tracking-tight",
		hero: "text-[30px] leading-snug [font-family:var(--font-jedar)]",
	},
} as const

export type UiSurfaceTone = keyof typeof uiTokens.surface
export type UiBorderTone = keyof typeof uiTokens.border
export type UiRadius = keyof typeof uiTokens.radius
export type UiShadow = keyof typeof uiTokens.shadow
export type UiBlur = keyof typeof uiTokens.blur

export const uiCoastalWaves = {
	color: "#d5eef5",
	tiers: [
		{ width: 0.03, opacity: 0.05 },
		{ width: 0.02, opacity: 0.15 },
		{ width: 0.01, opacity: 0.3 },
	],
	renderOrder: 997,
	maskRenderOrder: 996,
	bandWidth: 0.003,
	waterStencilRef: 1,
	mapWidthScale: 2 / Math.PI,
} as const
