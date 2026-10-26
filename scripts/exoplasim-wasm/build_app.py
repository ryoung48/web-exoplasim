import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


parser = argparse.ArgumentParser(description="Build the ExoPlaSim Wasm variants served by the /gcm page")
parser.add_argument("--ranks", type=int, nargs="+", default=[2, 4, 8])
parser.add_argument("--truncations", type=int, nargs="+", choices=[21, 42], default=[21, 42])
parser.add_argument("--output", type=Path, default=Path("public/gcm"))
parser.add_argument("--layers", type=int, nargs="+", choices=[5, 10], default=[10, 5])
parser.add_argument("--precision", type=int, choices=[4, 8], default=8)
parser.add_argument("--link-only", action="store_true")
args = parser.parse_args()
script = Path(__file__).resolve().parent / "build.py"
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
for stale in [*output.glob("ranks-*"), output / "exoplasim.data"]:
    if stale.is_dir():
        shutil.rmtree(stale)
    else:
        stale.unlink(missing_ok=True)
manifest_path = output / "manifest.json"
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
resolutions = {(entry["truncation"], entry["layers"]): entry for entry in manifest.get("resolutions", [])}
for truncation in args.truncations:
    folder = output / f"t{truncation}"
    digests = set()
    for layers in args.layers:
        layer_folder = folder / f"layers-{layers}"
        for ranks in args.ranks:
            variant = layer_folder / f"ranks-{ranks}"
            subprocess.run([sys.executable, script, "--app", "--truncation", str(truncation), "--layers", str(layers), "--precision", str(args.precision), "--ranks", str(ranks), "--output", variant, *(["--link-only"] if args.link_only else [])], check=True)
            data = variant / "exoplasim.data"
            digests.add(hashlib.sha256(data.read_bytes()).hexdigest())
            shutil.move(data, folder / "exoplasim.data")
            shutil.move(variant / "COPYING", output / "COPYING")
            for leftover in ["model-source.patch", "runtime-source.patch"]:
                (variant / leftover).unlink(missing_ok=True)
        download = {ranks: (layer_folder / f"ranks-{ranks}" / "exoplasim.wasm").stat().st_size + (folder / "exoplasim.data").stat().st_size for ranks in args.ranks}
        resolutions[(truncation, layers)] = {"truncation": truncation, "layers": layers, "latitudes": {21: 32, 42: 64}[truncation], "precisionBytes": args.precision, "ranks": sorted(args.ranks), "downloadBytes": download[max(args.ranks)]}
    if len(digests) != 1:
        raise RuntimeError(f"T{truncation} variants produced different data packages; they cannot share exoplasim.data")
manifest_path.write_text(json.dumps({"resolutions": [resolutions[key] for key in sorted(resolutions)]}, indent=2) + "\n")
print("GCM assets:", sorted(path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()))
