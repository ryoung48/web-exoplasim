// Flags `_`-prefixed params/vars that are actually unused, per AGENTS.md:
// "Never use `_`-prefixed names to hide intentionally unused variables or
// parameters. Remove the unused variable, parameter, and any dead call-site
// argument instead."
//
// Biome's noUnusedFunctionParameters/noUnusedVariables intentionally skip
// any `_`-prefixed identifier, so this rule can't be expressed in biome.json.
// This script re-checks those identifiers with the TS language service
// (which isn't fooled by the naming convention) and flags any that have
// zero real references.

import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const projectRoot = process.cwd()

// Optional folder/path filter, e.g. `node scripts/quality/check-underscore-unused.mjs src/model/celestial`
// Only filters what gets reported — the full program is still built so
// cross-file resolution stays accurate.
const filterArg = process.argv[2]
const filterPath = filterArg ? path.resolve(projectRoot, filterArg) : null

// Root tsconfig.json is solution-style (`files: []` + `references`), so it
// resolves no source files on its own. Pull files from each referenced
// project config instead.
const rootConfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json")
if (!rootConfigPath) {
	console.error("Could not find tsconfig.json")
	process.exit(1)
}
const rootConfigFile = ts.readConfigFile(rootConfigPath, ts.sys.readFile)
const referencedConfigPaths = (rootConfigFile.config.references ?? []).map((r) =>
	path.resolve(projectRoot, r.path),
)

let compilerOptions
const fileSet = new Set()
for (const refPath of referencedConfigPaths) {
	const configFile = ts.readConfigFile(refPath, ts.sys.readFile)
	const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(refPath))
	for (const f of parsed.fileNames) fileSet.add(f)
	compilerOptions ??= parsed.options
}

const files = [...fileSet].filter(
	(f) =>
		(f.endsWith(".ts") || f.endsWith(".tsx")) &&
		!f.includes("/dist/") &&
		!f.includes("/coverage/") &&
		!f.includes("/node_modules/"),
)

const versions = new Map()
for (const f of files) versions.set(f, 0)

const host = {
	getScriptFileNames: () => files,
	getScriptVersion: (f) => String(versions.get(f) ?? 0),
	getScriptSnapshot: (f) => {
		if (!fs.existsSync(f)) return undefined
		return ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8"))
	},
	getCurrentDirectory: () => projectRoot,
	getCompilationSettings: () => compilerOptions,
	getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
	fileExists: ts.sys.fileExists,
	readFile: ts.sys.readFile,
	readDirectory: ts.sys.readDirectory,
	directoryExists: ts.sys.directoryExists,
	getDirectories: ts.sys.getDirectories,
}

const service = ts.createLanguageService(host, ts.createDocumentRegistry())
const program = service.getProgram()
if (!program) {
	console.error("Failed to build program")
	process.exit(1)
}

/** @type {{file: string, line: number, name: string, kind: string}[]} */
const violations = []

function isUnderscoreName(name) {
	return name.startsWith("_") && name !== "_"
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {ts.Identifier} nameNode
 * @param {string} kind
 */
function checkIdentifier(sourceFile, nameNode, kind) {
	const name = nameNode.text
	if (!isUnderscoreName(name)) return

	const refs = service.findReferences(sourceFile.fileName, nameNode.getStart(sourceFile))
	if (!refs) return

	const totalRefs = refs.reduce((sum, r) => sum + r.references.length, 0)
	// Only the declaration itself references it => truly unused.
	if (totalRefs <= 1) {
		const { line } = sourceFile.getLineAndCharacterOfPosition(nameNode.getStart(sourceFile))
		violations.push({ file: sourceFile.fileName, line: line + 1, name, kind })
	}
}

for (const sourceFile of program.getSourceFiles()) {
	if (sourceFile.isDeclarationFile) continue
	if (!files.includes(sourceFile.fileName)) continue
	if (filterPath) {
		const resolved = path.resolve(sourceFile.fileName)
		if (resolved !== filterPath && !resolved.startsWith(filterPath + path.sep)) continue
	}

	ts.forEachChild(sourceFile, function visit(node) {
		if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
			checkIdentifier(sourceFile, node.name, "parameter")
		} else if (
			(ts.isVariableDeclaration(node) || ts.isBindingElement(node)) &&
			ts.isIdentifier(node.name)
		) {
			checkIdentifier(sourceFile, node.name, "variable")
		}
		ts.forEachChild(node, visit)
	})
}

if (violations.length === 0) {
	console.log("No unused `_`-prefixed identifiers found.")
	process.exit(0)
}

violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

for (const v of violations) {
	const rel = path.relative(projectRoot, v.file)
	console.log(`${rel}:${v.line} - unused ${v.kind} \`${v.name}\` hidden behind \`_\` prefix`)
}

console.log(`\n${violations.length} violation(s) found.`)
process.exit(1)
