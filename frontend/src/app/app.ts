import { NgComponentOutlet } from '@angular/common';
import { ApplicationRef, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DRAG_TOKEN, HEIGHT_CHANGE_TOKEN, SCROLL_TOKEN, TAB_ACTIVE_TOKEN } from '@shared/constants';
import { NotifierContainerComponent } from 'angular-notifier';
import { catchError, EMPTY, fromEvent, switchMap } from 'rxjs';
import { browserTimeZone, createDragObservable } from './shared/helpers';
import { HttpService } from './shared/services/http.service';

@Component({
  selector: 'rt-root',
  template: `
    <router-outlet />
    <ng-container *ngComponentOutlet="notifierContainer; injector: rootInjector; environmentInjector: rootInjector" />
  `,
  /**
   * NotifierModule deliberately does NOT appear here. Listing an NgModule that
   * carries providers in a standalone component's `imports` makes Angular spin
   * up a `Standalone[App]` environment injector holding its own copy of every
   * one of those providers — a second NotifierQueueService that the container
   * would then listen on, while errorInterceptor keeps pushing to the root one.
   *
   * NotifierContainerComponent is not standalone, so it cannot go in `imports`
   * directly either. NgComponentOutlet renders it instead, pinned explicitly to
   * the root environment injector so it resolves the same queue the interceptor
   * and every component inject.
   */
  imports: [RouterOutlet, NgComponentOutlet],
  providers: [
    {
      provide: SCROLL_TOKEN,
      useValue: fromEvent(document, 'scroll'),
    },
    {
      provide: HEIGHT_CHANGE_TOKEN,
      useValue: fromEvent(window, 'resize'),
    },
    {
      provide: TAB_ACTIVE_TOKEN,
      useValue: fromEvent(document, 'visibilitychange'),
    },
    {
      provide: DRAG_TOKEN,
      useValue: createDragObservable(),
    },
  ],
})
export class App implements OnInit {
  private readonly _http = inject(HttpService);
  protected readonly notifierContainer = NotifierContainerComponent;

  /**
   * `ApplicationRef.injector` is the root environment injector by definition,
   * so this stays correct even if App later imports an NgModule and does gain a
   * standalone injector of its own.
   */
  protected readonly rootInjector = inject(ApplicationRef).injector;

  ngOnInit(): void {
    this._http.getUiConfig().subscribe();
    // The first browser to load the app gives the server its zone, so poll
    // hours mean what they say here rather than on the server's clock.
    this._http
      .getSettings()
      .pipe(
        switchMap((settings) =>
          settings.id != null && !settings.timeZone ? this._http.fillTimeZone(browserTimeZone()) : EMPTY,
        ),
        catchError(() => EMPTY),
      )
      .subscribe();
  }
}
