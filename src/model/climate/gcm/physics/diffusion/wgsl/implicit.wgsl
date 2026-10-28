// One tridiagonal elimination of the ECHAM semi-implicit vertical
// diffusion for a plain field (momentum, kinetic energy, humidity), in
// place. k holds the exchange coefficients between levels l and l + 1.
fn diffuse(x: ptr<function, array<f32, NLEV>>, k: ptr<function, array<f32, NLEV>>) {
	var ebs: array<f32, NLEV>;
	let ds0 = tables[TABLE_DSIGMA];
	ebs[0] = (*k)[0] / (ds0 + (*k)[0]);
	(*x)[0] = ds0 * (*x)[0] / (ds0 + (*k)[0]);
	for (var l = 1u; l < NLEM; l++) {
		let ds = tables[TABLE_DSIGMA + l];
		let denominator = ds + (*k)[l] + (*k)[l - 1u] * (1.0 - ebs[l - 1u]);
		ebs[l] = (*k)[l] / denominator;
		(*x)[l] = ((*x)[l] * ds + (*k)[l - 1u] * (*x)[l - 1u]) / denominator;
	}
	let dsn = tables[TABLE_DSIGMA + NLEV - 1u];
	(*x)[NLEV - 1u] = ((*x)[NLEV - 1u] * dsn + (*k)[NLEM - 1u] * (*x)[NLEM - 1u])
		/ (dsn + (*k)[NLEM - 1u] * (1.0 - ebs[NLEM - 1u]));
	for (var l = i32(NLEM) - 1; l >= 0; l--) {
		(*x)[l] = (*x)[l] + ebs[l] * (*x)[l + 1];
	}
}

// The same elimination for temperature diffused as potential temperature:
// k is already scaled by sigmah^kappa and skap holds sigma^kappa.
fn diffuse_potential(
	x: ptr<function, array<f32, NLEV>>,
	k: ptr<function, array<f32, NLEV>>,
	skap: ptr<function, array<f32, NLEV>>,
) {
	var ebs: array<f32, NLEV>;
	let ds0 = tables[TABLE_DSIGMA];
	ebs[0] = (*k)[0] / (ds0 + (*k)[0] / (*skap)[0]);
	(*x)[0] = ds0 * (*x)[0] / (ds0 + (*k)[0] / (*skap)[0]);
	for (var l = 1u; l < NLEM; l++) {
		let ds = tables[TABLE_DSIGMA + l];
		let denominator = ds + ((*k)[l] + (*k)[l - 1u] * (1.0 - ebs[l - 1u] / (*skap)[l - 1u])) / (*skap)[l];
		ebs[l] = (*k)[l] / denominator;
		(*x)[l] = ((*x)[l] * ds + (*k)[l - 1u] / (*skap)[l - 1u] * (*x)[l - 1u]) / denominator;
	}
	let last = NLEV - 1u;
	let dsn = tables[TABLE_DSIGMA + last];
	(*x)[last] = ((*x)[last] * dsn + (*k)[NLEM - 1u] * (*x)[NLEM - 1u] / (*skap)[NLEM - 1u])
		/ (dsn + (*k)[NLEM - 1u] / (*skap)[last] * (1.0 - ebs[NLEM - 1u] / (*skap)[NLEM - 1u]));
	for (var l = i32(NLEM) - 1; l >= 0; l--) {
		(*x)[l] = (*x)[l] + ebs[l] * (*x)[l + 1] / (*skap)[l + 1];
	}
}
