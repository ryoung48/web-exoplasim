// musl's logf and expf. WGSL's log, exp and pow have absolute error bounds,
// which near log's root or across cancelling pow terms leave far more
// relative error than f32 libm.
fn precise_log(x: f32) -> f32 {
	let parts = frexp(x);
	var m = parts.fract * 2.0;
	var k = f32(parts.exp - 1);
	if (m > 1.4142135) {
		m = m * 0.5;
		k = k + 1.0;
	}
	let f = m - 1.0;
	let s = f / (2.0 + f);
	let z = s * s;
	let w = z * z;
	let t1 = w * (0.40000972152 + w * 0.24279078841);
	let t2 = z * (0.66666662693 + w * 0.28498786688);
	let hfsq = 0.5 * f * f;
	return s * (hfsq + t1 + t2) + k * 9.0580006145e-06 - hfsq + f + k * 6.9313812256e-01;
}

fn precise_exp(x: f32) -> f32 {
	let k = floor(1.4426950216 * x + 0.5);
	let hi = x - k * 6.9314575195e-01;
	let lo = k * 1.4286067653e-06;
	let r = hi - lo;
	let rr = r * r;
	let c = r - rr * (1.6666625440e-01 + rr * -2.7667332906e-03);
	return ldexp(1.0 + (r * c / (2.0 - c) - lo + hi), i32(k));
}

fn precise_pow(x: f32, y: f32) -> f32 {
	return precise_exp(y * precise_log(x));
}
