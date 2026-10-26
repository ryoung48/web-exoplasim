import { useId, useRef } from "react"
import { cx } from "@/ui/components/lib"
import { Button } from "@/ui/components/primitives/Button"
import { InputLabel } from "@/ui/components/primitives/InputLabel"
import { uiTokens } from "@/ui/components/tokens"

interface FilePickerProps {
	// [JUSTIFICATION] File pickers outside model settings do not require help text.
	help?: string
	label: string
	action: string
	accept: string
	emptyLabel: string
	fileName: string | null
	disabled: boolean
	onSelect: (file: File) => void
}

export function FilePicker({
	label,
	help,
	action,
	accept,
	emptyLabel,
	fileName,
	disabled,
	onSelect,
}: FilePickerProps) {
	const input = useRef<HTMLInputElement>(null)
	const id = useId()
	return (
		<div className={uiTokens.field.fileRow}>
			<span
				className={`${uiTokens.field.label} ${uiTokens.field.labelWithHelp}`}
			>
				<label htmlFor={id}>{label}</label>
				{help && <InputLabel label="" name={label} help={help} />}
			</span>
			<span
				id={`${id}-file`}
				className={uiTokens.field.fileName}
				title={fileName ?? emptyLabel}
				aria-live="polite"
			>
				{fileName ?? emptyLabel}
			</span>
			<Button
				size="md"
				aria-label={action}
				className={cx(
					uiTokens.uploadAction.base,
					uiTokens.uploadAction.secondary,
				)}
				disabled={disabled}
				onClick={() => input.current?.click()}
			>
				Browse…
			</Button>
			<input
				ref={input}
				id={id}
				type="file"
				accept={accept}
				disabled={disabled}
				aria-describedby={`${id}-file`}
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0]
					event.target.value = ""
					if (file) onSelect(file)
				}}
			/>
		</div>
	)
}
