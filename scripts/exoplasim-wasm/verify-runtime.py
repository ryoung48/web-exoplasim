import os
from pathlib import Path
import subprocess
import sys


work = Path(os.environ.get("EXOPLASIM_WORK", "/var/tmp/chaos-exoplasim-wasm"))
scripts = Path(__file__).resolve().parent
build = work / "runtime-check"
build.mkdir(exist_ok=True)
env = os.environ | {"EXOPLASIM_WORK": str(work), "EXOPLASIM_CODEGEN_FLAGS": "-O2", "PATH": f"{work / 'emsdk/bin'}:{os.environ['PATH']}", "EM_CACHE": str(work / "em-cache"), "EM_BINARYEN_ROOT": str(work / "binaryen-version_123")}
os.chdir(build)
source = build / "runtime-check.f90"
source.write_text((scripts / "runtime-check.f90").read_text())
subprocess.run([sys.executable, str(scripts / "compile.py"), "-c", "--target=wasm32-unknown-emscripten", str(source)], env=env, check=True)
for kind in ["matched", "fastfill"]:
    executable = build / f"check-{kind}.cjs"
    subprocess.run([str(work / "emsdk/bin/emcc"), str(work / "build/entry.c"), str(source.with_suffix(".o")), str(work / f"wasm-runtime/lib/libFortranRuntime-{kind}.a"), str(work / "build/binary-to-decimal.o"), str(work / "build/decimal-to-binary.o"), "-O2", "-Wl,--fatal-warnings", "-sEXIT_RUNTIME=1", "-sENVIRONMENT=node", "-o", str(executable)], env=env, check=True)
    result = subprocess.run([str(work / "emsdk/bin/node"), str(executable)], env=env, check=True, capture_output=True, text=True)
    if "runtime assignment checks passed" not in result.stdout:
        raise RuntimeError(result.stdout + result.stderr)
    print(kind + ": " + result.stdout.strip(), flush=True)
