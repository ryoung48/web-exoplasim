import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const directory = fileURLToPath(new URL(".", import.meta.url));
const output = path.resolve(process.env.EXOPLASIM_OUT ?? path.resolve(directory, "../../stats/exoplasim-wasm"));
const reference = path.resolve(process.env.EXOPLASIM_REFERENCE ?? output);
const label = process.env.EXOPLASIM_RUN ?? "";
assert(/^[a-zA-Z0-9-]*$/.test(label));
const suffix = label ? `-${label}` : "";
const profiling = process.env.EXOPLASIM_PROFILE === "1";
const steps = Number(process.argv[2] ?? 48);
assert(Number.isInteger(steps) && steps > 0);
const build = JSON.parse(await fs.readFile(path.join(output, "build.json"), "utf8"));
const ranks = build.ranks ?? 1;
const [gridLongitudes, gridLatitudes] = build.grid;
const spin = Number(process.env.EXOPLASIM_SPIN ?? 20000);
assert(Number.isInteger(spin) && spin >= 0);
const mpstep = Number(process.env.EXOPLASIM_MPSTEP ?? 30);
assert(Number.isInteger(1440 / mpstep), "EXOPLASIM_MPSTEP must divide a day");
const stepsPerDay = 1440 / mpstep;
const nradint = Number(process.env.EXOPLASIM_NRADINT ?? 1);
assert(Number.isInteger(nradint) && nradint >= 1);
const timeoutMinutes = Number(process.env.EXOPLASIM_TIMEOUT_MINUTES ?? 10);
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".data": "application/octet-stream" };
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const server = http.createServer(async (request, response) => {
    const name = new URL(request.url, "http://localhost").pathname;
    try {
        if (name === "/") {
            response.writeHead(200, { "Content-Type": "text/html", ...isolation });
            response.end("<!doctype html><meta charset=utf-8><title>ExoPlaSim Wasm experiment</title><h1>ExoPlaSim Wasm experiment</h1><pre id=result>Running serial T21 climate model in a Web Worker…</pre>");
            return;
        }
        const files = { "/worker.js": path.join(directory, "worker.js"), ...Object.fromEntries(["exoplasim.js", "exoplasim.wasm", "exoplasim.data"].map((file) => ["/" + file, path.join(output, file)])) };
        if (!files[name]) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { "Content-Type": types[path.extname(name)], ...isolation });
        response.end(await fs.readFile(files[name]));
    } catch (error) {
        response.writeHead(500); response.end(String(error));
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
    const page = await browser.newPage();
    const cdp = profiling ? await page.context().newCDPSession(page) : null;
    if (cdp) await cdp.send("Tracing.start", { categories: "disabled-by-default-v8.cpu_profiler", options: "sampling-frequency=1000", transferMode: "ReturnAsStream" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async ({ steps, ranks, spin, mpstep, nradint, timeoutMinutes }) => {
        let ticks = 0;
        const heartbeat = setInterval(() => { ticks++; }, 10);
        const workers = Array.from({ length: ranks }, () => new Worker("/worker.js"));
        const reply = (worker, type) => new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) => { if (data.type === type) resolve(data); };
            worker.onerror = (event) => reject(new Error(event.message));
        });
        const exchange = (type, message) => Promise.all(workers.map((worker, rank) => {
            const answer = reply(worker, type);
            worker.postMessage(message(rank));
            return answer;
        }));
        let timeout;
        const deadline = new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error(`Simulation exceeded ${timeoutMinutes} minutes`)), timeoutMinutes * 60000); });
        try {
            if (ranks > 1 && !self.crossOriginIsolated) throw new Error("Shared-memory ranks require cross-origin isolation");
            const sab = ranks > 1 ? new SharedArrayBuffer(64 + 2 * 8 * 1024 * 1024) : null;
            const loaded = await Promise.race([exchange("loaded", (rank) => ({ type: "load", steps, rank, size: ranks, sab, spin, mpstep, nradint })), deadline]);
            const failedLoad = loaded.find((value) => value.ok === false);
            if (failedLoad) return { ...failedLoad, mainThreadTicks: ticks };
            const started = performance.now();
            const results = await Promise.race([exchange("result", () => ({ type: "run" })), deadline]);
            const wallMs = performance.now() - started;
            const [root] = results;
            const failed = results.find((value) => !value.ok);
            const [header, ...rows] = (root.fields ?? "").trim().split(/\r?\n/);
            const fields = [header, ...rows, ...results.slice(1).flatMap((value) => (value.fields ?? "").trim().split(/\r?\n/).slice(1))].join("\n");
            const value = {
                ok: !failed,
                exitCode: failed?.exitCode ?? root.exitCode,
                error: failed?.error,
                ranks,
                spin,
                loadMs: Math.max(...loaded.map((item) => item.loadMs)),
                simulationMs: wallMs,
                rankSimulationMs: results.map((item) => item.simulationMs),
                memoryBytes: results.reduce((total, item) => total + (item.memoryBytes ?? 0), 0),
                rankMemory: results.map(({ memoryBytes, stackBytes, stackHighWaterBytes, heapEndBytes }) => ({ memoryBytes, stackBytes, stackHighWaterBytes, heapEndBytes })),
                shmStats: results.map((item) => item.shmStats),
                fields,
                diagnostic: root.diagnostic,
                consoleLines: failed?.consoleLines ?? root.consoleLines,
            };
            document.getElementById("result").textContent = JSON.stringify({ ...value, fields: value.fields?.slice(0, 1000), diagnostic: value.diagnostic?.slice(-5000) }, null, 2);
            return { ...value, mainThreadTicks: ticks, userAgent: navigator.userAgent };
        } finally {
            clearTimeout(timeout);
            clearInterval(heartbeat);
            for (const worker of workers) worker.terminate();
        }
    }, { steps, ranks, spin, mpstep, nradint, timeoutMinutes });
    if (cdp) {
        const completed = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
        await cdp.send("Tracing.end");
        const { stream } = await completed;
        const chunks = [];
        for (;;) {
            const chunk = await cdp.send("IO.read", { handle: stream });
            chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
            if (chunk.eof) break;
        }
        await cdp.send("IO.close", { handle: stream });
        const trace = Buffer.concat(chunks);
        await fs.writeFile(path.join(output, `trace-${steps}${suffix}.json`), trace);
        const profiles = new Map();
        for (const event of JSON.parse(trace).traceEvents) {
            if (event.name !== "ProfileChunk") continue;
            const key = `${event.pid}:${event.tid}:${event.id}`;
            if (!profiles.has(key)) profiles.set(key, { nodes: new Map(), samples: [] });
            const profile = profiles.get(key);
            const cpu = event.args.data.cpuProfile;
            for (const node of cpu?.nodes ?? []) profile.nodes.set(node.id, node.callFrame);
            profile.samples.push(...(cpu?.samples ?? []));
        }
        const counts = new Map();
        let wasmSamples = 0;
        for (const profile of profiles.values()) {
            for (const sample of profile.samples) {
                const frame = profile.nodes.get(sample);
                if (!frame?.url?.includes("exoplasim.wasm")) continue;
                const name = frame.functionName;
                counts.set(name, (counts.get(name) ?? 0) + 1);
                wasmSamples++;
            }
        }
        const hotspots = [...counts].map(([name, samples]) => ({ name, samples, percent: samples * 100 / wasmSamples })).sort((a, b) => b.samples - a.samples);
        await fs.writeFile(path.join(output, `profile-${steps}${suffix}.json`), JSON.stringify({ wasmSamples, hotspots }, null, 2));
        console.log(JSON.stringify({ wasmSamples, hotspots: hotspots.slice(0, 15) }, null, 2));
    }
    await fs.writeFile(path.join(output, `browser-${steps}${suffix}.json`), JSON.stringify({ ...result, errors }, null, 2));
    assert(result.ok, JSON.stringify(result));
    const rows = result.fields.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number));
    const [step, longitudes, latitudes, layers] = rows.shift();
    assert.equal(step, 360 * stepsPerDay + steps);
    assert.equal(longitudes, gridLongitudes);
    assert.equal(latitudes, gridLatitudes);
    assert.equal(layers, 10);
    assert.equal(rows.length, longitudes * latitudes);
    assert(rows.every((row) => row.length === 6 && row.every(Number.isFinite)));
    assert(result.mainThreadTicks > 0);
    assert.deepEqual(errors, []);
    const ranges = ["surfaceTemperatureK", "surfaceAirTemperatureK", "zonalWindMps", "meridionalWindMps", "surfacePressurePa", "specificHumidity"].map((name, column) => {
        const values = rows.map((row) => row[column]);
        return { name, min: Math.min(...values), max: Math.max(...values) };
    });
    function compareFields(text) {
        const referenceRows = text.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number));
        assert.deepEqual(referenceRows.shift(), [step, longitudes, latitudes, layers]);
        assert.equal(referenceRows.length, rows.length);
        assert(referenceRows.every((row) => row.length === 6 && row.every(Number.isFinite)));
        const tolerances = [1e-6, 1e-6, 1e-6, 1e-6, 1e-4, 1e-10];
        return ranges.map(({ name }, column) => ({ name, tolerance: tolerances[column], error: Math.max(...rows.map((row, index) => Math.abs(row[column] - referenceRows[index][column]))) }));
    }
    let nativeComparison = null;
    try {
        const nativeResult = JSON.parse(await fs.readFile(path.join(reference, "native-result.json"), "utf8"));
        if (nativeResult.steps === steps) {
            nativeComparison = { nativeSeconds: nativeResult.elapsedSeconds, maxAbsoluteError: compareFields(await fs.readFile(path.join(reference, "native-fields.txt"), "utf8")) };
        }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    let baselineComparison = null;
    if (reference !== output) {
        const baseline = JSON.parse(await fs.readFile(path.join(reference, `browser-${steps}.json`), "utf8"));
        assert(baseline.ok);
        baselineComparison = { baselineMs: baseline.simulationMs, speedup: baseline.simulationMs / result.simulationMs, maxAbsoluteError: compareFields(baseline.fields) };
    }
    const sizes = Object.fromEntries(await Promise.all(["exoplasim.js", "exoplasim.wasm", "exoplasim.data"].map(async (file) => [file, (await fs.stat(path.join(output, file))).size])));
    const wasmSha256 = createHash("sha256").update(await fs.readFile(path.join(output, "exoplasim.wasm"))).digest("hex");
    const summary = { steps, ranks, spin, mpstep, nradint, finalStep: step, simulatedDays: steps / stepsPerDay, loadMs: result.loadMs, simulationMs: result.simulationMs, rankSimulationMs: result.rankSimulationMs, shmStats: result.shmStats, memoryBytes: result.memoryBytes, rankMemory: result.rankMemory, mainThreadTicks: result.mainThreadTicks, ranges, nativeComparison, baselineComparison, sizes, wasmSha256, profiling };
    await fs.writeFile(path.join(output, `summary-${steps}${suffix}.json`), JSON.stringify(summary, null, 2));
    await page.screenshot({ path: path.join(output, `browser-${steps}${suffix}.png`), fullPage: true });
    console.log(JSON.stringify(summary, null, 2));
    for (const comparison of [nativeComparison, baselineComparison]) {
        if (comparison) assert(comparison.maxAbsoluteError.every(({ error, tolerance }) => error <= tolerance), JSON.stringify(comparison));
    }
} finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
