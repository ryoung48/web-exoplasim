import type { SharedRng } from "@/model/shared/random/rng"

export interface SphereMesh {
	numRegions: number
	numTriangles: number
	numSides: number
	/** Flat xyz coords for each region center, length 3*numRegions */
	r_xyz: Float32Array
	/** Flat xyz coords for each triangle circumcenter, length 3*numTriangles */
	t_xyz: Float32Array
	/** Delaunay triangle indices, length 3*numTriangles */
	triangles: Int32Array
	/** Opposite halfedge for each side */
	halfedges: Int32Array
	/** CSR adjacency offset array, length numRegions+1 */
	adjOffset: Int32Array
	/** CSR adjacency list (neighbor region indices) */
	adjList: Int32Array
	/** Per-edge Euclidean distance between adjacent region centers */
	neighborDist: Float32Array
	/** Per-region Voronoi cell solid angle in steradians (sums to 4pi); x planetRadiusKm**2 for km**2 */
	regionArea: Float32Array
	/** For each side s, the region where the side begins */
	s_begin_r: Int32Array
	/** For each side s, the region where the side ends */
	s_end_r: Int32Array
	/** For each side s, the triangle on the inner (left) side */
	s_inner_t: Int32Array
	/** For each side s, the triangle on the outer (right) side */
	s_outer_t: Int32Array
}

export interface GenerateFibonacciSphereParams {
	N: number
	jitter: number
	rng: SharedRng
}

export interface GenerateAdaptiveFibonacciSphereParams {
	targetN: number
	jitter: number
	rng: SharedRng
	densityWeight: (latDeg: number, lonDeg: number) => number
}

export interface StereographicProjectionParams {
	r_xyz: Float32Array
	N: number
}

export interface AddPoleToMeshParams {
	poleId: number
	triangles: Uint32Array
	halfedges: Int32Array
}

export interface BuildSphereMeshParams {
	n: number
	jitter: number
	rng: SharedRng
	densityWeight?: (latDeg: number, lonDeg: number) => number
}
