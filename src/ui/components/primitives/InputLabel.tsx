import { useId } from "react"
import { HelpCircleIcon } from "@/ui/components/primitives/icons/HelpCircleIcon"
import { Tooltip } from "@/ui/components/primitives/Tooltip"
import type { InputLabelProps } from "@/ui/components/primitives/tooltip/types"
import { uiTokens } from "@/ui/components/tokens"

export function InputLabel({ label, help, name }: InputLabelProps) {
	const id = useId()
	return (
		<span className={uiTokens.field.labelWithHelp}>
			{label}
			<Tooltip id={id} content={help}>
				<span
					role="button"
					tabIndex={0}
					aria-label={`About ${name ?? (typeof label === "string" ? label : "this input")}`}
					aria-describedby={id}
					className={uiTokens.field.helpTrigger}
					onClick={(event) => event.currentTarget.focus()}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault()
							event.currentTarget.click()
						}
					}}
				>
					<HelpCircleIcon className={uiTokens.field.helpIcon} />
				</span>
			</Tooltip>
		</span>
	)
}
