from concurrent.futures import ThreadPoolExecutor
import argparse
import difflib
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tarfile


parser = argparse.ArgumentParser()
parser.add_argument("--fast-fill", action="store_true")
args = parser.parse_args()
work = Path(os.environ.get("EXOPLASIM_WORK", "/var/tmp/chaos-exoplasim-wasm"))
source = work / "flang-src"
header = source / "include/flang/ISO_Fortran_binding.h"
text = header.read_text().replace("typedef ptrdiff_t CFI_index_t;", "typedef long long CFI_index_t;").replace("size_t elem_len;", "unsigned long long elem_len;")
if header.read_text() != text:
    header.write_text(text)
runtime = source / "runtime"
config = runtime / "config.h"
config_text = "#define HAVE_STRERROR_R 1\n#define HAVE_DECL_STRERROR_S 0\n"
if not config.exists() or config.read_text() != config_text:
    config.write_text(config_text)
objects = work / "runtime-objects"
objects.mkdir(exist_ok=True)
layout_digest = hashlib.sha256(header.read_bytes() + config.read_bytes()).hexdigest()
layout_stamp = objects / "layout.sha256"
layout_changed = layout_stamp.exists() and layout_stamp.read_text() != layout_digest
assignment_source = objects / "assign-fast.cpp"
if args.fast_fill:
    assignment = (runtime / "assign.cpp").read_text()
    assignment = assignment.replace('#include "flang/Runtime/assign.h"', '#include "flang/Runtime/assign.h"\n#include <algorithm>')
    assignment = assignment.replace("    if (isSimpleMemmove()) {", """    if (from.rank() == 0 && to.IsContiguous() && to.type().IsReal() &&
        from.type().IsReal() && toElementBytes == sizeof(double) &&
        fromElementBytes == sizeof(double)) {
      const double value{*from.OffsetElement<const double>()};
      std::fill_n(to.OffsetElement<double>(), toElements, value);
    } else if (from.rank() == 0 && to.IsContiguous() && to.type().IsReal() &&
        from.type().IsReal() && toElementBytes == sizeof(float) &&
        fromElementBytes == sizeof(float)) {
      const float value{*from.OffsetElement<const float>()};
      std::fill_n(to.OffsetElement<float>(), toElements, value);
    } else if (isSimpleMemmove()) {""")
    if not assignment_source.exists() or assignment_source.read_text() != assignment:
        assignment_source.write_text(assignment)
env = os.environ | {"PATH": f"{work / 'emsdk/bin'}:{os.environ['PATH']}", "EM_CACHE": str(work / "em-cache"), "EM_BINARYEN_ROOT": str(work / "binaryen-version_123")}
names = re.search(r"set\(sources\s+(.*?)\n\)", (runtime / "CMakeLists.txt").read_text(), re.S).group(1).split()
names = [name for name in names if name.endswith((".cpp", ".c"))]


def compile_source(name):
    fast = args.fast_fill and name == "assign.cpp"
    obj = objects / ("assign-fast.cpp.o" if fast else f"{name}.o")
    input_source = assignment_source if fast else runtime / name
    if obj.exists() and obj.stat().st_mtime >= input_source.stat().st_mtime and not layout_changed:
        return obj
    print("Runtime:", name, flush=True)
    compiler = work / "emsdk/bin" / ("emcc" if name.endswith(".c") else "em++")
    standard = "-std=c11" if name.endswith(".c") else "-std=c++17"
    subprocess.run([str(compiler), "-O3" if fast else "-O2", standard, "-Wno-c++11-narrowing", "-DFLANG_LITTLE_ENDIAN=1", "-DFE_INVALID=1", "-DFE_DIVBYZERO=4", "-DFE_OVERFLOW=8", "-DFE_UNDERFLOW=16", "-DFE_INEXACT=32", "-I" + str(source / "include"), "-I" + str(runtime), "-c", str(input_source), "-o", str(obj)], env=env, check=True)
    return obj


with ThreadPoolExecutor(max_workers=4) as executor:
    compiled = list(executor.map(compile_source, names))
archive = work / "wasm-runtime/lib" / ("libFortranRuntime-fastfill.a" if args.fast_fill else "libFortranRuntime-matched.a")
subprocess.run([str(work / "emsdk/bin/emar"), "rcs", str(archive), *map(str, compiled)], env=env, check=True)
layout_stamp.write_text(layout_digest)
with tarfile.open(work / "flang.src.tar.xz") as original_archive:
    member = next(name for name in original_archive.getnames() if name.endswith("/include/flang/ISO_Fortran_binding.h"))
    original_header = original_archive.extractfile(member).read().decode()
patch = list(difflib.unified_diff(original_header.splitlines(keepends=True), header.read_text().splitlines(keepends=True), fromfile="a/flang/include/flang/ISO_Fortran_binding.h", tofile="b/flang/include/flang/ISO_Fortran_binding.h"))
if args.fast_fill:
    patch.extend(difflib.unified_diff((runtime / "assign.cpp").read_text().splitlines(keepends=True), assignment_source.read_text().splitlines(keepends=True), fromfile="a/flang/runtime/assign.cpp", tofile="b/flang/runtime/assign.cpp"))
archive.with_suffix(".patch").write_text("".join(patch))
print("Built", archive, flush=True)
