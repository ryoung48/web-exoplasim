import os
from pathlib import Path
import re
import subprocess
import sys


work = Path(os.environ["EXOPLASIM_WORK"])
arguments = [arg for arg in sys.argv[1:] if arg not in ["-c", "-O2"]]
source = next(Path(arg) for arg in arguments if arg.endswith(".f90"))
ir = source.with_suffix(".ll")
subprocess.run([str(work / "toolchain/bin/flang-new"), *arguments, "-O0", "-S", "-emit-llvm", "-o", str(ir)], check=True)
text = ir.read_text()
truncated = {}
lines = []
count = 0
for line in text.splitlines():
    if line.startswith("define "):
        truncated = {}
    truncation = re.search(r"(%[\w.]+) = trunc i64 (%[\w.]+) to i32", line)
    if truncation:
        truncated[truncation.group(1)] = truncation.group(2)
    if "declare " in line and any(name in line for name in ["@_FortranAioInquireLogical(", "@_FortranAioOutputInteger64("]):
        line = line.replace("(ptr, i32", "(ptr, i64", 1)
    elif "call " in line and any(name in line for name in ["@_FortranAioInquireLogical(", "@_FortranAioOutputInteger64("]):
        match = re.search(r"(@_FortranAio\w+\(ptr [^,]+, )i32 ([^,)]+)", line)
        if not match:
            raise RuntimeError("Unexpected runtime call: " + line)
        value = match.group(2)
        if value in truncated:
            value = truncated[value]
        elif value.startswith("%"):
            if "OutputInteger64" in line:
                raise RuntimeError("Cannot recover the full 64-bit output value: " + line)
            extended = f"%wasmabi{count}"
            count += 1
            operation = "zext" if "InquireLogical" in line else "sext"
            lines.append(f"  {extended} = {operation} i32 {value} to i64")
            value = extended
        line = line[:match.start()] + match.group(1) + "i64 " + value + line[match.end():]
    returning = next((name for name in ["_FortranASystemClockCount", "_FortranACount"] if f"@{name}(" in line), None)
    if returning:
        if "declare " in line:
            line = line.replace(f"i32 @{returning}", f"i64 @{returning}")
        else:
            match = re.match(r"(\s*)(%[\w.]+) = (?:tail )?call i32 (.*)", line)
            if not match:
                raise RuntimeError("Unexpected clock call: " + line)
            temporary = f"%wasmabi{count}"
            count += 1
            lines.append(f"{match.group(1)}{temporary} = call i64 {match.group(3)}")
            line = f"{match.group(1)}{match.group(2)} = trunc i64 {temporary} to i32"
    lines.append(line)
ir.write_text("\n".join(lines) + "\n")
codegen_flags = os.environ.get("EXOPLASIM_CODEGEN_FLAGS", "-O2").split()
if "-msimd128" in codegen_flags:
    codegen_flags.append("-Rpass=loop-vectorize")
subprocess.run([str(work / "toolchain/bin/clang"), "--target=wasm32-unknown-emscripten", *codegen_flags, "-c", str(ir), "-o", str(source.with_suffix(".o"))], check=True)
