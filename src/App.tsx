import { Navigate, Route, Routes } from "react-router-dom"
import { APP_PATHS } from "@/app-routes"
import { GcmView } from "@/ui/gcm/GcmView"

function App() {
	return (
		<div className="relative h-screen w-screen overflow-hidden bg-white font-sans text-slate-900 selection:bg-slate-900 selection:text-white">
			<Routes>
				<Route path={APP_PATHS.gcm} element={<GcmView />} />
				<Route path="*" element={<Navigate to={APP_PATHS.gcm} replace />} />
			</Routes>
		</div>
	)
}

export default App
