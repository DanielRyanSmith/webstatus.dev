/**
 * Copyright 2023 Google LLC
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

import {LitElement, type TemplateResult, CSSResultGroup, css, html} from 'lit';
import {TaskStatus} from '@lit/task';
import {customElement, state} from 'lit/decorators.js';
import {type components} from 'webstatus.dev-backend';

import './webstatus-overview-filters.js';
import './webstatus-overview-table.js';
import './webstatus-overview-pagination.js';
import {SHARED_STYLES} from '../css/shared-css.js';
import {TaskTracker} from '../utils/task-tracker.js';
import {ApiError} from '../api/errors.js';
import {consume} from '@lit/context';
import {
  WebFeatureProgress,
  webFeatureProgressContext,
} from '../contexts/webfeature-progress-context.js';
import {Toast} from '../utils/toast.js';

const webFeaturesRepoUrl = 'https://github.com/web-platform-dx/web-features';

@customElement('webstatus-overview-content')
export class WebstatusOverviewContent extends LitElement {
  @state()
  taskTracker: TaskTracker<components['schemas']['FeaturePage'], ApiError> = {
    status: TaskStatus.INITIAL, // Initial state
    error: null,
    data: null,
  };

  @state()
  location!: {search: string}; // Set by parent.

  @consume({context: webFeatureProgressContext, subscribe: true})
  @state()
  webFeaturesProgress?: WebFeatureProgress;

  static get styles(): CSSResultGroup {
    return [
      SHARED_STYLES,
      css`
        .header-line {
          gap: 1em;
        }
        .stats-summary {
          color: var(--unimportant-text-color);
          margin-right: var(--content-padding);
        }
      `,
    ];
  }

  renderMappingPercentage(): TemplateResult {
    if (
      this.webFeaturesProgress === undefined ||
      this.webFeaturesProgress.isDisabled
    ) {
      return html``;
    }
    if (this.webFeaturesProgress.error) {
      // Temporarily to avoid the no-floating-promises error.
      void new Toast().toast(
        this.webFeaturesProgress.error,
        'danger',
        'exclamation-triangle',
      );
      return html``;
    }
    return html`Percentage of features mapped:&nbsp;
      <a href="${webFeaturesRepoUrl}">
        ${
          this.webFeaturesProgress.bcdMapProgress
            ? this.webFeaturesProgress.bcdMapProgress
            : 0 // The else case that returns 0 should not happen.
        }%
      </a>`;
  }

  renderCount(): TemplateResult {
    switch (this.taskTracker.status) {
      case TaskStatus.INITIAL:
      case TaskStatus.PENDING:
        return html`Loading features...`;
      case TaskStatus.COMPLETE:
        return html`
          <span class="stats-summary">
            ${this.taskTracker.data?.metadata.total ?? 0} features
          </span>
        `;
      case TaskStatus.ERROR:
        return html`Failed to load features`;
    }
  }

  render(): TemplateResult {
    return html`
      <div class="main">
        <div class="hbox halign-items-space-between header-line">
          <h1 class="halign-stretch">Features overview</h1>
        </div>
        <div class="hbox wrap">
          ${this.renderCount()}
          <div class="spacer"></div>
          <div id="mapping-percentage" class="hbox wrap">
            ${this.renderMappingPercentage()}
          </div>
        </div>
        <br />
        <webstatus-overview-filters
          .location=${this.location}
        ></webstatus-overview-filters>
        <br />

        <webstatus-overview-table
          .location=${this.location}
          .features=${this.taskTracker.data}
          .taskTracker=${this.taskTracker}
        >
        </webstatus-overview-table>
        <webstatus-overview-pagination
          .location=${this.location}
          .totalCount=${this.taskTracker.data?.metadata.total ?? 0}
        ></webstatus-overview-pagination>
      </div>
    `;
  }
}
