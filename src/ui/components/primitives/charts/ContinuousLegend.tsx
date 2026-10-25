import React from "react"

interface ContinuousLegendProps {
	min: number
	max: number
	colorForValue: (value: number) => string
	title?: string
	steps?: number
	formatValue?: (value: number) => string
	className?: string
}

function defaultFormatValue(value: number): string {
	return value.toFixed(1)
}

export const ContinuousLegend: React.FC<ContinuousLegendProps> = ({
	min,
	max,
	colorForValue,
	title,
	steps = 10,
	formatValue = defaultFormatValue,
	className,
}) => {
	const stepCount = Math.max(1, steps)
	const span = max - min
	const scale = Array.from({ length: stepCount + 1 }, (_, index) =>
		span === 0 ? min : min + (span * index) / stepCount,
	)

	return (
		<div
			className={`mt-2 flex flex-col gap-1.5 px-0.5 ${className ?? ""}`.trim()}
		>
			<div className="flex items-center justify-between text-[9px] font-mono text-gray-500 uppercase tracking-tighter">
				<span>{formatValue(min)}</span>
				<span>{title}</span>
				<span>{formatValue(max)}</span>
			</div>
			<div className="flex h-1.5 w-full overflow-hidden border border-slate-200">
				{scale.map((value, index) => (
					<div
						key={`${value}-${index}`}
						className="flex-1"
						style={{ backgroundColor: colorForValue(value) }}
					/>
				))}
			</div>
		</div>
	)
}
