// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/GoogleChrome/webstatus.dev/lib/gcpspanner"
	"github.com/GoogleChrome/webstatus.dev/lib/gen/openapi/backend"
)

// GetFeature implements backend.StrictServerInterface.
// nolint: revive, ireturn // Name generated from openapi
func (s *Server) GetFeature(
	ctx context.Context,
	request backend.GetFeatureRequestObject,
) (backend.GetFeatureResponseObject, error) {
	var cachedResponse backend.GetFeature200JSONResponse
	found := s.operationResponseCaches.getFeatureCache.Lookup(ctx, request, &cachedResponse)
	if found {
		return cachedResponse, nil
	}
	feature, err := s.wptMetricsStorer.GetFeature(ctx, request.FeatureId,
		getWPTMetricViewOrDefault(request.Params.WptMetricView),
		defaultBrowsers(),
	)
	if err != nil {
		if errors.Is(err, gcpspanner.ErrQueryReturnedNoResults) {
			return backend.GetFeature404JSONResponse{
				Code:    http.StatusNotFound,
				Message: fmt.Sprintf("feature id %s is not found", request.FeatureId),
			}, nil
		}
		// Catch all for all other errors.
		slog.ErrorContext(ctx, "unable to get feature", "error", err)

		return backend.GetFeature500JSONResponse{
			Code:    500,
			Message: "unable to get feature",
		}, nil
	}

	resp := backend.GetFeature200JSONResponse(*feature)
	s.operationResponseCaches.getFeatureCache.AttemptCache(ctx, request, &resp)

	return resp, nil
}
