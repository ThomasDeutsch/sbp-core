import { useState, useRef, useMemo } from "react";
import { StagingFunction, ScenariosContext, DispatchCommand } from "@flowcards/core";
import { Scenarios, UpdateCallback } from '../../core/src/index';

export * from '@flowcards/core';

export function useScenarios(stagingFunction: StagingFunction, dependencies: any[]): [ScenariosContext, DispatchCommand] {
    const [context, setContext] = useState<ScenariosContext>();
    const scenariosRef = useRef<Scenarios | null>(null);
    useMemo(() => {
        if(scenariosRef.current !== null) { 
            // do not run this for the initial dependencies
            scenariosRef.current.dispatch({type: 'contextChange'});
        }
    }, dependencies);
    if(scenariosRef.current === null) { 
        // only to this once
        const updateCallback: UpdateCallback = (newContext: ScenariosContext) => { setContext(newContext) }
        scenariosRef.current = new Scenarios(stagingFunction, updateCallback);
    }
    return [context || scenariosRef.current.initialScenariosContext, scenariosRef.current.dispatch];
}