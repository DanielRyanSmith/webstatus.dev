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
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/GoogleChrome/webstatus.dev/lib/cachetypes"
	"github.com/GoogleChrome/webstatus.dev/lib/gcpspanner/spanneradapters/backendtypes"
	"github.com/GoogleChrome/webstatus.dev/lib/gen/openapi/backend"
)

func TestListChromeDailyUsageStats(t *testing.T) {
	testCases := []struct {
		name               string
		mockConfig         *MockListChromeDailyUsageStatsConfig
		expectedCallCount  int // For the mock method
		request            *http.Request
		expectedResponse   *http.Response
		expectedCacheCalls []*ExpectedCacheCall
		expectedGetCalls   []*ExpectedGetCall
	}{
		{
			name: "Success Case - no optional params - use defaults",
			mockConfig: &MockListChromeDailyUsageStatsConfig{
				expectedFeatureID: "feature1",
				expectedStartAt:   time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC),
				expectedEndAt:     time.Date(2000, time.January, 10, 0, 0, 0, 0, time.UTC),
				expectedPageSize:  100,
				expectedPageToken: nil,
				pageToken:         nil,
				err:               nil,

				data: []backend.ChromeUsageStat{
					{
						Timestamp: time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC),
						Usage:     valuePtr[float64](0.0),
					},
				},
			},
			expectedGetCalls: []*ExpectedGetCall{
				{
					Key: `listChromeDailyUsageStats-{"feature_id":"feature1",` +
						`"Params":{"startAt":"2000-01-01","endAt":"2000-01-10"}}`,
					Value: nil,
					Err:   cachetypes.ErrCachedDataNotFound,
				},
			},
			expectedCacheCalls: []*ExpectedCacheCall{
				{
					Key: `listChromeDailyUsageStats-{"feature_id":"feature1",` +
						`"Params":{"startAt":"2000-01-01","endAt":"2000-01-10"}}`,
					Value: []byte(
						`{"data":[{"timestamp":"2000-01-01T00:00:00Z","usage":0}],"metadata":{}}`,
					),
					CacheCfg: getDefaultCacheConfig(),
				},
			},
			expectedCallCount: 1,
			expectedResponse: testJSONResponse(200, `
{
	"data":[
		{
			"timestamp":"2000-01-01T00:00:00Z",
			"usage":0
		}
	],
	"metadata":{

	}
}`),
			request: httptest.NewRequest(http.MethodGet,
				"/v1/features/feature1/stats/usage/chrome/daily_stats?startAt=2000-01-01&endAt=2000-01-10", nil),
		},
		{
			name:       "Success Case - no optional params - use defaults - cached",
			mockConfig: nil,
			expectedGetCalls: []*ExpectedGetCall{
				{
					Key: `listChromeDailyUsageStats-{"feature_id":"feature1",` +
						`"Params":{"startAt":"2000-01-01","endAt":"2000-01-10"}}`,
					Value: []byte(
						`{"data":[{"timestamp":"2000-01-01T00:00:00Z","usage":0}],"metadata":{}}`,
					),
					Err: nil,
				},
			},
			expectedCacheCalls: nil,
			expectedCallCount:  0,
			expectedResponse: testJSONResponse(200, `
{
	"data":[
		{
			"timestamp":"2000-01-01T00:00:00Z",
			"usage":0
		}
	],
	"metadata":{

	}
}`),
			request: httptest.NewRequest(http.MethodGet,
				"/v1/features/feature1/stats/usage/chrome/daily_stats?startAt=2000-01-01&endAt=2000-01-10", nil),
		},
		{
			name: "400 case - invalid page token",
			mockConfig: &MockListChromeDailyUsageStatsConfig{
				expectedFeatureID: "feature1",
				expectedStartAt:   time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC),
				expectedEndAt:     time.Date(2000, time.January, 10, 0, 0, 0, 0, time.UTC),
				expectedPageSize:  100,
				expectedPageToken: badPageToken,
				pageToken:         nil,
				err:               backendtypes.ErrInvalidPageToken,
				data:              nil,
			},
			expectedCallCount: 1,
			expectedResponse:  testJSONResponse(400, `{"code":400,"message":"invalid page token"}`),
			expectedGetCalls: []*ExpectedGetCall{
				{
					Key: `listChromeDailyUsageStats-{"feature_id":"feature1","Params":{"startAt":"2000-01-01",` +
						`"endAt":"2000-01-10","page_token":""}}`,
					Value: nil,
					Err:   cachetypes.ErrCachedDataNotFound,
				},
			},
			expectedCacheCalls: nil,
			request: httptest.NewRequest(http.MethodGet,
				"/v1/features/feature1/stats/usage/chrome/daily_stats?"+
					"startAt=2000-01-01&endAt=2000-01-10&page_token="+*badPageToken, nil),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// nolint: exhaustruct
			mockStorer := &MockWPTMetricsStorer{
				listChromeDailyUsageStatsCfg: tc.mockConfig,
				t:                            t,
			}
			mockCacher := NewMockRawBytesDataCacher(t, tc.expectedCacheCalls, tc.expectedGetCalls)
			myServer := Server{wptMetricsStorer: mockStorer, metadataStorer: nil,
				operationResponseCaches: initOperationResponseCaches(mockCacher, getTestRouteCacheOptions())}
			assertTestServerRequest(t, &myServer, tc.request, tc.expectedResponse)
			assertMocksExpectations(t, tc.expectedCallCount, mockStorer.callCountListChromeDailyUsageStats,
				"ListChromeDailyUsageStats", mockCacher)
		})
	}
}
