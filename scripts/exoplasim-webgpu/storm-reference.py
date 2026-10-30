import argparse
import json
from pathlib import Path
import re
import subprocess


parser = argparse.ArgumentParser(description="Evaluate identical column fixtures with pinned native storm diagnostics")
parser.add_argument("fixtures", type=Path)
parser.add_argument("--source", type=Path, default=Path("/var/tmp/chaos-exoplasim-wasm/source/exoplasim/plasim/src/hurricanemod.f90"))
args = parser.parse_args()
fixtures = json.loads(args.fixtures.read_text())
output = args.fixtures.parent
source = args.source.read_text()
module = source[:source.index("      end module hurricanemod") + len("      end module hurricanemod")]
module = module.replace("      use resmod", "")
module = module.replace("      use pumamod, only: NHOR, NLEV, NLEP, NUGP", "      integer, parameter :: NHOR=1, NUGP=1, NLEV=LAYERS, NLEP=NLEV+1")
routines = source[source.index("      subroutine es_cc"):]
routines = routines.replace("     SSTK=SSTC+273.15", "     CAPEA=-1.0\n     LNBA=-1.0\n     SSTK=SSTC+273.15")
driver = """
program reference
use hurricanemod
implicit none
integer :: count, j
real :: sst, msl, omega, t(NLEV), r(NLEP), p(NLEV), sig(NLEV), z(NLEV), u(NLEV), v(NLEV)
real :: result(9), speeds(NLEV)
read(*,*) count
do j=1,count
 read(*,*) RD, omega, sst, msl
 EPS=RD/RVp
 read(*,*) sig
 read(*,*) t
 read(*,*) r
 read(*,*) u
 read(*,*) v
 read(*,*) z
 p=msl*sig
 speeds=sqrt(u*u+v*v)
 call POTI(sst-273.15,msl,p,t-273.15,r(1:NLEV),result(3),result(1),result(2))
 call entropy_deficit(t,r,p,sst,msl,result(4))
 call absvorticity(sig,z,omega,result(5))
 call getshear(speeds,sig,result(9))
 call ventilation(result(9),result(4),result(3),result(6))
 call vreducedvmax(result(6),result(7))
 call gpot(p,msl,t,result(5),result(3),r(1:NLEV),result(9),result(8))
 write(*,'(9(es25.16,1x))') result
enddo
end program reference
"""
report = []
for layers in [5, 10]:
    folder = output / f"native-l{layers}"
    folder.mkdir(parents=True, exist_ok=True)
    code = module.replace("LAYERS", str(layers)) + "\n" + routines + "\n" + driver
    (folder / "reference.f90").write_text(code)
    subprocess.run(["gfortran", "-O2", "-fdefault-real-8", "-fdefault-double-8", "-ffree-line-length-none", "reference.f90", "-o", "reference"], cwd=folder, check=True)
    selected = [row for row in fixtures if row["layers"] == layers]
    lines = [str(len(selected))]
    for row in selected:
        lines.append(" ".join(map(str, [row["rd"], row["omega"], row["sst"], row["msl"]])))
        lines.extend(" ".join(map(str, row[key])) for key in ["sigma", "t", "r", "u", "v", "z"])
    run = subprocess.run([str((folder / "reference").resolve())], input="\n".join(lines) + "\n", text=True, capture_output=True, check=True)
    values = [list(map(float, line.split())) for line in run.stdout.splitlines() if re.match(r"^\s*[-+0-9]", line) and len(line.split()) == 9]
    if len(values) != len(selected):
        raise RuntimeError(run.stdout + run.stderr)
    report.extend({**row, "expected": actual} for row, actual in zip(selected, values))
(output / "native.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
print(f"Native f64: {len(report)} column fixtures")
