addToLibrary({
    gcm_should_publish: (step) => (Module.gcm.shouldPublish(step) ? 1 : 0),

    gcm_should_stop: () => (Module.gcm.shouldStop() ? 1 : 0),

    gcm_publish: (pointer, fields, points, elementBytes, step, datePointer) => {
        const count = fields * points;
        const raw = HEAPU8.slice(pointer, pointer + count * elementBytes).buffer;
        const values = elementBytes === 4 ? new Float32Array(raw) : new Float32Array(new Float64Array(raw));
        const date = Array.from(HEAP32.subarray(datePointer >> 2, (datePointer >> 2) + 5));
        Module.gcm.publish({ step, date, fields, points, values });
    },
});
