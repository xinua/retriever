import { Component, computed, inject, input, resource } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { HighlightJS } from 'ngx-highlightjs';

// Matches placeholders like <webhook_id> or <:downloads_dir> after hljs escaped them
const PLACEHOLDER_RE = /&lt;:?\w+&gt;/g;

@Component({
  selector: 'rt-code',
  imports: [MatIcon, MatTooltip],
  templateUrl: './code.html',
  styleUrl: './code.css',
})
export class Code {
  private readonly _notify = inject(NotifierService);
  private readonly _hljs = inject(HighlightJS);

  readonly code = input<string>();
  readonly language = input.required<string>();

  private readonly _highlighted = resource({
    params: () => ({ code: this.code() ?? '', language: this.language() }),
    loader: ({ params }) => this._hljs.highlight(params.code, { language: params.language }),
  });

  protected readonly html = computed(() =>
    this._highlighted.value()?.value.replace(PLACEHOLDER_RE, (match) => `<span class="text-red-500">${match}</span>`),
  );

  copyToClipboard() {
    navigator.clipboard.writeText(this.code());
    this._notify.notify('success', 'Code copied to clipboard');
  }
}
