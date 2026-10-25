importScripts("/exoplasim.js");

const consoleLines = [];
let exitCode = null;
let model = null;
let shared = null;

function readOptional(file) {
    return model?.FS.analyzePath(file).exists ? model.FS.readFile(file, { encoding: "utf8" }) : null;
}

function abortOthers() {
    if (!shared) return;
    const control = new Int32Array(shared, 0, 16);
    Atomics.store(control, 2, 1);
    Atomics.notify(control, 1);
}

async function load({ steps, rank, size, sab, spin, mpstep, nradint }) {
    shared = sab;
    const started = performance.now();
    model = await createExoPlaSim({
        noInitialRun: true,
        print: (line) => consoleLines.push(line),
        printErr: (line) => consoleLines.push(line),
        onExit: (code) => { exitCode = code; },
        ...(size > 1 ? { shm: { sab, rank, size, spin } } : {}),
    });
    const config = model.FS.readFile("/plasim_namelist", { encoding: "utf8" })
        .replace(/N_RUN_STEPS\s*=\s*\d+/i, `N_RUN_STEPS = ${steps}`)
        .replace(/NDIAG\s*=\s*\d+/i, `NDIAG = ${steps}`)
        .replace(/MPSTEP\s*=\s*[\d.]+/i, `MPSTEP = ${mpstep}`);
    model.FS.writeFile("/plasim_namelist", config);
    const radiation = model.FS.readFile("/radmod_namelist", { encoding: "utf8" }).replace(/^\s*\/END/im, ` NRADINT = ${nradint}
 /END`);
    model.FS.writeFile("/radmod_namelist", radiation);
    return { loadMs: performance.now() - started };
}

const STACK_PAINT = 0xa5;
const STACK_COOKIE_BYTES = 64;

function paintStack() {
    const base = model._emscripten_stack_get_base();
    const end = model._emscripten_stack_get_end();
    model.HEAPU8.fill(STACK_PAINT, end + STACK_COOKIE_BYTES, base);
    return { base, end };
}

function stackHighWater({ base, end }) {
    const memory = model.HEAPU8;
    let address = end + STACK_COOKIE_BYTES;
    while (address < base && memory[address] === STACK_PAINT) address++;
    return { stackBytes: base - end, stackHighWaterBytes: base - address };
}

function run() {
    const stack = paintStack();
    const started = performance.now();
    model.callMain([]);
    const simulationMs = performance.now() - started;
    if (exitCode !== 0) abortOthers();
    return {
        ok: exitCode === 0,
        exitCode,
        simulationMs,
        memoryBytes: model.HEAPU8?.byteLength ?? null,
        ...stackHighWater(stack),
        heapEndBytes: model._sbrk(0),
        fields: model.FS.readFile("/wasm-fields.txt", { encoding: "utf8" }),
        diagnostic: readOptional("/plasim_diag"),
        shmStats: model.shmStats ?? null,
        consoleLines,
    };
}

self.onmessage = async ({ data }) => {
    try {
        if (data.type === "load") self.postMessage({ type: "loaded", ...(await load(data)) });
        else if (data.type === "run") self.postMessage({ type: "result", ...run() });
    } catch (error) {
        abortOthers();
        self.postMessage({ type: data.type === "load" ? "loaded" : "result", ok: false, error: String(error.stack ?? error), exitCode, consoleLines, diagnostic: readOptional("/plasim_diag") });
    }
};
