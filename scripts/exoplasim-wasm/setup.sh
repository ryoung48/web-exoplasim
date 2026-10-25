set -eu
work=/var/tmp/chaos-exoplasim-wasm
mkdir -p "$work"
cd "$work"
if [ ! -x bin/micromamba ]; then
    curl -fLsS https://micro.mamba.pm/api/micromamba/linux-64/latest -o micromamba.tar.bz2
    tar -xjf micromamba.tar.bz2 bin/micromamba
fi
export MAMBA_ROOT_PREFIX="$work/mamba"
if [ ! -x toolchain/bin/flang-new ]; then
    ./bin/micromamba create -y -p "$work/toolchain" -c conda-forge/label/emscripten -c conda-forge --channel-priority disabled conda-forge/label/emscripten::flang=19.1.7 conda-forge/label/emscripten::libflang=19.1.7 python=3.12
fi
if [ ! -x emsdk/bin/emcc ]; then
    ./bin/micromamba create -y -p "$work/emsdk" -c conda-forge emscripten=4.0.9 python=3.12
fi
if [ ! -x native/bin/flang-new ]; then
    ./bin/micromamba create -y -p "$work/native" -c conda-forge --override-channels flang=19.1.7
fi
if [ ! -d source/exoplasim ]; then
    curl -fLsS https://codeload.github.com/alphaparrot/ExoPlaSim/tar.gz/5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff -o source.tar.gz
    mkdir -p source
    tar -xzf source.tar.gz -C source --strip-components=1
fi
if [ ! -d flang-src/lib/Decimal ]; then
    curl -fLsS https://github.com/llvm/llvm-project/releases/download/llvmorg-19.1.7/flang-19.1.7.src.tar.xz -o flang.src.tar.xz
    mkdir -p flang-src
    tar -xf flang.src.tar.xz -C flang-src --strip-components=1
fi
if [ ! -x binaryen-version_123/bin/wasm-opt ]; then
    curl -fLsS https://github.com/WebAssembly/binaryen/releases/download/version_123/binaryen-version_123-x86_64-linux.tar.gz -o binaryen.tar.gz
    tar -xzf binaryen.tar.gz
fi
