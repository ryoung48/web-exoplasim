// Rename a top-level exported symbol (function/const/interface/type/class)
// and update every project-wide reference to it, using ts-morph's built-in
// rename (language-service powered, so it also catches property-access
// usages like `OLD_NAME.someMethod`).
//
// Usage:
//   node scripts/refactor/rename-symbol.mjs <file> <oldName> <newName>
//
// <file> is a repo-relative path to where the symbol is declared.
//
// Example:
//   node scripts/refactor/rename-symbol.mjs \
//     src/model/history/generated/eu4-days/index.ts EU4_DAYS HISTORY_DAYS

import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

const repoRoot = process.cwd();
const args = process.argv.slice(2);

if (args.length !== 3) {
	console.error(
		"Usage: node scripts/refactor/rename-symbol.mjs <file> <oldName> <newName>",
	);
	process.exit(1);
}

const [fileRel, oldName, newName] = args;
const fileAbs = path.resolve(repoRoot, fileRel).replace(/\\/g, "/");

const project = new Project({
	tsConfigFilePath: path.join(repoRoot, "tsconfig.app.json"),
});

const sourceFile = project.getSourceFileOrThrow(fileAbs);

const DECL_KINDS = new Set([
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.InterfaceDeclaration,
	SyntaxKind.TypeAliasDeclaration,
	SyntaxKind.ClassDeclaration,
	SyntaxKind.EnumDeclaration,
]);

function findNameNode(file, name) {
	for (const stmt of file.getStatements()) {
		if (DECL_KINDS.has(stmt.getKind()) && stmt.getName?.() === name) {
			return stmt.getNameNode();
		}
		if (stmt.getKind() === SyntaxKind.VariableStatement) {
			const decl = stmt
				.getDeclarationList()
				.getDeclarations()
				.find((d) => d.getName() === name);
			if (decl) return decl.getNameNode();
		}
	}
	return undefined;
}

const nameNode = findNameNode(sourceFile, oldName);
if (!nameNode) {
	console.error(`Could not find top-level declaration "${oldName}" in ${fileRel}`);
	process.exit(1);
}

// Collect every node to update by union-ing references of the declaration
// itself with references of any shorthand object-literal property that
// aliases it (e.g. `export const FOO = { oldName }`). ts-morph/TS's
// Node#rename() does not reliably propagate across that shorthand boundary —
// `nameNode.rename()` on the FunctionDeclaration only updates the same file,
// while consumers calling `FOO.oldName(...)` are addressed through the
// property, a distinct symbol as far as cross-file rename is concerned. So
// instead of relying on rename(), we gather the full reference set up front
// and replace each occurrence's text directly.
const refNodes = new Map(); // `${filePath}:${start}` -> node
function addRefs(n) {
	refNodes.set(`${n.getSourceFile().getFilePath()}:${n.getStart()}`, n);
	for (const ref of n.findReferencesAsNodes()) {
		refNodes.set(`${ref.getSourceFile().getFilePath()}:${ref.getStart()}`, ref);
	}
}
addRefs(nameNode);
for (const shorthand of sourceFile.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)) {
	if (shorthand.getName() === oldName) {
		addRefs(shorthand.getNameNode());
	}
}

const refCount = refNodes.size;
for (const ref of refNodes.values()) {
	ref.replaceWithText(newName);
}

await project.save();
console.log(`Renamed ${oldName} -> ${newName} (${refCount} reference(s)) in ${fileRel}`);
console.log("Run `npm run typecheck` to verify.");
