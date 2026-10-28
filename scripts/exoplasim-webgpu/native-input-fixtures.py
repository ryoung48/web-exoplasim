import argparse
import json
from pathlib import Path
import re
import subprocess


parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, default=Path("/var/tmp/chaos-exoplasim-wasm/source/exoplasim/plasim/src"))
parser.add_argument("--output", type=Path, default=Path("stats/gpu-inputs"))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def routine(text, name):
    found = re.search(rf"(?ims)^\s*subroutine {name}\b.*?^\s*end subroutine {name}\b[^\n]*", text)
    if not found:
        raise RuntimeError(name)
    return found.group()


def execute(name, source, rows):
    program = args.output / f"{name}.f90"
    executable = args.output / name
    program.write_text(source)
    subprocess.run(["gfortran", "-O2", "-ffree-line-length-none", "-fdefault-real-8", "-fdefault-double-8", "-J", str(args.output), "-o", str(executable), str(program)], check=True)
    result = subprocess.run([str(executable.resolve())], input="".join(" ".join(map(str, row)) + "\n" for row in rows), capture_output=True, text=True, check=True)
    return [[float(value.replace("D", "E")) for value in line.split()] for line in result.stdout.splitlines()]


calendar_rows = []
for days in [360, 365, 720]:
    for year in [0, 1, 4, 100, 400, 1900, 2000, 2100]:
        for month in [1, 2, 3, 12]:
            for offset in [0, 1, 31, 32 * 27, 32 * 28, 32 * 29, 32 * 31]:
                calendar_rows.append([days, 32, year, month, offset])
calendar_source = (args.source / "calmod.f90").read_text() + """
program fixtures
use calmod
implicit none
integer :: days, steps, year, month, offset, base, at, stamp(7), a, b, status
real :: weight
do
 read(*,*,iostat=status) days,steps,year,month,offset
 if(status /= 0) exit
 n_days_per_year=days
 n_days_per_month=days/12
 ntspd=steps
 mtspd=days*steps/360
 mpstep=1440.0/steps
 solar_day=86400.0
 tcalday=mtspd*mpstep*60.0
 call cal2step(base,steps,year,month,1,0,0)
 at=base+offset
 if(days==365) then
  call step2cal(at,steps,stamp)
 else
  call step2cal30(at,stamp)
 endif
 call momint(0,at,a,b,weight)
 write(*,*) base,stamp(1:5),a,b,weight
enddo
end program
"""
calendar_results = execute("calendar-reference", calendar_source, calendar_rows)

radmod = (args.source / "radmod.f90").read_text()
solar_source = """
module pumamod
integer :: mcal_days_per_year=360,ndatim(7)=0
end module
module radmod
use pumamod
integer,parameter :: NLON=8,NLPP=3
real,parameter :: PI=3.14159265359,TWOPI=PI+PI
integer :: nstep,ntspd,n_steps_per_year,nfixed,ngenkeplerian
integer :: nperpetual=0,m_days_per_year=360,mypid=0,NROOT=0,ncstsol=0,ndcycle=1
real :: eccen,obliqr,mvelpp,meananom0r,lambm0,mpstep,rotspd,fixedlon
real :: slowdown=1.,desync=0.,dawn=0.
real :: sid(NLPP)=[-0.7,0.,0.7],cola(NLPP),gmu0(NLON*NLPP)
real :: zcdayf,zdeclf,orbnu,lambm,rasc,gdist2
end module
subroutine ntomin(step,minute,hour,day,month,year)
integer :: step,minute,hour,day,month,year
minute=0
hour=0
day=1
month=1
year=1
end subroutine
integer function ndayofyear(step)
integer :: step
ndayofyear=1
end function
subroutine mpbcr(value)
real :: value
end subroutine
""" + "\n".join(routine(radmod, name) for name in ["solang", "gen_orb_decl", "newtonraphson", "orb_decl"]) + """
program fixtures
use radmod
implicit none
integer :: status
real :: obliq,mvelp,mean0,e2,e3,beta,degrad,phase,decl
cola=sqrt(1.-sid*sid)
degrad=4.*atan(1.)/180.
do
 read(*,*,iostat=status) eccen,obliq,mvelp,mean0,ngenkeplerian,nfixed,fixedlon,nstep,ntspd,n_steps_per_year,mpstep,rotspd
 if(status /= 0) exit
 obliqr=obliq*degrad
 mvelpp=(mvelp+180.)*degrad
 meananom0r=mean0*degrad
 e2=eccen*eccen
 e3=e2*eccen
 beta=sqrt(1.-e2)
 lambm0=2.*((0.5*eccen+0.125*e3)*(1.+beta)*sin(mvelpp)-0.25*e2*(0.5+beta)*sin(2.*mvelpp)+0.125*e3*(1./3.+beta)*sin(3.*mvelpp))
 call solang
 phase=real(int(mod(nstep,ntspd)*mpstep))*rotspd*TWOPI/1440.
 decl=zdeclf
 if(nfixed==1) then
  phase=(1.-fixedlon/360.)*TWOPI
  decl=obliqr
 endif
 if(ngenkeplerian==1) phase=phase-rasc
 write(*,*) zcdayf,zdeclf,gdist2,orbnu,lambm,rasc,sin(decl),cos(decl),phase,gdist2,cos(TWOPI*(zcdayf-0.25)),gmu0
enddo
end program
"""
solar_rows = []
for keplerian, fixed in [(0, 0), (0, 1), (1, 0), (1, 1)]:
    for eccentricity in ([0, 0.016715, 0.7, 0.95] if keplerian else [0, 0.016715, 0.3]):
        for phase in [-360, -2.9589, 0, 90, 360]:
            for at in [0, 1, 2880, 5759, 11519]:
                solar_rows.append([eccentricity, 23.5, 45, phase, keplerian, fixed, 90, at, 32, 11520, 45, 1])
solar_results = execute("solar-reference", solar_source, solar_rows)

glacier = (args.source / "glaciermod.f90").read_text()
initial = glacier[glacier.index("        if (icesheeth .ge. 0.0) then"):glacier.index("        call mpgagp(zsnow,dsnowz,1)")]
glacier_source = """
program fixtures
implicit none
integer,parameter :: NHOR=5
real :: groundoro(NHOR)=[0.,9806.65,-100.,1.e-12,19613.3]
real :: dsnowz(NHOR),dglac(NHOR),icesheeth,glacelim=2.
integer :: jhor,status
do
 read(*,*,iostat=status) icesheeth
 if(status/=0) exit
 dsnowz=[0.,0.,0.,3.,0.]
 dglac=[0.,1.,0.,1.,1.]
""" + initial + """
write(*,*) dglac,dsnowz
enddo
end program
"""
glacier_rows = [[height] for height in [-1, 0, 2, 100]]
glacier_results = execute("glacier-reference", glacier_source, glacier_rows)
payload = {
    "calendar": [{"input": row, "expected": result} for row, result in zip(calendar_rows, calendar_results, strict=True)],
    "solar": [{"input": row, "expected": result} for row, result in zip(solar_rows, solar_results, strict=True)],
    "glacier": [{"height": row[0], "expected": result} for row, result in zip(glacier_rows, glacier_results, strict=True)],
}
(args.output / "native.json").write_text(json.dumps(payload))
print(json.dumps({name: len(rows) for name, rows in payload.items()}))
