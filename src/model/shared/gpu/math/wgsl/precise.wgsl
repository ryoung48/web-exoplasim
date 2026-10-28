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

// musl's atanf: WGSL bounds atan only to 4096 ULP.
fn precise_atan(value: f32) -> f32 {
	let x = abs(value);
	if (x >= 67108864.0) {
		return sign(value) * (1.5707962513 + 7.5497894159e-08);
	}
	var hi = 0.0;
	var lo = 0.0;
	var reduced = x;
	var reduce = true;
	if (x < 0.4375) {
		if (x < 0.000244140625) {
			return value;
		}
		reduce = false;
	} else if (x < 0.6875) {
		reduced = (2.0 * x - 1.0) / (2.0 + x);
		hi = 4.6364760399e-01;
		lo = 5.0121582440e-09;
	} else if (x < 1.1875) {
		reduced = (x - 1.0) / (x + 1.0);
		hi = 7.8539812565e-01;
		lo = 3.7748947079e-08;
	} else if (x < 2.4375) {
		reduced = (x - 1.5) / (1.0 + 1.5 * x);
		hi = 9.8279368877e-01;
		lo = 3.4473217170e-08;
	} else {
		reduced = -1.0 / x;
		hi = 1.5707962513e+00;
		lo = 7.5497894159e-08;
	}
	let z = reduced * reduced;
	let w = z * z;
	let s1 = z * (3.3333328366e-01 + w * (1.4253635705e-01 + w * 6.1687607318e-02));
	let s2 = w * (-1.9999158382e-01 + w * -1.0648017377e-01);
	if (!reduce) {
		return value - value * (s1 + s2);
	}
	let result = hi - ((reduced * (s1 + s2) - lo) - reduced);
	return select(result, -result, value < 0.0);
}

// WGSL allows 2.5 ULP for division, and Chrome's is biased: a quotient of
// large terms can come out several ULPs low every time. One fma residual
// step brings it to (nearly always) the correctly rounded one.
fn precise_divide(a: f32, b: f32) -> f32 {
	let q = a / b;
	return fma(fma(-q, b, a), 1.0 / b, q);
}

// x^n by binary exponentiation, as libgcc's __powisf2 computes Fortran's
// x**n for an integer n.
fn precise_powi(x: f32, n: i32) -> f32 {
	var base = x;
	var m = u32(abs(n));
	var result = select(1.0, x, (m & 1u) != 0u);
	m = m >> 1u;
	while (m != 0u) {
		base = base * base;
		if ((m & 1u) != 0u) {
			result = result * base;
		}
		m = m >> 1u;
	}
	return select(result, 1.0 / result, n < 0);
}

// For x ≥ 0; 0^y is 0 for y > 0, as Fortran's powf gives.
fn precise_pow(x: f32, y: f32) -> f32 {
	return select(precise_exp(y * precise_log(x)), 0.0, x == 0.0);
}
