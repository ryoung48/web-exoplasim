import argparse
import array
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import time

from model_source import ModelSource, copy_sources, object_names, patch_sources
from probe_source import module_variables, state_dump_source, state_load_source


parser = argparse.ArgumentParser(description="Native gfortran ExoPlaSim references for the WebGPU port")
parser.add_argument("--work", type=Path, default=Path("/var/tmp/chaos-exoplasim-wasm"))
commands = parser.add_subparsers(dest="command", required=True)
build_parser = commands.add_parser("build")
build_parser.add_argument("--truncation", type=int, choices=[21, 42], default=21)
build_parser.add_argument("--ranks", type=int, choices=[1, 2, 4, 8], default=8)
build_parser.add_argument("--precision", type=int, choices=[4, 8], default=8)
build_parser.add_argument("--demote-double", action="store_true", help="also demote explicit real(kind=8), leaving no f64 (-freal-8-real-4)")
build_parser.add_argument("--coverage", action="store_true")
build_parser.add_argument("--probe", action="store_true", help="dump transform tables and FFT matrices after legini (serial only)")
run_parser = commands.add_parser("run")
run_parser.add_argument("--build", type=Path, required=True)
run_parser.add_argument("--inputs", type=Path, required=True)
run_parser.add_argument("--output", type=Path, required=True)
length = run_parser.add_mutually_exclusive_group(required=True)
length.add_argument("--years", type=int)
length.add_argument("--steps", type=int)
run_parser.add_argument("--restart", type=Path, help="plasim_status from an earlier run")
run_parser.add_argument("--probe-steps", type=int, nargs="+", default=[], help="steps at which a --probe build dumps its state")
run_parser.add_argument("--replay", type=Path, help="directory of another run's probe dumps to restart each routine from")
args = parser.parse_args()
script_directory = Path(__file__).resolve().parent
work = args.work.resolve()


def run(command):
    print(" ".join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True)


def build_reference():
    latitudes = {21: 32, 42: 64}[args.truncation]
    if args.demote_double and args.precision != 4:
        parser.error("--demote-double needs --precision 4")
    if args.probe and args.ranks != 1:
        parser.error("--probe needs --ranks 1, so dumped arrays are global")
    name = f"reference-t{args.truncation}-r{args.ranks}-p{args.precision}" + ("-demoted" if args.demote_double else "") + ("-coverage" if args.coverage else "") + ("-probe" if args.probe else "")
    build = work / name
    model = ModelSource(source=work / "source" / "exoplasim", build=build, output=build, latitudes=latitudes, ranks=args.ranks,
                        main_suffix=(script_directory / "gcm_reference.f90").read_text() + ((script_directory / "gcm_probe.f90").read_text() if args.probe else ""), step_hook="gcm_reference_step",
                        mpi_module="mpimod" if args.ranks > 1 else "mpimod_stub", utility_module="utilities" if args.ranks > 1 else "utilities_stub")
    copy_sources(model)
    if args.demote_double:
        for file, old in [("mpimod.f90", "call mpi_scatter(p,n,MPI_REAL8,p,n,MPI_REAL8,"), ("utilities.f90", "call mpi_gather(pp,n,MPI_REAL8,&")]:
            path = build / file
            text = path.read_text()
            if text.count(old) != 1:
                raise RuntimeError(f"Expected one {old} in {file}")
            text = text.replace(old, old.replace("MPI_REAL8", "MPI_REAL4"))
            if file == "utilities.f90":
                text = re.sub(r"(&\s*pf,n,)MPI_REAL8", r"\1MPI_REAL4", text, count=1)
            path.write_text(text)
    patch_sources(model)
    if args.probe:
        main = (build / "plasim.f90").read_text()
        newline = chr(10)
        # Main-loop calls only; the nkits start-up steps call the same
        # routines with other neighbours.
        hooks = [
            ("      call legini" + newline, "      call legini" + newline + "      call gcm_probe_tables" + newline),
            ("         call initpm ", "         call gcm_probe_init('initpm-in')" + newline + "         call initpm "),
            ("         call initsi                ! Initialize semi implicit scheme" + newline, "         call initsi                ! Initialize semi implicit scheme" + newline + "         call gcm_probe_init('initsi-out')" + newline),
            ("         call gridpointa" + newline + newline, "         call gcm_probe_state('a0')" + newline + "         call gridpointa" + newline + "         call gcm_probe_state('a1')" + newline + newline),
            ("         call spectrala" + newline + newline, "         call spectrala" + newline + "         call gcm_probe_state('a2')" + newline + newline),
            ("         call gridpointd" + newline + newline, "         call gridpointd" + newline + "         call gcm_probe_state('a3')" + newline + newline),
            ("         call spectrald" + newline + "         call outaccu", "         call spectrald" + newline + "         call gcm_probe_state('a4')" + newline + "         call outaccu"),
        ]
        for anchor, replacement in hooks:
            if main.count(anchor) != 1:
                raise RuntimeError(f"Expected one probe anchor: {anchor.strip()}")
            main = main.replace(anchor, replacement)
        variables = module_variables((build / "plasimmod.f90").read_text(), "pumamod")
        main += state_dump_source(variables) + state_load_source(variables)
        (build / "plasim.f90").write_text(main)
    precision = {8: "-fdefault-real-8 -fdefault-double-8", 4: "-freal-8-real-4" if args.demote_double else ""}[args.precision]
    optimization = "-O0 --coverage" if args.coverage else "-O2"
    (build / "Makefile").write_text(
        f"MOST_F90=mpif90\nMOST_F90_OPTS=-cpp {optimization} -march=x86-64 -fallow-argument-mismatch -w\nMOST_PREC={precision}\n"
        f"MOST_CC=/usr/bin/gcc\nMOST_CC_OPTS=-O2\nMPIMOD={model.mpi_module}\nGUIMOD=guimod_stub\nPUMAX=pumax_stub\nUTILMOD={model.utility_module}\n"
        + (build / "make_plasim").read_text()
        + "\naerocore.o: aeromod.o\n"
    )
    objects = object_names(model).split()
    for stale in build.glob("*.gcda"):
        stale.unlink()
    started = time.perf_counter()
    make_env = {"PATH": "/usr/bin:/bin", "OCEANCOUP": "cpl_stub"}
    # make_plasim omits some module dependencies (plasim.o needs radmod.mod),
    # so a parallel pass can fail; the serial pass finishes what is left.
    subprocess.run(["make", "-e", "-k", "-j8", *objects], cwd=build, env=make_env)
    subprocess.run(["make", "-e", *objects], cwd=build, check=True, env=make_env)
    run(["mpif90", *optimization.split(), "-o", build / "exoplasim", *[build / o for o in objects]])
    (build / "reference.json").write_text(json.dumps({"truncation": args.truncation, "latitudes": latitudes, "ranks": args.ranks, "precisionBytes": args.precision,
                                                     "demoteDouble": args.demote_double, "coverage": args.coverage, "probe": args.probe, "flags": f"-cpp {optimization} {precision}".strip(),
                                                     "compiler": subprocess.run(["gfortran", "--version"], capture_output=True, text=True).stdout.splitlines()[0],
                                                     "compileSeconds": time.perf_counter() - started}, indent=2))
    print(build)


def set_namelist(path: Path, values: dict):
    text = path.read_text()
    for key, value in values.items():
        line = f" {key} = {value}"
        pattern = rf"(?im)^\s*{key}\s*=.*$"
        text = re.sub(pattern, line, text) if re.search(pattern, text) else re.sub(r"(?im)^\s*/END", line + "\n /END", text, count=1)
    path.write_text(text)


def run_reference():
    reference = json.loads((args.build / "reference.json").read_text())
    output = args.output.resolve()
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(args.inputs, output)
    set_namelist(output / "plasim_namelist", {"N_RUN_YEARS": args.years or 0, "N_RUN_MONTHS": 0, "N_RUN_DAYS": 0, "N_RUN_STEPS": args.steps or 0, "NDIAG": 1000000})
    if args.restart:
        shutil.copy2(args.restart, output / "plasim_restart")
    if args.probe_steps:
        (output / "probe-steps.txt").write_text("".join(f"{step}\n" for step in args.probe_steps))
    if args.replay:
        # Each routine starts from the other run's state just before it; the
        # last point is only an output.
        for dump in args.replay.glob("probe-*-a[0-3].bin"):
            source_bytes = int((dump.with_suffix(".txt")).read_text().split("\n", 1)[0].split()[1])
            values = array.array({8: "d", 4: "f"}[source_bytes], dump.read_bytes())
            # Round once to the target build's default real; out-of-range
            # values become infinities, as a Fortran conversion would.
            converted = array.array({8: "d", 4: "f"}[reference["precisionBytes"]],
                                    [value if not abs(value) > 3.4028234663852886e38 or reference["precisionBytes"] == 8 else math.copysign(math.inf, value) for value in values])
            (output / dump.name.replace("probe-", "replay-", 1)).write_bytes(converted.tobytes())
    started = time.perf_counter()
    command = f"ulimit -s unlimited && exec mpirun --oversubscribe -np {reference['ranks']} {args.build / 'exoplasim'}" if reference["ranks"] > 1 else f"ulimit -s unlimited && exec {args.build / 'exoplasim'}"
    with (output / "console.txt").open("w") as console:
        result = subprocess.run(["bash", "-c", command], cwd=output, stdout=console, stderr=subprocess.STDOUT)
    (output / "run.json").write_text(json.dumps({**reference, "build": str(args.build), "inputs": str(args.inputs), "years": args.years, "steps": args.steps,
                                                 "restart": str(args.restart) if args.restart else None, "exitCode": result.returncode,
                                                 "elapsedSeconds": time.perf_counter() - started}, indent=2))
    result.check_returncode()


{"build": build_reference, "run": run_reference}[args.command]()
