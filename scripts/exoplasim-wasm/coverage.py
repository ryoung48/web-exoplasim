import argparse
import gzip
import json
from pathlib import Path
import re


parser = argparse.ArgumentParser(description="Summarize gcov JSON captures of the ExoPlaSim reference into executed routines")
parser.add_argument("captures", type=Path, nargs="+", help="capture directories in run order; counts are cumulative")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
# Routines that only run before the first or after the last step. Everything
# else that executes is time-loop work the GPU port must cover.
SETUP = re.compile(r"(ini|stop|_init|_read)$|^(prolog|epilog|readnl|initpm|initsi|legini|inilat|initfd|setzt|noise|initrandom|makebm|minvers|ludcmp|lubksb|"
                   r"setfilenames|opendiag|allocate_arrays|read_atmos_restart|restart_|get_restart|put_restart|printseed|dayseccheck|main$|mp\w+|wasm_fields|"
                   r"gcm_reference_step|orb_params|orb_print|solarini|newtonraphson)")
EXCLUDED = ["tpcore.f90", "trc_routines.f90", "tracermod.f90", "aeromod.f90", "aerocore.f90", "outmod.f90", "hurricanemod.f90", "guimod_stub.f90", "cpl_stub.f90", "lsgmod.f90"]


def routine(name: str) -> str:
    match = re.match(r"__(\w+?)_MOD_(\w+)$", name)
    return match.group(2) if match else name.rstrip("_")


def read(capture: Path) -> dict:
    files = {}
    for path in sorted(capture.glob("*.gcov.json.gz")):
        for entry in json.loads(gzip.decompress(path.read_bytes()))["files"]:
            name = Path(entry["file"]).name
            if not name.endswith(".f90"):
                continue
            functions = {}
            for function in entry["functions"]:
                functions[routine(function["name"])] = {"start": function["start_line"], "end": function["end_line"], "calls": function["execution_count"], "executed": 0, "lines": 0}
            for line in entry["lines"]:
                owner = next((f for f in functions.values() if f["start"] <= line["line_number"] <= f["end"]), None)
                if owner:
                    owner["lines"] += 1
                    owner["executed"] += int(line["count"] > 0)
            files[name] = functions
    return files


captures = [(capture.name, read(capture)) for capture in args.captures]
final = captures[-1][1]
report = {"captures": [name for name, _ in captures], "routines": [], "excludedModules": {}}
for file, functions in sorted(final.items()):
    for name, function in sorted(functions.items(), key=lambda item: item[1]["start"]):
        if function["calls"] == 0:
            continue
        first = next(label for label, files in captures if files.get(file, {}).get(name, {}).get("calls", 0) > 0)
        added = []
        previous = 0
        for label, files in captures:
            executed = files.get(file, {}).get(name, {}).get("executed", 0)
            if executed > previous:
                added.append({"capture": label, "lines": executed - previous})
            previous = max(previous, executed)
        report["routines"].append({"file": file, "routine": name, "phase": "setup" if SETUP.search(name) else "step", "calls": function["calls"],
                                   "executedLines": function["executed"], "lines": function["lines"], "firstCapture": first, "linesAddedBy": added})
for file in EXCLUDED:
    functions = final.get(file, {})
    report["excludedModules"][file] = {name: f["executed"] for name, f in functions.items() if f["executed"] > 0 and not SETUP.search(name)}
step = [r for r in report["routines"] if r["phase"] == "step" and r["file"] not in EXCLUDED]
report["totals"] = {"stepRoutines": len(step), "stepExecutedLines": sum(r["executedLines"] for r in step), "stepLines": sum(r["lines"] for r in step)}
args.output.write_text(json.dumps(report, indent=2))
print(json.dumps(report["totals"]), json.dumps(report["excludedModules"]))
for r in step:
    print(f"{r['file']:18} {r['routine']:24} calls={r['calls']:>10} lines={r['executedLines']}/{r['lines']} first={r['firstCapture']}")
