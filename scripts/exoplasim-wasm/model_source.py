import difflib
from dataclasses import dataclass
from pathlib import Path
import re
import shutil


@dataclass
class ModelSource:
    source: Path
    build: Path
    output: Path
    latitudes: int
    layers: int
    ranks: int
    main_suffix: str
    step_hook: str
    mpi_module: str
    utility_module: str


CACHED_RADIATION = ["dfu", "dfd", "dftu", "dftd", "dswfl", "dlwfl", "dflux", "dtdtswr", "dtdtlwr", "dconv", "dalb", "dsalb", "dftue1", "dftue2", "dftu0", "dftd0"]
STEP_END = "         call stability_check ! aborts if model tends to explode"
WASM_FIELDS = """
      subroutine wasm_fields
      use pumamod
      integer i
      open(97,file='wasm-fields.txt',status='replace')
      write(97,*) nstep,NLON,NLAT,NLEV
      do i=1,NHOR
         write(97,'(6(es25.16,1x))') dt(i,NLEP),dtsa(i), &
     &      du(i,NLEV),dv(i,NLEV),dp(i),dq(i,NLEV)
      enddo
      close(97)
      end subroutine wasm_fields
"""


def copy_sources(model: ModelSource):
    model.build.mkdir(parents=True, exist_ok=True)
    for file in (model.source / "plasim" / "src").glob("*"):
        if file.is_file():
            shutil.copy2(file, model.build / file.name)


def radiation_interval(text: str) -> str:
    edits = [
        ("      integer :: nswr    = 1      ! switch for swr (1/0=yes/no)\n",
         "      integer :: nswr    = 1      ! switch for swr (1/0=yes/no)\n"
         "      integer :: nradint = 1      ! compute radiation every nradint steps\n"
         + "".join(f"      real, allocatable :: rc_{name}(:,:)\n" for name in CACHED_RADIATION if name not in ["dalb"])
         + "      real, allocatable :: rc_dalb(:)\n      real, allocatable :: rc_dtdt(:,:)\n"),
        ("      namelist/radmod_nl/ndcycle,", "      namelist/radmod_nl/nradint,ndcycle,"),
        ("      call mpbci(nswr)\n", "      call mpbci(nswr)\n      call mpbci(nradint)\n"),
        ("      if(ntime == 1) call mksecond(zsec,0.)\n",
         "      if (nradint > 1 .and. allocated(rc_dtdt)) then\n"
         "       if (mod(nstep, nradint) /= 0) then\n"
         + "".join(f"        {name} = rc_{name}\n" for name in CACHED_RADIATION)
         + "        dtdt(:,:) = dtdt(:,:) + rc_dtdt(:,:)\n"
         "        return\n"
         "       endif\n"
         "      endif\n"
         "      if(ntime == 1) call mksecond(zsec,0.)\n"),
        ("      if (nradice==0) dicec(:) = zfice(:)\n",
         "      if (nradice==0) dicec(:) = zfice(:)\n"
         "      if (nradint > 1) then\n"
         + "".join(f"       rc_{name} = {name}\n" for name in CACHED_RADIATION)
         + "       rc_dtdt = zdtdt\n"
         "      endif\n"),
    ]
    for old, new in edits:
        if text.count(old) != 1:
            raise RuntimeError(f"Radiation interval anchor not unique: {old.strip()[:60]}")
        text = text.replace(old, new)
    return text


def patch_sources(model: ModelSource):
    resolution = f"module resmod\nparameter(NLAT_ATM={model.latitudes})\nparameter(NLEV_ATM={model.layers})\nparameter(NPRO_ATM={model.ranks})\nend module resmod\n"
    if not (model.build / "resmod.f90").exists() or (model.build / "resmod.f90").read_text() != resolution:
        (model.build / "resmod.f90").write_text(resolution)
    main = (model.build / "plasim.f90").read_text().replace("      call epilog", "      call wasm_fields\n      call epilog", 1)
    main = main.replace(",solar_day,-1,mcal_days_per_year)", ",solar_day,-1,nint(mpstep),mcal_days_per_year)")
    main = main.replace(",solar_day,0,mcal_days_per_year)", ",solar_day,0,nint(mpstep),mcal_days_per_year)")
    if model.layers < 10:
        start = main.index("      if ((NLEV==20) .and. (nrdrag==1)")
        end = main.index("      endif", start) + len("      endif")
        main = main[:start] + main[end:]
        start = main.index("      elseif ((neqsig==5) .and. (NLEV .gt. 10)) then")
        end = main.index("\n      else\n", start)
        main = main[:start] + main[end:]
    main += WASM_FIELDS
    if model.step_hook:
        if main.count(STEP_END) != 1:
            raise RuntimeError("Expected one stability check in the main loop")
        main = main.replace(STEP_END, f"         call {model.step_hook}\n" + STEP_END)
    (model.build / "plasim.f90").write_text(main + model.main_suffix)
    stub = model.build / "mpimod_stub.f90"
    stub.write_text(stub.read_text().replace("subroutine mrdiff(p,d,n)", "subroutine mrdiff(p,d,n,k)"))
    coupler = model.build / "cpl_stub.f90"
    coupler.write_text(coupler.read_text().replace("clsgini(kdatim,ktspd,kaomod,pslm,kxa,kya)", "clsgini(kdatim,ktspd,kaomod,klsg,kgui,pslm,kxa,kya)").replace("pheat,pfldo)", "pheat,pfldo,pextra)"))
    hurricane = model.build / "hurricanemod.f90"
    hurricane.write_text(hurricane.read_text().replace("subroutine hurricaneini(gascon)\n      use hurricanemod", "subroutine hurricaneini(gascon)\n      use hurricanemod\n      use pumamod, only: mypid,NROOT,nwritehurricane"))
    radiation = model.build / "radmod.f90"
    radiation.write_text(radiation_interval(radiation.read_text()))
    patches = []
    for name in ["plasim.f90", "mpimod_stub.f90", "cpl_stub.f90", "hurricanemod.f90", "radmod.f90"]:
        original = model.source / "plasim/src" / name
        patches.extend(difflib.unified_diff(original.read_text().splitlines(keepends=True), (model.build / name).read_text().splitlines(keepends=True), fromfile="a/exoplasim/plasim/src/" + name, tofile="b/exoplasim/plasim/src/" + name))
    (model.output / "model-source.patch").write_text("".join(patches))
    shutil.copy2(model.source / "COPYING", model.output / "COPYING")


def object_names(model: ModelSource) -> str:
    objects = re.search(r"^OBJ=(.*)$", (model.build / "make_plasim").read_text(), re.M).group(1)
    for key, value in {"MPIMOD": model.mpi_module, "FFTMOD": "fftmod", "GUIMOD": "guimod_stub", "RAINMOD": "rainmod", "VEGMOD": "simba", "PLAMOD": "p_earth", "UTILMOD": model.utility_module, "LANDMOD": "landmod", "PUMAX": "pumax_stub", "OCEAN": "lsgmod", "OCEANCOUP": "cpl_stub"}.items():
        objects = objects.replace("${" + key + "}", value)
    return objects
