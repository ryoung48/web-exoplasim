import json
import math
from pathlib import Path
import subprocess
import tempfile


root = Path(__file__).resolve().parents[2]
hook = root / "scripts/exoplasim-wasm/gcm_publish.f90"
fixture = """
module pumamod
implicit none
integer, parameter :: NHOR=3,NUGP=3,NLEV=10,NLEP=11,NROOT=0
integer :: mypid=0,nstep=48,nshutdown=0,nveg=0,ntspd=4
integer :: ndatim(5)=[1,1,2,0,0]
real :: dt(NHOR,NLEP)=280.,du(NHOR,NLEP)=0.,dv(NHOR,NLEP)=0.
real :: dq(NHOR,NLEP)=0.,dcc(NHOR,NLEP)=0.,sigma(NLEV)
real :: tempmin(NHOR)=250.,tempmax(NHOR)=290.
real :: dtsa(NHOR)=284.,dprc(NHOR)=0.,dprl(NHOR)=0.,dp(NHOR)=100000.
real :: dqvi(NHOR)=0.,dicec(NHOR)=0.,dsnow(NHOR)=0.,dwatc(NHOR)=0.
real :: dalb(NHOR)=0.,dls(NHOR)=1.,dsmelt(NHOR)=0.,dprs(NHOR)=0.
real :: devap(NHOR)=0.,drunoff(NHOR)=0.,dforest(NHOR)=0.,diced(NHOR)=0.
real :: dglac(NHOR)=0.,dshfl(NHOR)=0.,dlhfl(NHOR)=0.
real :: dlwfl(NHOR,NLEP)=0.,dswfl(NHOR,NLEP)=0.
real :: capen(NHOR)=11.,lnb(NHOR)=22.,mpoti(NHOR)=33.,chim(NHOR)=44.
real :: laav(NHOR)=55.,venti(NHOR)=66.,vrmpi(NHOR)=77.,gpi(NHOR)=88.
real :: ga=9.80665,gascon=287.,akap=2./7.,rdbrv=0.622
real :: ra1=610.78,ra2=17.269,ra4=35.86,TMELT=273.16
end module
module landmod
use pumamod
real :: doro(NHOR)=0.
end module
module hurricanemod
use pumamod, only: NHOR
real :: shear(NHOR)=99.
end module
module vegmod
real, allocatable :: dlai(:),dnpp(:)
end module
module radmod
use pumamod, only: NHOR
real :: gmu0(NHOR)=[0.,0.5,1.]
end module
subroutine mpbci(values)
integer :: values(*)
if (values(1)<0) stop 1
end subroutine
subroutine mpgagp(global,local,count)
use pumamod
integer :: count
real :: global(NUGP,count),local(NHOR,count)
global=local
end subroutine
integer(c_int) function gcm_should_publish(step) bind(c)
use iso_c_binding
integer(c_int),value :: step
gcm_should_publish=0
if (step>=0) gcm_should_publish=1
if (step>=50 .and. step<=55) gcm_should_publish=0
end function
integer(c_int) function gcm_should_stop() bind(c)
use iso_c_binding
gcm_should_stop=0
end function
subroutine gcm_publish(fields,count,points,bytes,step,date) bind(c)
use iso_c_binding
integer(c_int),value :: count,points,bytes,step
integer(c_int) :: date(5)
real(c_double) :: fields(points,count)
integer :: point
if (step<48 .or. any(date<0)) stop 2
if (step==48) then
open(97,file='fields.txt',status='replace')
else if (step==49) then
open(97,file='reset.txt',status='replace')
else if (step==56) then
open(97,file='daily.txt',status='replace')
else if (step==57) then
open(97,file='held.txt',status='replace')
else
return
endif
write(97,*) count,points,bytes
do point=1,points
write(97,'(*(es25.16,1x))') fields(point,:)
enddo
close(97)
end subroutine
program weather
use pumamod
use landmod, only: doro
use vegmod, only: dnpp
integer :: level
do level=1,NLEV
sigma(level)=(real(level)-0.5)/real(NLEV)
dcc(:,level)=0.07*level
enddo
dt(:,NLEV)=[280.,250.,300.]
du(:,NLEV)=[3.,6.,0.]
dv(:,NLEV)=[4.,8.,0.]
dp=[100000.,85000.,101000.]
doro=[0.,1000.*ga,-100.*ga]
dswfl(:,NLEP)=[100.,200.,300.]
dlwfl(:,NLEP)=[-50.,-70.,-90.]
dshfl=[-10.,20.,-30.]
dlhfl=[-100.,-150.,10.]
dprc=[1.,2.,3.]/86400000.
dprl=[4.,5.,6.]/86400000.
dswfl(:,1)=[900.,800.,700.]
dlwfl(:,1)=[-200.,-250.,-300.]
nstep=48
call gcm_publish_step
tempmin=260.
call gcm_capture_window
allocate(dnpp(NHOR))
dnpp=[1.,2.,3.]*1.e-8
nveg=1
nstep=49
call gcm_publish_step
nstep=52
tempmin=270.
tempmax=280.
call gcm_capture_window
call gcm_publish_step
nstep=54
tempmin=265.
tempmax=285.
call gcm_capture_window
call gcm_publish_step
nstep=56
call gcm_publish_step
nstep=57
call gcm_publish_step
end program
"""

for layers in [10, 5]:
    with tempfile.TemporaryDirectory(prefix="exoplasim-weather-") as directory:
        work = Path(directory)
        (work / "fixture.f90").write_text(fixture.replace("NLEV=10,NLEP=11", f"NLEV={layers},NLEP={layers+1}"))
        subprocess.run(["gfortran", "-fdefault-real-8", "-fdefault-double-8", "fixture.f90", str(hook), "-o", "weather"], cwd=work, check=True)
        subprocess.run([str(work / "weather")], cwd=work, check=True)
        lines = (work / "fields.txt").read_text().splitlines()
        assert list(map(int, lines[0].split())) == [51 + 5 * layers, 3, 8]
        fields = [list(map(float, line.split())) for line in lines[1:]]
        reset = [list(map(float, line.split())) for line in (work / "reset.txt").read_text().splitlines()[1:]]
        assert all(row[35:37] == [250, 290] for row in fields)
        assert all(row[35:37] == [260, 290] for row in reset)
        assert all(row[40] == 0 for row in fields)
        for point in range(3):
            assert math.isclose(reset[point][40], (point + 1) * 1e-8, rel_tol=1e-14)
            assert fields[point][41] == point * 0.5
        daily = [list(map(float, line.split())) for line in (work / "daily.txt").read_text().splitlines()[1:]]
        held = [list(map(float, line.split())) for line in (work / "held.txt").read_text().splitlines()[1:]]
        assert all(row[37:40] == [20, 30, 2] for row in daily)
        assert all(row[37:40] == [20, 0, 0] for row in held)
        assert all(row[37:40] == [40, 0, 0] for row in fields)

    assert all(len(row) == 51 + 5 * layers and all(math.isfinite(value) for value in row) for row in fields)
    assert all(row[42:51] == [11, 22, 33, 44, 55, 66, 77, 88, 99] for row in fields)
    pressure_errors = []
    for point, (temperature, pressure, elevation) in enumerate([
        (280, 100000, 0),
        (250, 85000, 1000),
        (300, 101000, -100),
    ]):
        tstar = (1 + 287 * 0.0065 / 9.80665 * (1 / ((layers - 0.5) / layers) - 1)) * temperature
        if tstar < 255:
            tstar = (255 + tstar) / 2
        exact_hydrostatic = pressure * (1 + 0.0065 * elevation / tstar) ** (9.80665 / (287 * 0.0065))
        error = abs(fields[point][26] - exact_hydrostatic)
        assert error < 1, (point, error)
        pressure_errors.append(error)
        for level in range(layers):
            assert math.isclose(fields[point][55 + 5 * level], 0.07 * (level + 1), abs_tol=1e-14)

    for point, expected in enumerate([(100, -50, -10, -100), (200, -70, 20, -150), (300, -90, -30, 10)]):
        assert fields[point][27:31] == list(expected)
        assert fields[point][17] == sum(expected)

    for point in range(3):
        assert math.isclose(fields[point][31] * 86400000, point + 1, abs_tol=1e-14)
        assert math.isclose(fields[point][32] * 86400000, point + 4, abs_tol=1e-14)
        assert math.isclose(fields[point][5], fields[point][31] + fields[point][32], abs_tol=1e-20)
        assert fields[point][33] == 900 - point * 100
        assert fields[point][34] == -200 - point * 50
        assert fields[point][16] == sum(fields[point][33:35])
        assert fields[point][14] == -fields[point][34]

    assert fields[0][26] == 100000
    assert fields[1][26] > 85000 and fields[2][26] < 101000
    report = {"fields": 51 + 5 * layers, "layers": layers, "points": 3, "pressureErrorPaAgainstExactLapseIntegral": pressure_errors, "zeroOrographyPressureUnchanged": True, "cloudLayers": layers, "surfaceEnergyComponents": 4, "dailyRangesAcrossUnpublishedSteps": True, "nativeWindowExtrema": True, "energySignsAndSum": True, "precipitationAndToaComponents": True, "vegetationNppEnabledAndDisabled": True, "solarZenithCosine": True}
    output = root / f"stats/exoplasim-model-options/weather-formulas-layers-{layers}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
