override RDBRV: f32;
override RA1: f32;
override RA2: f32;
override RA4: f32;
override TMELT: f32;
// 1 / rdbrv - 1.
override MOIST: f32;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// Saturation specific humidity at temperature t and pressure p (Magnus
// formula over water), capped at rdbrv. rainmod then corrects it either as
// q·zcor with zcor = 1 / (1 − MOIST·q), or as q / (1 − MOIST·q); the two
// round differently, so each caller keeps its own form.
fn saturation_capped(t: f32, p: f32) -> f32 {
	return min(RDBRV * RA1 * precise_exp(RA2 * (t - TMELT) / (t - RA4)) / p, RDBRV);
}

fn saturation_divided(t: f32, p: f32) -> f32 {
	let q = saturation_capped(t, p);
	return q / (1.0 - MOIST * q);
}
