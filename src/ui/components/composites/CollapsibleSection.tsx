import React, { useId, useState } from "react"
import { uiTokens } from "@/ui/components/tokens"

interface CollapsibleSectionProps {
	title: string
	defaultOpen: boolean
	modified: boolean
	onReset: () => void
	resetDisabled: boolean
	children: React.ReactNode
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
	title,
	defaultOpen,
	modified,
	onReset,
	resetDisabled,
	children,
}) => {
	const [open, setOpen] = useState(defaultOpen)
	const id = useId()
	return (
		<section>
			<div className={uiTokens.section.header}>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={id}
					className={uiTokens.section.toggle}
					onClick={() => setOpen(!open)}
				>
					<svg
						viewBox="0 0 10 10"
						aria-hidden="true"
						className={uiTokens.section.chevron}
						style={{ transform: open ? "rotate(90deg)" : undefined }}
					>
						<path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" />
					</svg>
					<span className="truncate">{title}</span>
					{modified && (
						<span
							className={uiTokens.section.marker}
							title="Changed from the Earth defaults"
							role="img"
							aria-label="modified"
						/>
					)}
				</button>
				<button
					type="button"
					className={uiTokens.section.action}
					disabled={!modified || resetDisabled}
					title={`Reset ${title.toLowerCase()} to the Earth defaults`}
					onClick={onReset}
				>
					Reset
				</button>
			</div>
			<div id={id} hidden={!open} className={uiTokens.section.body}>
				{children}
			</div>
		</section>
	)
}
