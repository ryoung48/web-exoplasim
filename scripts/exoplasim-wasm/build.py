import argparse
import json
import math
import os
from pathlib import Path
import re
import resource
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

from model_source import ModelSource, copy_sources, object_names, patch_sources


parser = argparse.ArgumentParser()
parser.add_argument("--work", type=Path, default=Path("/var/tmp/chaos-exoplasim-wasm"))
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--target", choices=["wasm", "native"], default="wasm")
parser.add_argument("--steps", type=int, default=48)
parser.add_argument("--link-only", action="store_true")
parser.add_argument("--debug", action="store_true")
parser.add_argument("--variant", choices=["scalar", "simd"], default="scalar")
parser.add_argument("--profile", action="store_true")
parser.add_argument("--assignment", choices=["generic", "bulk"], default="bulk")
parser.add_argument("--frontend-opt", type=int, choices=[0, 2], default=2, help="Flang frontend optimization level for the emitted LLVM IR")
parser.add_argument("--ranks", type=int, choices=[1, 2, 4, 8, 16], default=1)
parser.add_argument("--stack-mib", type=int)
parser.add_argument("--initial-memory-mib", type=int)
parser.add_argument("--truncation", type=int, choices=[21, 42], default=21)
parser.add_argument("--precision", type=int, choices=[4, 8], default=8, help="bytes per default REAL, like ExoPlaSim's Model(precision=...)")
parser.add_argument("--app", action="store_true", help="ES module for the Chaos Machine /gcm page, with live field snapshots")
args = parser.parse_args()
# gp2fc and fc2gp call dfft8(a,a,...) and ifft8(a,a,...): the same array as
# input and output dummy, which -O2 assumes cannot alias.
FRONTEND_O0_FILES = ["fftmod.f90"]
latitudes = {21: 32, 42: 64}[args.truncation]
# Painted-stack high-water marks at T21: 8.68 MiB with all 2048 points on one
# rank, 1.65 MiB with 256 points per rank (8 ranks). The fit underestimates
# T42 (6.49 MiB measured with 1024 points per rank against 4.66 predicted),
# so allow three times the fit.
points_per_rank = 2 * latitudes * latitudes // args.ranks
stack_estimate_mib = 0.646 + 0.003923 * points_per_rank
fitted_stack_mib = max(8, math.ceil(3 * stack_estimate_mib))
args.stack_mib = args.stack_mib or (max(64, fitted_stack_mib) if args.ranks == 1 else fitted_stack_mib)
args.initial_memory_mib = args.initial_memory_mib or (128 if args.ranks == 1 and args.truncation == 21 else args.stack_mib + 8)
if args.initial_memory_mib <= args.stack_mib:
    parser.error("--initial-memory-mib must exceed --stack-mib")
if args.steps < 1:
    parser.error("--steps must be positive")
if args.ranks > 1 and args.target != "wasm":
    parser.error("--ranks applies to the wasm target; build native MPI references separately")
script_directory = Path(__file__).resolve().parent
work = args.work.resolve()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
toolchain = work / "toolchain"
native_toolchain = work / "native"
emsdk = work / "emsdk"
env = os.environ | {"PATH": f"{emsdk / 'bin'}:{toolchain / 'bin'}:{os.environ['PATH']}", "EM_CACHE": str(work / "em-cache")}
env["EXOPLASIM_WORK"] = str(work)
env["EM_BINARYEN_ROOT"] = str(work / "binaryen-version_123")


def run(command):
    print(" ".join(map(str, command)), flush=True)
    return subprocess.run(list(map(str, command)), env=env, check=True)


repodata = work / "wasm-repodata.json"
if not repodata.exists():
    urllib.request.urlretrieve("https://repo.mamba.pm/emscripten-forge/emscripten-wasm32/repodata.json", repodata)
data = json.loads(repodata.read_text())
packages = data.get("packages", {}) | data.get("packages.conda", {})
candidates = [(name, package) for name, package in packages.items() if package["name"] == "libflang"]
print("Wasm runtime packages:", [(name, package.get("depends")) for name, package in candidates], flush=True)
runtime_name = "libflang-19.1.7-h393a672_0.tar.bz2"
runtime_package = work / runtime_name
if not runtime_package.exists():
    urllib.request.urlretrieve(f"https://repo.mamba.pm/emscripten-forge/emscripten-wasm32/{runtime_name}", runtime_package)
runtime_dir = work / "wasm-runtime"
runtime_dir.mkdir(exist_ok=True)
with tarfile.open(runtime_package) as archive:
    archive.extractall(runtime_dir)
print("Runtime:", list(runtime_dir.rglob("*.a")), flush=True)

source = work / "source" / "exoplasim"
build_name = ("build" if args.variant == "scalar" else "build-simd") + ("" if args.ranks == 1 else f"-ranks{args.ranks}") + ("" if args.truncation == 21 else f"-t{args.truncation}") + ("" if args.precision == 8 else "-sp") + ("" if args.frontend_opt == 2 else "-fo0") + ("-app" if args.app else "")
build = work / (build_name if args.target == "wasm" else "build-native-reference")
mpi_module = "mpimod_stub" if args.ranks == 1 else "mpimod_shm"
utility_module = "utilities_stub" if args.ranks == 1 else "utilities"
model = ModelSource(source=source, build=build, output=output, latitudes=latitudes, ranks=args.ranks,
                    main_suffix=(script_directory / "gcm_publish.f90").read_text() if args.app else "",
                    step_hook="gcm_publish_step" if args.app else "", mpi_module=mpi_module, utility_module=utility_module)
copy_sources(model)
if args.ranks > 1:
    shutil.copy2(script_directory / "mpimod_shm.f90", build / "mpimod_shm.f90")
    utilities = build / "utilities.f90"
    gathers = r"call mpi_gather\(pp,n,(MPI_REAL8|mpi_rtype),&\s*&\s*pf,n,(?:MPI_REAL8|mpi_rtype),NROOT,myworld,mpinfo\)"
    element_bytes = {"MPI_REAL8": "8", "mpi_rtype": "RBYTES"}
    text, count = re.subn(gathers, lambda match: f"call shm_blocks(pf,pp,n,n*NPRO,n,1,{element_bytes[match.group(1)]},MODE_ROOT)", utilities.read_text())
    if count != 2:
        raise RuntimeError(f"Expected two MPI gathers in utilities.f90, found {count}")
    utilities.write_text(text)
patch_sources(model)
flags = "-O2 -fdefault-real-8 -fdefault-double-8" if args.precision == 8 else "-O2"
codegen_flags = "-O3 -msimd128" if args.target == "wasm" and args.variant == "simd" else "-O2"
env["EXOPLASIM_CODEGEN_FLAGS"] = codegen_flags
env["EXOPLASIM_FRONTEND_OPT"] = str(args.frontend_opt)
env["EXOPLASIM_FRONTEND_O0"] = " ".join(FRONTEND_O0_FILES)
target_flag = "--target=wasm32-unknown-emscripten" if args.target == "wasm" else ""
c_compiler = emsdk / "bin" / "emcc" if args.target == "wasm" else Path("/usr/bin/gcc")
fortran_compiler = f"python3 {script_directory / 'compile.py'}" if args.target == "wasm" else str(native_toolchain / "bin" / "flang-new")
(build / "Makefile").write_text(
    f"MOST_F90={fortran_compiler}\nMOST_F90_OPTS={target_flag} {flags}\n"
    f"MOST_CC={c_compiler}\nMOST_CC_OPTS={codegen_flags}\nMPIMOD={mpi_module}\nGUIMOD=guimod_stub\nPUMAX=pumax_stub\nUTILMOD={utility_module}\n"
    + (build / "make_plasim").read_text()
    + "\naerocore.o: aeromod.o\n"
)
env["OCEANCOUP"] = "cpl_stub"
os.chdir(build)
objects = object_names(model)
started = time.perf_counter()
if args.target == "wasm":
    frontend = f"{args.frontend_opt} {' '.join(FRONTEND_O0_FILES)}\n"
    if not (build / "frontend.txt").exists() or (build / "frontend.txt").read_text() != frontend:
        (build / "frontend.txt").write_text(frontend)
    with (build / "Makefile").open("a") as makefile:
        makefile.write("\n" + objects + ": " + str(script_directory / "compile.py") + " frontend.txt\n")
if not args.link_only:
    run(["make", "-e", "-j2", *objects.split()])
print("Compiled in", time.perf_counter() - started, "seconds", flush=True)
(build / "entry.c").write_text("extern void _FortranAProgramStart(int, const char **, const char **, const void *);\nextern void _QQmain(void);\nint main(int argc, const char **argv) { _FortranAProgramStart(argc, argv, 0, 0); _QQmain(); return 0; }\n")
inputs = work / ("inputs" if args.truncation == 21 else f"inputs-t{args.truncation}")
inputs.mkdir(exist_ok=True)
for directory in [source / "plasim" / "run", source / "plasim" / "dat" / f"T{args.truncation}"]:
    for file in directory.iterdir():
        if file.is_file() and (file.name.endswith("namelist") or file.name.startswith(f"N{latitudes:03d}_") and file.suffix == ".sra"):
            shutil.copy2(file, inputs / file.name)
settings = {"N_RUN_YEARS": 0, "N_RUN_MONTHS": 0, "N_RUN_DAYS": 0, "N_RUN_STEPS": args.steps, "NDIAG": args.steps, "NOUTPUT": 0, "NSNAPSHOT": 0, "NSYNC": 0, "SEED": "14963991,2,3,4,5,6,7,8"}
namelist = (inputs / "plasim_namelist").read_text()
for name, value in settings.items():
    pattern = rf"(?im)^\s*{name}\s*=.*$"
    line = f" {name} = {value}"
    if re.search(pattern, namelist):
        namelist = re.sub(pattern, line, namelist)
    else:
        namelist = namelist.replace(" /END", line + "\n /END")
(inputs / "plasim_namelist").write_text(namelist)
if args.target == "native":
    executable = build / "exoplasim-native"
    run([c_compiler, *objects.split(), "-L" + str(native_toolchain / "lib"), "-Wl,-rpath," + str(native_toolchain / "lib"), "-lFortranRuntime", "-lstdc++", "-lm", "-o", executable])
    native_run = work / f"native-run-{time.time_ns()}"
    shutil.copytree(inputs, native_run, dirs_exist_ok=True)
    os.chdir(native_run)
    resource.setrlimit(resource.RLIMIT_STACK, (67108864, resource.getrlimit(resource.RLIMIT_STACK)[1]))
    started = time.perf_counter()
    with (output / "native-console.txt").open("w") as console:
        result = subprocess.run([str(executable)], env=env, stdout=console, stderr=subprocess.STDOUT, timeout=600)
    elapsed = time.perf_counter() - started
    shutil.copy2(native_run / "plasim_diag", output / "native-diagnostic.txt")
    result.check_returncode()
    shutil.copy2(native_run / "wasm-fields.txt", output / "native-fields.txt")
    (output / "native-result.json").write_text(json.dumps({"elapsedSeconds": elapsed, "steps": args.steps, "settings": settings}, indent=2))
    print("Native run seconds:", elapsed, flush=True)
    raise SystemExit(0)
decimal_objects = []
runtime_archive = runtime_dir / "lib" / ("libFortranRuntime-fastfill.a" if args.assignment == "bulk" else "libFortranRuntime-matched.a")
runtime_script = script_directory / "runtime.py"
if not runtime_archive.exists() or runtime_archive.stat().st_mtime < runtime_script.stat().st_mtime:
    run([sys.executable, script_directory / "runtime.py", *(["--fast-fill"] if args.assignment == "bulk" else [])])
shutil.copy2(runtime_archive.with_suffix(".patch"), output / "runtime-source.patch")
for name in ["binary-to-decimal", "decimal-to-binary"]:
    decimal = work / "flang-src/lib/Decimal" / f"{name}.cpp"
    obj = build / f"{name}.o"
    if not obj.exists():
        run([emsdk / "bin/em++", "-O2", "-std=c++17", "-DFLANG_LITTLE_ENDIAN=1", "-I" + str(work / "flang-src/include"), "-c", decimal, "-o", obj])
    decimal_objects.append(obj)
link_flags = ["-O0", "--profiling-funcs", "-sASSERTIONS=2"] if args.debug else codegen_flags.split()
if args.profile and not args.debug:
    link_flags.append("--profiling-funcs")
# Binaryen 123 segfaults writing StackIR for the frontend -O2 module; every
# pass and validation before the write succeeds.
link_flags.append("-sBINARYEN_EXTRA_PASSES=--no-stack-ir")
if args.ranks > 1:
    link_flags += ["--js-library", script_directory / "library_shm.js"]
if args.app:
    link_flags += ["--js-library", script_directory / "library_gcm.js", "-sEXPORT_ES6=1", "-sENVIRONMENT=worker"]
def link(initial_memory_mib):
    command = [emsdk / "bin" / "emcc", "entry.c", *objects.split(), runtime_archive, *decimal_objects, *link_flags, "-Wl,--fatal-warnings", "-sALLOW_MEMORY_GROWTH=1", f"-sSTACK_SIZE={args.stack_mib * 1048576}", f"-sINITIAL_MEMORY={initial_memory_mib * 1048576}", "-sSTACK_OVERFLOW_CHECK=2", "-sMODULARIZE=1", "-sEXPORT_NAME=createExoPlaSim", "-sEXPORTED_RUNTIME_METHODS=['FS','callMain','HEAPU8']", "-sEXPORTED_FUNCTIONS=['_main','_emscripten_stack_get_base','_emscripten_stack_get_end','_sbrk']", "-sINVOKE_RUN=0", "-sEXIT_RUNTIME=1", "-sFORCE_FILESYSTEM=1", "--preload-file", f"{inputs}@/", "-o", output / "exoplasim.js"]
    print(" ".join(map(str, command)), flush=True)
    return subprocess.run(list(map(str, command)), env=env, capture_output=True, text=True)


linked = link(args.initial_memory_mib)
needed = re.search(r"initial memory too small, (\d+) bytes needed", linked.stderr)
if needed:
    args.initial_memory_mib = math.ceil(int(needed.group(1)) / 1048576) + 1
    print("Static data needs more initial memory; relinking with", args.initial_memory_mib, "MiB", flush=True)
    linked = link(args.initial_memory_mib)
print(linked.stdout + linked.stderr, flush=True)
linked.check_returncode()
# Emscripten names the preloaded package after its absolute output path;
# keep only the file name so builds do not publish the build machine's paths.
loader = output / "exoplasim.js"
loader.write_text(loader.read_text().replace(f"{output}/exoplasim.data", "exoplasim.data"))
print("Linked:", [(p.name, p.stat().st_size) for p in output.glob("exoplasim.*")], flush=True)
(output / "build.json").write_text(json.dumps({"variant": args.variant, "frontendOptimization": args.frontend_opt, "frontendO0Files": FRONTEND_O0_FILES, "assignment": args.assignment, "math": "wasm", "codegenFlags": codegen_flags, "profile": args.profile, "debug": args.debug, "precisionBytes": args.precision, "layers": 10, "grid": [2 * latitudes, latitudes], "truncation": args.truncation, "steps": args.steps, "ranks": args.ranks, "stackMiB": args.stack_mib, "initialMemoryMiB": args.initial_memory_mib, "app": args.app}, indent=2))
