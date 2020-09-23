import * as Rx from "rxjs";
import * as Fc from "@flowcards/core";

export * from '@flowcards/core';

export function initScenarios(stagingFunction: Fc.StagingFunction): [Rx.BehaviorSubject<Fc.ScenariosContext>, Fc.DispatchActions, Fc.PlayPause] {
  const [init, dispatch, startReplay] = Fc.scenarios(stagingFunction, (a: Fc.ScenariosContext): void => {
      subject.next(a);
  });
  const subject = new Rx.BehaviorSubject<Fc.ScenariosContext>(init);
  return [subject, dispatch, startReplay];
}