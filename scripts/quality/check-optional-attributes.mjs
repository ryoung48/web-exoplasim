// Checks optional object/interface/class attributes for an explicit reason.
// Every optional property must have a nearby comment containing
// `[JUSTIFICATION]`, as required by AGENTS.md.
//
// Usage:
//   pnpm check:optional-attributes
//   pnpm check:optional-attributes src/model/terrain
//   pnpm check:optional-attributes --dir=src/model/terrain
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..")
const scriptArguments = process.argv.slice(2)
const dirArg = scriptArguments.find((argument) => argument.startsWith("--dir="))
const positionalDir = scriptArguments.find((argument) => !argument.startsWith("--"))
const scanRoot = path.resolve(
	PROJECT_ROOT,
	dirArg?.slice("--dir=".length) ?? positionalDir ?? "src",
)
const scanPrefix = `${scanRoot.replace(/\\/g, "/")}/`

const project = new Project({
	tsConfigFilePath: path.join(PROJECT_ROOT, "tsconfig.app.json"),
})

function isSourceFile(filePath) {
	return (
		filePath.replace(/\\/g, "/").startsWith(scanPrefix) &&
		!filePath.endsWith(".d.ts")
	)
}

function hasJustificationComment(node) {
	const comments = [
		...node.getLeadingCommentRanges(),
		...node.getTrailingCommentRanges(),
	]
	return comments.some((comment) => comment.getText().includes("[JUSTIFICATION]"))
}

const violations = []

for (const sourceFile of project.getSourceFiles()) {
	if (!isSourceFile(sourceFile.getFilePath())) continue

	const properties = [
		...sourceFile.getDescendantsOfKind(SyntaxKind.PropertySignature),
		...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration),
	]

	for (const property of properties) {
		if (!property.hasQuestionToken() || hasJustificationComment(property)) continue

		violations.push({
			file: path.relative(PROJECT_ROOT, sourceFile.getFilePath()),
			line: sourceFile.getLineAndColumnAtPos(property.getStart()).line,
			name: property.getName(),
		})
	}
}

violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

console.log(`Optional attributes without [JUSTIFICATION]: ${violations.length}`)
for (const violation of violations) {
	console.log(`${violation.file}:${violation.line} - ${violation.name}`)
}

process.exit(violations.length === 0 ? 0 : 1)
