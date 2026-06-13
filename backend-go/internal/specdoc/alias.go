package specdoc

import "viewer/internal/omap"

// The ordered map lives in its own package so simproc and the simulation
// engine can share it; specdoc keeps local aliases for brevity.
type Map = omap.Map

var (
	NewMap        = omap.NewMap
	PyStr         = omap.PyStr
	DecodeOrdered = omap.DecodeOrdered
)

func truthy(v any) bool { return omap.Truthy(v) }
