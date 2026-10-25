addToLibrary({
    $SHM: {
        HEADER: 64,
        REGION: 8 * 1024 * 1024,
        state: null,
        get() {
            if (SHM.state) return SHM.state;
            const { sab, rank, size, spin } = Module.shm;
            SHM.state = {
                rank,
                size,
                spin,
                sequence: 0,
                control: new Int32Array(sab, 0, 16),
                bytes: new Uint8Array(sab),
                sab,
                stats: { collectives: 0, barrierMs: 0, waits: 0, copyMs: 0 },
            };
            Module.shmStats = SHM.state.stats;
            return SHM.state;
        },
        region(state, slotBytes) {
            if (slotBytes * state.size > SHM.REGION) throw new Error(`Shared-memory slot of ${slotBytes} bytes exceeds the exchange region`);
            state.stats.collectives++;
            return SHM.HEADER + (state.sequence++ & 1) * SHM.REGION;
        },
        barrier(state) {
            const started = performance.now();
            const control = state.control;
            const generation = Atomics.load(control, 1);
            if (Atomics.add(control, 0, 1) === state.size - 1) {
                Atomics.store(control, 0, 0);
                Atomics.add(control, 1, 1);
                Atomics.notify(control, 1);
            } else {
                let released = false;
                for (let i = 0; i < state.spin; i++) {
                    if (Atomics.load(control, 1) !== generation) { released = true; break; }
                }
                while (!released) {
                    if (Atomics.load(control, 2) !== 0) throw new Error("Another rank aborted");
                    state.stats.waits++;
                    Atomics.wait(control, 1, generation, 1000);
                    released = Atomics.load(control, 1) !== generation;
                }
            }
            if (Atomics.load(control, 2) !== 0) throw new Error("Another rank aborted");
            state.stats.barrierMs += performance.now() - started;
        },
        toShared(state, offset, pointer, count) {
            state.bytes.set(HEAPU8.subarray(pointer, pointer + count), offset);
        },
        fromShared(state, offset, pointer, count) {
            HEAPU8.set(state.bytes.subarray(offset, offset + count), pointer);
        },
        sum(state, base, slotBytes, start, count, op, elementBytes) {
            const Values = elementBytes === 4 ? Float32Array : Float64Array;
            const result = new Values(count);
            for (let rank = 0; rank < state.size; rank++) {
                const values = new Values(state.sab, base + rank * slotBytes + start * elementBytes, count);
                if (rank === 0) result.set(values);
                else if (op === 0) for (let i = 0; i < count; i++) result[i] += values[i];
                else for (let i = 0; i < count; i++) result[i] = Math.max(result[i], values[i]);
            }
            return new Uint8Array(result.buffer);
        },
    },

    shm_init__deps: ["$SHM"],
    shm_init: (rankPointer, sizePointer) => {
        const state = SHM.get();
        HEAP32[rankPointer >> 2] = state.rank;
        HEAP32[sizePointer >> 2] = state.size;
    },

    shm_barrier__deps: ["$SHM"],
    shm_barrier: () => SHM.barrier(SHM.get()),

    shm_abort__deps: ["$SHM"],
    shm_abort: () => {
        const state = SHM.get();
        Atomics.store(state.control, 2, 1);
        Atomics.notify(state.control, 1);
    },

    shm_bcast__deps: ["$SHM"],
    shm_bcast: (pointer, count) => {
        const state = SHM.get();
        const base = SHM.region(state, count);
        if (state.rank === 0) SHM.toShared(state, base, pointer, count);
        SHM.barrier(state);
        if (state.rank !== 0) SHM.fromShared(state, base, pointer, count);
    },

    shm_blocks__deps: ["$SHM"],
    shm_blocks: (full, local, chunk, fullStride, localStride, levels, elementBytes, mode) => {
        const state = SHM.get();
        const chunkBytes = chunk * elementBytes;
        const slotBytes = levels * chunkBytes;
        const base = SHM.region(state, slotBytes);
        const started = performance.now();
        if (mode === 2) {
            if (state.rank === 0) {
                for (let rank = 0; rank < state.size; rank++) {
                    for (let level = 0; level < levels; level++) {
                        SHM.toShared(state, base + rank * slotBytes + level * chunkBytes, full + (level * fullStride + rank * chunk) * elementBytes, chunkBytes);
                    }
                }
            }
        } else {
            for (let level = 0; level < levels; level++) {
                SHM.toShared(state, base + state.rank * slotBytes + level * chunkBytes, local + level * localStride * elementBytes, chunkBytes);
            }
        }
        state.stats.copyMs += performance.now() - started;
        SHM.barrier(state);
        const resumed = performance.now();
        if (mode === 2) {
            for (let level = 0; level < levels; level++) {
                SHM.fromShared(state, base + state.rank * slotBytes + level * chunkBytes, local + level * localStride * elementBytes, chunkBytes);
            }
        } else if (mode === 1 || state.rank === 0) {
            for (let rank = 0; rank < state.size; rank++) {
                for (let level = 0; level < levels; level++) {
                    SHM.fromShared(state, base + rank * slotBytes + level * chunkBytes, full + (level * fullStride + rank * chunk) * elementBytes, chunkBytes);
                }
            }
        }
        state.stats.copyMs += performance.now() - resumed;
    },

    shm_reduce__deps: ["$SHM"],
    shm_reduce: (send, receive, count, elementBytes, op, mode) => {
        const state = SHM.get();
        const slotBytes = count * elementBytes;
        const base = SHM.region(state, slotBytes);
        SHM.toShared(state, base + state.rank * slotBytes, send, slotBytes);
        SHM.barrier(state);
        if (mode === 1 || state.rank === 0) HEAPU8.set(SHM.sum(state, base, slotBytes, 0, count, op, elementBytes), receive);
    },

    shm_reduce_scatter__deps: ["$SHM"],
    shm_reduce_scatter: (full, local, chunk, fullStride, localStride, levels, elementBytes) => {
        const state = SHM.get();
        const slotBytes = levels * fullStride * elementBytes;
        const base = SHM.region(state, slotBytes);
        const started = performance.now();
        SHM.toShared(state, base + state.rank * slotBytes, full, slotBytes);
        state.stats.copyMs += performance.now() - started;
        SHM.barrier(state);
        const resumed = performance.now();
        for (let level = 0; level < levels; level++) {
            HEAPU8.set(SHM.sum(state, base, slotBytes, level * fullStride + state.rank * chunk, chunk, 0, elementBytes), local + level * localStride * elementBytes);
        }
        state.stats.copyMs += performance.now() - resumed;
    },
});
