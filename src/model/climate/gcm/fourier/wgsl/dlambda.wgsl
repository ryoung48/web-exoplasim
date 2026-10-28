override SOURCE: u32;
override TARGET: u32;

// gridpointa's gpmt: d/dlambda in Fourier space, (re, im) * i m.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let m = i % NTP1;
	let at = (i / NTP1) * NFC + 2u * m;
	let re = state[SOURCE + at];
	let im = state[SOURCE + at + 1u];
	state[TARGET + at] = -im * f32(m);
	state[TARGET + at + 1u] = re * f32(m);
}
