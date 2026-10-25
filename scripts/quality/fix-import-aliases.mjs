// Rewrites resolvable relative TypeScript imports and re-exports inside src
// to the project's @/* path alias.
//
// Usage:
//   pnpm fix:import-aliases
//   pnpm fix:import-aliases --check
import path from "node:path"
import { Project } from "ts-morph"

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..")
const SRC_ROOT = path.join(PROJECT_ROOT, "src")
const CHECK_ONLY = process.argv.includes("--check")

function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/")
}

const project = new Project({
	tsConfigFilePath: path.join(PROJECT_ROOT, "tsconfig.app.json"),
})

function toAliasSpecifier(filePath) {
	const relativePath = path
		.relative(SRC_ROOT, filePath)
		.replace(/\\/g, "/")
		.replace(/\.tsx?$/, "")
		.replace(/\/index$/, "")

	return `@/${relativePath}`
}

function rewriteDeclarations(sourceFile) {
	const declarations = [
		...sourceFile.getImportDeclarations(),
		...sourceFile.getExportDeclarations(),
	]
	let changed = 0

	for (const declaration of declarations) {
		const specifier = declaration.getModuleSpecifierValue()
		if (!specifier || !specifier.startsWith(".")) continue

		const target = declaration.getModuleSpecifierSourceFile()
		if (!target) continue

		const targetPath = target.getFilePath()
		if (!normalizePath(targetPath).startsWith(`${normalizePath(SRC_ROOT)}/`))
			continue

		const aliasSpecifier = toAliasSpecifier(targetPath)
		if (specifier === aliasSpecifier) continue

		changed++
		if (!CHECK_ONLY) declaration.setModuleSpecifier(aliasSpecifier)
		console.log(
			`${CHECK_ONLY ? "Would rewrite" : "Rewrote"} ${specifier} -> ${aliasSpecifier} (${path.relative(PROJECT_ROOT, sourceFile.getFilePath())})`,
		)
	}

	return changed
}

let changed = 0
for (const sourceFile of project.getSourceFiles()) {
	if (!normalizePath(sourceFile.getFilePath()).startsWith(`${normalizePath(SRC_ROOT)}/`))
		continue
	changed += rewriteDeclarations(sourceFile)
}

if (!CHECK_ONLY) await project.save()

console.log(
	`${CHECK_ONLY ? "Would rewrite" : "Rewrote"} ${changed} import alias(es).`,
)
