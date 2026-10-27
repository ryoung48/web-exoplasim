# ExoPlaSim CUDA feasibility research

Research date: 2026-10-27. This records local observations, source review and toolchain options; no model GPU conversion or speed benchmark has been performed. The browser implementation and its measured baselines are documented in [ExoPlaSim WebAssembly](exoplasim-wasm.md).

## Findings

Local CUDA execution is feasible through the existing Ubuntu WSL2 distribution. Keeping the Fortran source and testing OpenACC with NVIDIA's HPC SDK is the most direct initial experiment. It preserves double precision without a WGSL rewrite, but a speedup on this machine is uncertain: its gaming GPU has limited FP64 arithmetic throughput, and the model needs explicit data/dependency work before substantial computation can remain on the GPU.

| Local check | Observation |
| --- | --- |
| GPU | NVIDIA GeForce RTX 2070 SUPER; compute capability 7.5; 8,192 MiB VRAM |
| Windows driver | 610.88; `nvidia-smi` reports CUDA driver capability 13.3, which does not establish that a CUDA toolkit is installed |
| Linux environment | Ubuntu 22.04.3 LTS; WSL2 kernel `6.18.54.1-microsoft-standard-WSL2` |
| GPU visibility | `/usr/lib/wsl/lib/nvidia-smi` reports the same GPU inside Ubuntu |
| Existing native compiler | GNU Fortran 11.4.0 and `/usr/bin/mpif90` |
| NVIDIA tools | `nvfortran`, `nvcc` and `nsys` not found on the inspected WSL PATH; `/opt/nvidia/hpc_sdk` and `/usr/local/cuda` absent |
| GPU arithmetic | CUDA Driver API kernel launch, synchronization, and result copy succeeded; FP64 retained an increment that FP32 rounded away |

The arithmetic probe used Python's standard-library `ctypes`, the existing WSL `libcuda.so.1`, and a small driver-JIT-compiled PTX kernel targeting `sm_75`. Inputs were supplied as kernel parameters. For `1 + 2**-40`, FP64 returned `1.0000000000009095`, exactly matching the host double result; FP32 returned `1.0`. Local reproducible artifacts are `stats/cuda-research/probe.py` and `stats/cuda-research/probe.json`. This tests one thread, not compiler compatibility, throughput or model correctness. No packages or drivers were installed.

## Toolchain and Windows constraints

NVIDIA HPC SDK 26.9 is a candidate, not a locally validated installation. Its release notes list Ubuntu 22.04 and include CUDA 13.3U1 and 12.9U1 components. The downloads offer a Linux x86-64 CUDA 13.3 package; the matching container lists Turing `sm75`. These support trying this host/GPU combination. The Linux support table does not by itself certify WSL; NVIDIA staff separately report that the HPC compilers are known to work there. Sources: [release notes](https://docs.nvidia.com/hpc-sdk/release-notes/index.html), [downloads](https://developer.nvidia.com/hpc-sdk/releases/26.9), [container requirements](https://catalog.ngc.nvidia.com/orgs/nvidia/-/containers/nvhpc/26.9-devel-cuda13.3-ubuntu24.04), [WSL compiler statement](https://forums.developer.nvidia.com/t/windows-release-for-hpc-sdk-status-timeframe/293545).

Use the existing Windows NVIDIA driver for WSL; do not install a Linux display driver inside the distribution. WSL lacks full managed-memory functionality and concurrent CPU/GPU access to managed allocations. Explicit OpenACC data regions with separate device memory are therefore the preferred starting point, rather than assuming transparent unified memory will cover module variables and automatic arrays. Sources: [WSL constraints](https://docs.nvidia.com/cuda/wsl-user-guide/index.html#known-limitations-for-linux-cuda-applications), [compiler memory modes](https://docs.nvidia.com/hpc-sdk/compilers/hpc-compilers-user-guide/index.html#gpu-memory-modes).

Native Windows CUDA C++ is another option, using the supported Windows toolkit and host compiler, but would require a C-compatible boundary and translating selected Fortran routines. It offers no immediate advantage for preserving this source. [Windows CUDA installation](https://docs.nvidia.com/cuda/cuda-installation-guide-microsoft-windows/)

## Porting choices

| Approach | Fit for this source | Main cost |
| --- | --- | --- |
| Fortran + OpenACC | First candidate: annotate bounded loops and manage their data explicitly | Dependency analysis, module-state mapping, scratch storage and transfer control |
| CUDA Fortran | Useful if a measured hotspot needs explicit kernel control | More GPU-specific changes and manual kernel/data design |
| Fortran + OpenMP target | Alternative directive model | Validate the compiler's support for the specific constructs and data mappings used |
| CUDA C++ kernels + Fortran host | Native Windows route or isolated library kernels | Rewrite kernels and define interoperable interfaces |

The [HPC compiler guide](https://docs.nvidia.com/hpc-sdk/compilers/hpc-compilers-user-guide/index.html) documents OpenACC, OpenMP GPU offloading and CUDA Fortran. Adding a GPU compiler flag alone will not parallelize the existing model. The [OpenACC guide](https://docs.nvidia.com/hpc-sdk/compilers/openacc-gs/index.html) documents `-acc`, explicit compute-capability selection and compiler feedback.

For an isolated FP64 OpenACC experiment, a candidate flag set is `-O2 -r8 -Kieee -acc -gpu=cc75,mem:separate -Minfo=accel`. This has not been executed locally. `-r8` promotes default REAL; explicit-kind declarations still need auditing. `-Kieee` requests stricter floating-point behavior but does not guarantee agreement across CPU/GPU math libraries or reduction orders. Model preprocessing must also remain enabled: the existing native build uses `-cpp`, which must be translated to the NVIDIA compiler's preprocessing option. [Compiler flag reference](https://docs.nvidia.com/hpc-sdk/compilers/hpc-compilers-ref-guide/)

## Source-specific obstacles and candidates

The inspected source is the pinned ExoPlaSim checkout under `/var/tmp/chaos-exoplasim-wasm/source/exoplasim`, commit `5f8dff4aaa8d6cd8813e6e0cf21c49883cbfb7ff`.

- `plasim/src/plasim.f90`: `gridpointd` orchestrates dependent physics. For example, `fluxstep` precedes `radstep`, which precedes `rainstep`. Offloading the whole routine as one parallel region would be inappropriate without analyzing these dependencies.
- `plasim/src/radmod.f90`: `swr` and `lwr` are bounded radiation candidates with horizontal-column arrays and vertical recurrences. Preserve vertical dependencies while exploring horizontal parallelism. Numerous `NHOR`-by-level temporary arrays and shared `radmod` state require deliberate device allocation and mapping; naively privatizing whole arrays per thread would be expensive.
- `plasim/src/legmod.f90`: transforms have nested latitude, mode and level loops with accumulation dependencies. GPU parallelism requires preserving or explicitly implementing reductions and batching enough work to amortize launches.
- `plasim/src/fftmod.f90`: `gp2fc` calls `dfft8(a,a,...)`; `fc2gp` calls `ifft8(a,a,...)`. The existing Flang experiment already established that aliasing assumptions can corrupt this code under optimization. Validate a new compiler's CPU build before interpreting GPU differences. A cuFFT substitution would additionally require checking transform layout, normalization and supported grid lengths.

Existing Wasm profiles show substantial time in `gridpointd`, with radiation and powers among the costs. They identify candidates, not a native-CUDA cost distribution. Profile a native build before choosing the first production hotspot.

Reuse `scripts/exoplasim-wasm/model_source.py` for source copying/patches and object lists, and `reference.py` plus `gcm_reference.f90` for native comparisons and annual diagnostics. Avoid forking their source-adjustment logic. The current build and reference CLIs accept T21/T42 only; T63 needs deliberate resolution and boundary-data support. A first single-GPU prototype can use the serial MPI stubs; production scaling must compare against the existing multicore MPI baseline too. The Wasm shared-memory JS library is not a CUDA communication layer.

## Performance and numerical interpretation

Turing has 64 FP32 versus 2 FP64 cores per SM: nominal FP64 arithmetic throughput is approximately 1/32 of FP32. This is an architectural ratio, not a prediction of whole-model speed. Bandwidth-bound kernels may still benefit, while FP64-heavy math and small launches may not. Turing's Tensor Cores do not provide a general FP64 solution. [Turing tuning guide](https://docs.nvidia.com/cuda/turing-tuning-guide/index.html)

T63's standard 192-by-96 grid has 18,432 horizontal points versus T42's 128-by-64 = 8,192: 2.25 times as many columns at the same layer count. That offers more parallel work, but does not establish a GPU speedup or total memory footprint. Model/runtime scratch allocations must be measured. The standard grids are documented by [ExoPlaSim](https://exoplasim.readthedocs.io/en/stable/source/exoplasim.html).

The existing `--precision 4` mode is not a strict all-FP32 WebGPU surrogate: explicitly declared 8-byte reals remain unless separately demoted. `reference.py --demote-double` already covers that distinction. A CUDA FP64 comparison should retain the FP64 baseline throughout; introducing mixed precision simultaneously would obscure causes of differences.

A useful first model experiment would establish an NVFORTRAN CPU result, then compare one isolated GPU routine on identical captured inputs, including transfers in timing. A model benchmark should compare FP64 native serial, native MPI and GPU on identical T42/10-layer inputs, seed, 30-minute timestep, radiation every step and output settings. Use 48 steps for a short numerical check and 480 steps for comparison with the existing ten-day browser workload. Record warm-up separately, synchronize before stopping timers, report repeated elapsed-time distributions and verify actual GPU kernel execution. Reuse the existing field tolerances in [the benchmark history](exoplasim-wasm.md#frontend-optimization); a failure needs investigation rather than automatically loosening tolerances. Multi-year conservation and climate-statistics checks remain necessary after a short check passes.

No model speedup estimate is supported yet. The immediate research result is that this machine can execute FP64 CUDA through WSL, with OpenACC the leading source-preserving experiment and FP64 throughput the main hardware concern. Integrating a CUDA backend into the browser UI would require a separate local process or server and its own snapshot/checkpoint transport; browser JavaScript cannot invoke CUDA directly.
