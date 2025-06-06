/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {customElement, state} from 'lit/decorators.js';
import {ServiceElement} from './service-element.js';
import {consume, provide} from '@lit/context';
import {
  AppBookmarkInfo,
  SavedSearchError,
  SavedSearchInternalError,
  SavedSearchNotFoundError,
  SavedSearchUnknownError,
  UserSavedSearchesInternalError,
  UserSavedSearchesUnknownError,
  appBookmarkInfoContext,
} from '../contexts/app-bookmark-info-context.js';
import {
  DEFAULT_GLOBAL_SAVED_SEARCHES,
  GlobalSavedSearch,
  SavedSearch,
  UserSavedSearch,
} from '../utils/constants.js';
import {
  QueryStringOverrides,
  getSearchID,
  getSearchQuery,
  updatePageUrl,
} from '../utils/urls.js';
import {
  AppLocation,
  getCurrentLocation,
  navigateToUrl,
} from '../utils/app-router.js';
import {APIClient, apiClientContext} from '../contexts/api-client-context.js';
import {User} from 'firebase/auth';
import {firebaseUserContext} from '../contexts/firebase-user-context.js';
import {Task, TaskStatus} from '@lit/task';
import {NotFoundError, ApiError} from '../api/errors.js';
import {TaskTracker} from '../utils/task-tracker.js';
import {Toast} from '../utils/toast.js';
import {PropertyValueMap} from 'lit';

interface GetLocationFunction {
  (): AppLocation;
}

@customElement('webstatus-bookmarks-service')
export class WebstatusBookmarksService extends ServiceElement {
  @provide({context: appBookmarkInfoContext})
  appBookmarkInfo: AppBookmarkInfo = {
    userSavedSearchTask: {
      status: TaskStatus.INITIAL,
      error: undefined,
      data: undefined,
    },
    userSavedSearchesTask: {
      status: TaskStatus.INITIAL,
      error: undefined,
      data: undefined,
    },
  };

  @consume({context: apiClientContext, subscribe: true})
  @state()
  apiClient?: APIClient;
  @consume({context: firebaseUserContext, subscribe: true})
  @state()
  user: User | null | undefined;

  _userSavedSearchByIDTaskTracker?: TaskTracker<
    UserSavedSearch,
    SavedSearchError
  > & {query?: string} = undefined;
  _currentSearchID: string = '';
  _currentSearchQuery: string = '';

  _userSavedSearchesTaskTracker?: TaskTracker<
    UserSavedSearch[],
    SavedSearchError
  > = undefined;

  loadingUserSavedSearchByIDTask = new Task(this, {
    autoRun: false,
    args: () =>
      [
        this._currentSearchID,
        this._currentSearchQuery,
        this.apiClient,
        this.user,
      ] as const,
    task: async ([searchID, searchQuery, apiClient, user]) => {
      if (searchID === '') {
        return undefined;
      }

      // Get the search ID of the previously executed task (if any).
      const previousTaskSearchID =
        this._userSavedSearchByIDTaskTracker?.data?.id;

      // Check if the current request is for the same saved search (same searchID)
      // as a previously initiated task.
      if (searchID === previousTaskSearchID) {
        // Return the previous request's data
        return {
          search: this._userSavedSearchByIDTaskTracker?.data,
          query: searchQuery,
        };
      }
      let token: string | undefined;
      if (user) {
        token = await user.getIdToken();
      }
      this._userSavedSearchByIDTaskTracker = {
        status: TaskStatus.PENDING,
        data: undefined,
        error: undefined,
      };
      this.refreshAppBookmarkInfo();

      const savedSearch = await apiClient!.getSavedSearchByID(searchID!, token);
      return {search: savedSearch, query: searchQuery};
    },
    onComplete: data => {
      this._userSavedSearchByIDTaskTracker = {
        status: TaskStatus.COMPLETE,
        data: undefined,
        error: undefined,
      };

      if (data === undefined) {
        this.refreshAppBookmarkInfo();
        return;
      }

      this._userSavedSearchByIDTaskTracker.data = data.search;

      const q = data.query;
      if (q && data.search?.query === q) {
        // Clear out the "q" query parameter if it is the same as the saved search.
        // Only keep the "q" query parameter if it is different from the saved search which indicates we are doing an edit.
        this.updatePageUrl(
          this._currentLocation!.pathname,
          this._currentLocation!,
          {
            q: '',
          },
        );
      }
      this.refreshAppBookmarkInfo();
    },
    onError: async (error: unknown) => {
      // The task only runs with _currentSearchID being valid
      const searchID = this._currentSearchID!;
      let err: SavedSearchError;
      if (error instanceof NotFoundError) {
        err = new SavedSearchNotFoundError(searchID);
      } else if (error instanceof ApiError) {
        err = new SavedSearchInternalError(searchID, error.message);
      } else {
        err = new SavedSearchUnknownError(searchID, error);
      }

      this._userSavedSearchByIDTaskTracker = {
        status: TaskStatus.ERROR,
        error: err,
        data: undefined,
        query: this._userSavedSearchByIDTaskTracker?.query,
      };
      this.refreshAppBookmarkInfo();
      // Clear out the bad "search_id" query parameter.
      this.updatePageUrl(
        this._currentLocation!.pathname,
        this._currentLocation!,
        {
          search_id: '',
        },
      );

      // TODO: Reconsider showing the toast in one of the UI components once we have one central
      // UI component that reads the bookmark info instead of the current multiple locations.
      // This will keep the service as purely logical and let the UI component handle the error.
      await new Toast().toast(err.message, 'danger', 'exclamation-triangle');
    },
  });

  loadingUserSavedSearchesTask = new Task(this, {
    autoRun: false,
    args: () => [this.apiClient, this.user] as const,
    task: async ([apiClient, user]) => {
      if (user === null) {
        return undefined;
      }
      const token = await user!.getIdToken();
      this._userSavedSearchesTaskTracker = {
        status: TaskStatus.PENDING,
        data: undefined,
        error: undefined,
      };
      this.refreshAppBookmarkInfo();

      return await apiClient!.getAllUserSavedSearches(token);
    },
    onComplete: data => {
      this._userSavedSearchesTaskTracker = {
        status: TaskStatus.COMPLETE,
        data: data,
        error: undefined,
      };
      this.refreshAppBookmarkInfo();
    },
    onError: async (error: unknown) => {
      let err: SavedSearchError;
      if (error instanceof ApiError) {
        err = new UserSavedSearchesInternalError(error.message);
      } else {
        err = new UserSavedSearchesUnknownError(error);
      }

      this._userSavedSearchesTaskTracker = {
        status: TaskStatus.ERROR,
        error: err,
        data: undefined,
      };
      this.refreshAppBookmarkInfo();

      // TODO: Reconsider showing the toast in one of the UI components once we have one central
      // UI component that reads the bookmark info instead of the current multiple locations.
      // This will keep the service as purely logical and let the UI component handle the error.
      await new Toast().toast(err.message, 'danger', 'exclamation-triangle');
    },
  });

  _globalSavedSearches: GlobalSavedSearch[];
  _currentGlobalSavedSearch?: GlobalSavedSearch;
  // A snapshot of the current location that relates to the saved search
  // information currently loaded by the service.
  // Typically, we should only update this on navigation events which indicates
  // that we should probably refresh the bookmark information.
  _currentLocation?: AppLocation;

  protected willUpdate(changedProperties: PropertyValueMap<this>): void {
    if (
      changedProperties.has('_currentLocation') ||
      changedProperties.has('apiClient') ||
      changedProperties.has('user')
    ) {
      // If the user's status has not been decided yet, wait
      if (this.user === undefined) {
        return;
      }
      const incomingSearchID = this.getSearchID(
        this._currentLocation ?? {search: '', href: '', pathname: ''},
      );
      const incomingSearchQuery = this.getSearchQuery(
        this._currentLocation ?? {search: ''},
      );
      if (
        // If the there's a new search id we need to search
        this._currentSearchID !== incomingSearchID ||
        // If the search id is empty, allow the task to run as it will quickly return undefined to mark it as complete
        incomingSearchID === '' ||
        // If there's a new search query that we may need to consider during edit mode
        incomingSearchQuery !== this._currentSearchQuery
      ) {
        this._currentSearchQuery = incomingSearchQuery;
        this._currentSearchID = incomingSearchID;
        void this.loadingUserSavedSearchByIDTask.run();
      }
    }

    if (
      (changedProperties.has('apiClient') || changedProperties.has('user')) &&
      this.apiClient !== undefined &&
      this.user !== undefined
    ) {
      void this.loadingUserSavedSearchesTask.run();
    }
  }

  // Helper for testing.
  getLocation: GetLocationFunction = getCurrentLocation;
  getSearchID: (location: AppLocation) => string = getSearchID;
  getSearchQuery: (location: {search: string}) => string = getSearchQuery;
  updatePageUrl: (
    pathname: string,
    location: {search: string},
    overrides: QueryStringOverrides,
  ) => void = updatePageUrl;
  navigateToUrl: (url: string, event?: MouseEvent) => void = navigateToUrl;

  constructor() {
    super();
    this._globalSavedSearches = DEFAULT_GLOBAL_SAVED_SEARCHES;
  }

  private handlePopState() {
    this._currentLocation = this.getLocation();
    this._currentGlobalSavedSearch = this.findCurrentSavedSearchByQuery(
      this.appBookmarkInfo.globalSavedSearches,
    );
    this.refreshAppBookmarkInfo();
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._currentLocation = this.getLocation();
    // findCurrentSavedSearchByQuery depends on an updated location.
    // The location is not in the constructor. So we use the connectedCallback
    this._currentGlobalSavedSearch = this.findCurrentSavedSearchByQuery(
      this._globalSavedSearches,
    );
    window.addEventListener('popstate', this.handlePopState.bind(this));
    this.addEventListener('saved-search-saved', this.handleSavedSearchSaved);
    this.addEventListener('saved-search-edited', this.handleSavedSearchEdited);
    this.addEventListener(
      'saved-search-deleted',
      this.handleSavedSearchDeleted,
    );
    // saved-search-bookmarked return UserSavedSearch. Use the same event handler as saved-search-saved
    this.addEventListener(
      'saved-search-bookmarked',
      this.handleSavedSearchSaved,
    );
    // saved-search-unbookmarked return the id. Use the same event handler as saved-search-deleted
    this.addEventListener(
      'saved-search-unbookmarked',
      this.handleSavedSearchDeleted,
    );
    this.refreshAppBookmarkInfo();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('saved-search-saved', this.handleSavedSearchSaved);
    this.removeEventListener(
      'saved-search-edited',
      this.handleSavedSearchEdited,
    );
    this.removeEventListener(
      'saved-search-deleted',
      this.handleSavedSearchDeleted,
    );
    this.removeEventListener(
      'saved-search-bookmarked',
      this.handleSavedSearchSaved,
    );
    this.removeEventListener(
      'saved-search-unbookmarked',
      this.handleSavedSearchDeleted,
    );
    window.removeEventListener('popstate', this.handlePopState.bind(this));
  }

  findCurrentSavedSearchByQuery(
    savedSearches?: SavedSearch[],
  ): SavedSearch | undefined {
    const currentQuery = this.getSearchQuery(
      this._currentLocation ?? {search: ''},
    );
    return savedSearches?.find(search => search.query === currentQuery);
  }

  handleSavedSearchSaved = (e: Event) => {
    // TODO: we should figure out a way to avoid the type assertion here.
    const event = e as CustomEvent<UserSavedSearch>;
    const savedSearch = event.detail;

    if (
      this._userSavedSearchesTaskTracker === undefined ||
      this._userSavedSearchesTaskTracker?.data === undefined
    ) {
      this._userSavedSearchesTaskTracker = {
        status: TaskStatus.COMPLETE,
        data: [savedSearch],
        error: undefined,
      };
    } else {
      this._userSavedSearchesTaskTracker.data = [
        ...this._userSavedSearchesTaskTracker.data,
        savedSearch,
      ];
    }

    if (
      this._userSavedSearchByIDTaskTracker === undefined ||
      this._userSavedSearchByIDTaskTracker?.data === undefined
    ) {
      this._userSavedSearchByIDTaskTracker = {
        status: TaskStatus.COMPLETE,
        data: savedSearch,
        error: undefined,
      };
    } else {
      this._userSavedSearchByIDTaskTracker.data = savedSearch;
    }

    this.updatePageUrl(
      this._currentLocation!.pathname,
      this._currentLocation!,
      {
        search_id: savedSearch.id,
        // Clear out q query parameter if present
        q: undefined,
      },
    );
    this._currentLocation = this.getLocation();
    this.refreshAppBookmarkInfo();
  };

  handleSavedSearchEdited = (e: Event) => {
    // TODO: we should figure out a way to avoid the type assertion here.
    const event = e as CustomEvent<UserSavedSearch>;
    const editedSearch = event.detail;

    if (this._userSavedSearchesTaskTracker?.data) {
      this._userSavedSearchesTaskTracker.data =
        this._userSavedSearchesTaskTracker?.data?.map(search => {
          if (search.id === editedSearch.id) {
            return editedSearch;
          }
          return search;
        });
    }

    if (
      this._userSavedSearchByIDTaskTracker &&
      this._userSavedSearchByIDTaskTracker?.data?.id === editedSearch.id
    ) {
      this._userSavedSearchByIDTaskTracker.data = editedSearch;
    }

    this.refreshAppBookmarkInfo();
  };

  handleSavedSearchDeleted = (e: Event) => {
    // TODO: we should figure out a way to avoid the type assertion here.
    const event = e as CustomEvent<string>;
    const deletedSearchId = event.detail;
    if (this._userSavedSearchesTaskTracker?.data) {
      this._userSavedSearchesTaskTracker.data =
        this._userSavedSearchesTaskTracker?.data?.filter(
          search => search.id !== deletedSearchId,
        );
      // Clear out the search id from the URL
      this.updatePageUrl(
        this._currentLocation!.pathname,
        this._currentLocation!,
        {
          search_id: '',
        },
      );
    }
    if (
      this._userSavedSearchByIDTaskTracker &&
      this._userSavedSearchByIDTaskTracker?.data?.id === deletedSearchId
    ) {
      this._userSavedSearchByIDTaskTracker.data = undefined;
    }

    this._currentLocation = this.getLocation();
    this.refreshAppBookmarkInfo();
  };

  // Assign the appBookmarkInfo object to trigger a refresh of subscribed contexts
  refreshAppBookmarkInfo() {
    this.appBookmarkInfo = {
      globalSavedSearches: this._globalSavedSearches,
      currentGlobalSavedSearch: this._currentGlobalSavedSearch,
      userSavedSearchTask: this._userSavedSearchByIDTaskTracker,
      currentLocation: this._currentLocation,
      userSavedSearchesTask: this._userSavedSearchesTaskTracker,
    };
  }
}
