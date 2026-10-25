// Move one or more files/folders with ts-morph, rewriting every importer
// (relative and "@/..." alias) across the project automatically.
//
// Usage:
//   node scripts/refactor/move-module.mjs <from> <to> [<from> <to> ...]
//
// <from>/<to> are repo-relative paths. If <from> is a directory, its full
// contents are moved to <to> (directory-to-directory), preserving structure.
//
// Examples:
//   node scripts/refactor/move-module.mjs src/model/climate/locked src/model/climate/tidal-locked
//   node scripts/refactor/move-module.mjs \
//     src/model/tectonics src/model/geography/tectonics \
//     src/model/terrain src/model/geography/terrain

import { Project } from "ts-morph";
import path from "node:path";
import fs from "node:fs";

const repoRoot = process.cwd();
const args = process.argv.slice(2);

if (args.length === 0 || args.length % 2 !== 0) {
	console.error("Usage: node scripts/refactor/move-module.mjs <from> <to> [<from> <to> ...]");
	process.exit(1);
}

const pairs = [];
for (let i = 0; i < args.length; i += 2) {
	pairs.push({ from: args[i], to: args[i + 1] });
}

const project = new Project({
	tsConfigFilePath: path.join(repoRoot, "tsconfig.app.json"),
});

// ts-morph's SourceFile#move() only rewrites relative import specifiers.
// This repo also imports via the "@/..." alias (mapped to src/), which
// move() leaves untouched, so track alias rewrites ourselves and apply
// them as a text pass over every import/export specifier after moving.
const aliasRewrites = []; // { fromAlias, toAlias }
const srcRoot = path.join(repoRoot, "src");

function toAlias(absPath) {
	const rel = path.relative(srcRoot, absPath).replace(/\\/g, "/");
	return `@/${rel}`;
}

for (const { from, to } of pairs) {
	const fromAbs = path.resolve(repoRoot, from);
	const toAbs = path.resolve(repoRoot, to);
	const stat = fs.statSync(fromAbs);

	if (stat.isDirectory()) {
		const sourceFiles = project.getSourceFiles(`${fromAbs.replace(/\\/g, "/")}/**/*.{ts,tsx}`);
		if (sourceFiles.length === 0) {
			console.warn(`No source files found under ${from}`);
			continue;
		}
		for (const sf of sourceFiles) {
			const rel = path.relative(fromAbs, sf.getFilePath());
			const dest = path.join(toAbs, rel);
			console.log(`${path.relative(repoRoot, sf.getFilePath())} -> ${path.relative(repoRoot, dest)}`);
			sf.move(dest);
		}
		aliasRewrites.push({ fromAlias: toAlias(fromAbs), toAlias: toAlias(toAbs) });
	} else {
		const sf = project.getSourceFileOrThrow(fromAbs.replace(/\\/g, "/"));
		console.log(`${from} -> ${to}`);
		sf.move(toAbs);
		aliasRewrites.push({ fromAlias: toAlias(fromAbs), toAlias: toAlias(toAbs) });
	}
}

// Apply alias rewrites to every import/export declaration in the project.
// Sort longest-first so nested-folder rewrites don't get shadowed by a
// shorter parent-folder rewrite matching first.
aliasRewrites.sort((a, b) => b.fromAlias.length - a.fromAlias.length);

for (const sf of project.getSourceFiles()) {
	const specifiers = [
		...sf.getImportDeclarations(),
		...sf.getExportDeclarations(),
	].map((d) => d.getModuleSpecifier?.())
		.filter(Boolean);

	for (const specNode of specifiers) {
		const value = specNode.getLiteralValue();
		for (const { fromAlias, toAlias: newAlias } of aliasRewrites) {
			if (value === fromAlias || value.startsWith(`${fromAlias}/`)) {
				specNode.setLiteralValue(newAlias + value.slice(fromAlias.length));
				break;
			}
		}
	}
}

await project.save();

// Clean up any directories left empty by the move (recursively, so an empty
// parent left behind by removing its last empty child also gets removed).
function removeEmptyDirs(dirAbs) {
	if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return;
	for (const entry of fs.readdirSync(dirAbs)) {
		removeEmptyDirs(path.join(dirAbs, entry));
	}
	if (fs.readdirSync(dirAbs).length === 0) {
		fs.rmdirSync(dirAbs);
		console.log(`Removed empty dir: ${path.relative(repoRoot, dirAbs)}`);
	}
}

for (const { from } of pairs) {
	const fromAbs = path.resolve(repoRoot, from);
	if (fs.existsSync(fromAbs) && fs.statSync(fromAbs).isDirectory()) {
		removeEmptyDirs(fromAbs);
	}
}

console.log("Done. Run `pnpm typecheck` and `pnpm lint` to verify.");
