// Move one or more named exports (function/const/interface/type/class) out
// of a source file into a destination file, repoint every project-wide
// importer of those symbols to the new module, AND resolve the transitive
// import fallout on both ends:
//   - symbols the moved declarations depend on (either imported into the
//     source file from elsewhere, or declared in the source file itself and
//     left behind) get an import added in the destination file
//   - imports in the source file that are no longer used after the move get
//     removed
//
// Usage:
//   node scripts/refactor/move-symbol.mjs <fromFile> <toFile> <symbol> [<symbol> ...]
//
// <fromFile>/<toFile> are repo-relative paths. <toFile> is created (with
// dirs) if it doesn't exist.
//
// Example:
//   node scripts/refactor/move-symbol.mjs \
//     src/model/transport/types.ts \
//     src/model/worker-protocol/types.ts \
//     SerializedGenesisWorld SerializedHistoryFrame GenesisWorkerRequest GenesisWorkerResponse

import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";
import fs from "node:fs";

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");
const args = process.argv.slice(2);

if (args.length < 3) {
	console.error(
		"Usage: node scripts/refactor/move-symbol.mjs <fromFile> <toFile> <symbol> [<symbol> ...]",
	);
	process.exit(1);
}

const [fromRel, toRel, ...symbolNames] = args;
const fromAbs = path.resolve(repoRoot, fromRel);
const toAbs = path.resolve(repoRoot, toRel);

function toAlias(absPath) {
	const rel = path.relative(srcRoot, absPath).replace(/\\/g, "/");
	return `@/${rel.replace(/\.tsx?$/, "")}`;
}

const project = new Project({
	tsConfigFilePath: path.join(repoRoot, "tsconfig.app.json"),
});

const fromFile = project.getSourceFileOrThrow(fromAbs.replace(/\\/g, "/"));

if (!fs.existsSync(toAbs)) {
	fs.mkdirSync(path.dirname(toAbs), { recursive: true });
	fs.writeFileSync(toAbs, "");
}
const toFile = project.addSourceFileAtPathIfExists(toAbs.replace(/\\/g, "/"))
	?? project.createSourceFile(toAbs.replace(/\\/g, "/"), "", { overwrite: false });

const fromAlias = toAlias(fromAbs);
const toAliasPath = toAlias(toAbs);

const DECL_KINDS = new Set([
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.InterfaceDeclaration,
	SyntaxKind.TypeAliasDeclaration,
	SyntaxKind.ClassDeclaration,
	SyntaxKind.EnumDeclaration,
]);

function findTopLevelDeclaration(sourceFile, name) {
	for (const stmt of sourceFile.getStatements()) {
		if (DECL_KINDS.has(stmt.getKind()) && stmt.getName?.() === name) {
			return stmt;
		}
		if (stmt.getKind() === SyntaxKind.VariableStatement) {
			const decl = stmt.getDeclarationList().getDeclarations().find((d) => d.getName() === name);
			if (decl) return stmt;
		}
	}
	return undefined;
}

// --- Step 1: build dependency maps from fromFile BEFORE removing anything ---

// name -> { moduleSpecifier, isTypeOnly }  (imports already present in fromFile)
const importedElsewhere = new Map();
for (const imp of fromFile.getImportDeclarations()) {
	const moduleSpecifier = imp.getModuleSpecifierValue();
	const declTypeOnly = imp.isTypeOnly();
	const def = imp.getDefaultImport();
	if (def) importedElsewhere.set(def.getText(), { moduleSpecifier, isTypeOnly: declTypeOnly, isDefault: true });
	const ns = imp.getNamespaceImport();
	if (ns) importedElsewhere.set(ns.getText(), { moduleSpecifier, isTypeOnly: declTypeOnly, isNamespace: true });
	for (const ni of imp.getNamedImports()) {
		const localName = ni.getAliasNode()?.getText() ?? ni.getName();
		importedElsewhere.set(localName, {
			moduleSpecifier,
			isTypeOnly: declTypeOnly || ni.isTypeOnly(),
			importedName: ni.getName(),
		});
	}
}

// name -> declaration kind, for symbols declared in fromFile that are NOT moving
const remainingLocalDecls = new Map();
for (const stmt of fromFile.getStatements()) {
	if (DECL_KINDS.has(stmt.getKind())) {
		const name = stmt.getName?.();
		if (name && !symbolNames.includes(name)) {
			remainingLocalDecls.set(name, stmt.getKind());
		}
	}
	if (stmt.getKind() === SyntaxKind.VariableStatement) {
		for (const d of stmt.getDeclarationList().getDeclarations()) {
			if (!symbolNames.includes(d.getName())) {
				remainingLocalDecls.set(d.getName(), SyntaxKind.VariableStatement);
			}
		}
	}
}

const declNodes = symbolNames
	.map((name) => ({ name, node: findTopLevelDeclaration(fromFile, name) }))
	.filter(({ node, name }) => {
		if (!node) console.warn(`Could not find top-level export "${name}" in ${fromRel} — skipping`);
		return !!node;
	});

if (declNodes.length === 0) {
	console.error("No symbols found, aborting.");
	process.exit(1);
}

// Collect every identifier referenced inside the moved declarations (minus
// their own declared names) so we know what the destination file needs.
const neededFromImports = new Map(); // moduleSpecifier|typeOnly -> Set(names)
const neededFromLocal = new Set(); // names still declared in fromFile

for (const { node } of declNodes) {
	for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
		const text = id.getText();
		if (symbolNames.includes(text)) continue; // internal reference among moved symbols

		if (importedElsewhere.has(text)) {
			const info = importedElsewhere.get(text);
			const key = `${info.moduleSpecifier}|${info.isTypeOnly ? "type" : "value"}`;
			if (!neededFromImports.has(key)) {
				neededFromImports.set(key, { moduleSpecifier: info.moduleSpecifier, isTypeOnly: info.isTypeOnly, names: new Set() });
			}
			neededFromImports.get(key).names.add(info.importedName ?? text);
		} else if (remainingLocalDecls.has(text)) {
			neededFromLocal.add(text);
		}
	}
}

// --- Step 2: move the declaration text into toFile ---

const movedTexts = declNodes.map(({ node }) => node.getFullText().trim());
for (const { node, name } of declNodes) {
	node.remove();
	console.log(`${name}: ${fromRel} -> ${toRel}`);
}

const existingBody = toFile.getFullText().trim();
toFile.replaceWithText(
	[existingBody, ...movedTexts].filter(Boolean).join("\n\n") + "\n",
);

// --- Step 3: add the imports toFile now needs ---

function addOrMergeImport(targetFile, moduleSpecifier, names, isTypeOnly) {
	const existing = targetFile.getImportDeclaration(
		(d) => d.getModuleSpecifierValue() === moduleSpecifier && d.isTypeOnly() === isTypeOnly,
	);
	if (existing) {
		const already = new Set(existing.getNamedImports().map((ni) => ni.getName()));
		for (const n of names) {
			if (!already.has(n)) existing.addNamedImport(n);
		}
	} else {
		targetFile.addImportDeclaration({
			namedImports: [...names],
			moduleSpecifier,
			isTypeOnly,
		});
	}
}

for (const { moduleSpecifier, isTypeOnly, names } of neededFromImports.values()) {
	addOrMergeImport(toFile, moduleSpecifier, names, isTypeOnly);
}
if (neededFromLocal.size > 0) {
	addOrMergeImport(toFile, fromAlias, neededFromLocal, false);
}

// --- Step 4: repoint every project-wide importer of the moved symbols ---

for (const sf of project.getSourceFiles()) {
	if (sf === toFile || sf === fromFile) continue;
	for (const imp of sf.getImportDeclarations()) {
		const spec = imp.getModuleSpecifierValue();
		if (spec !== fromAlias) continue;

		const namedImports = imp.getNamedImports();
		const moved = namedImports.filter((ni) => symbolNames.includes(ni.getName()));
		const kept = namedImports.filter((ni) => !symbolNames.includes(ni.getName()));
		if (moved.length === 0) continue;

		const movedNamesText = moved.map((ni) => ni.getText());
		if (kept.length === 0) {
			imp.setModuleSpecifier(toAliasPath);
		} else {
			for (const ni of moved) ni.remove();
			sf.addImportDeclaration({
				namedImports: movedNamesText,
				moduleSpecifier: toAliasPath,
				isTypeOnly: imp.isTypeOnly(),
			});
		}
		console.log(`  importer updated: ${path.relative(repoRoot, sf.getFilePath())}`);
	}
}

// --- Step 5: if fromFile itself still uses a moved symbol, import it back ---

const fromFileText = fromFile.getFullText();
const stillUsed = symbolNames.filter((name) => new RegExp(`\\b${name}\\b`).test(fromFileText));
if (stillUsed.length > 0) {
	addOrMergeImport(fromFile, toAliasPath, stillUsed, false);
	console.log(`Re-imported into ${fromRel}: ${stillUsed.join(", ")}`);
}

// --- Step 6: drop now-unused imports from fromFile ---

for (const imp of fromFile.getImportDeclarations()) {
	const specifiers = [
		...imp.getNamedImports().map((ni) => ({ node: ni, nameNode: ni.getAliasNode() ?? ni.getNameNode() })),
	];
	for (const { node, nameNode } of specifiers) {
		const refs = nameNode.findReferencesAsNodes();
		const usedElsewhere = refs.some((r) => {
			if (r.getSourceFile() !== fromFile) return false;
			const ancestorImport = r.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
			return !ancestorImport;
		});
		if (!usedElsewhere) node.remove();
	}
	const defaultImport = imp.getDefaultImport();
	if (defaultImport) {
		const refs = defaultImport.findReferencesAsNodes();
		const usedElsewhere = refs.some((r) => r.getSourceFile() === fromFile && !r.getFirstAncestorByKind(SyntaxKind.ImportDeclaration));
		if (!usedElsewhere) imp.removeDefaultImport();
	}
	if (
		imp.getNamedImports().length === 0 &&
		!imp.getDefaultImport() &&
		!imp.getNamespaceImport()
	) {
		imp.remove();
	}
}

await project.save();
console.log("Done. Run `pnpm typecheck` and `pnpm lint` to verify.");
