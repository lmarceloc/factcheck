import { useEffect, useReducer } from "react";
import type { Claim, PublicState, Segment, ServerEvent } from "../../src/shared/types";
import { eventsUrl } from "./api";

export interface DebateState {
  data: PublicState | null;
  claims: Map<string, Claim>;
  interim: { speakerId: string; text: string } | null;
  connected: boolean;
}

type Action = ServerEvent | { type: "connection"; connected: boolean };

const MAX_SEGMENTS = 400;

function reducer(state: DebateState, action: Action): DebateState {
  switch (action.type) {
    case "connection":
      return { ...state, connected: action.connected };
    case "snapshot":
      return {
        ...state,
        data: action.state,
        claims: new Map(action.state.claims.map((c) => [c.id, c])),
        interim: null,
      };
    default:
      if (!state.data) return state;
  }
  const data = state.data;
  switch (action.type) {
    case "segment": {
      const segments: Segment[] = [...data.segments, action.segment].slice(-MAX_SEGMENTS);
      return { ...state, data: { ...data, segments }, interim: null };
    }
    case "interim":
      return { ...state, interim: action.text ? { speakerId: action.speakerId, text: action.text } : null };
    case "claim": {
      const claims = new Map(state.claims);
      claims.set(action.claim.id, action.claim);
      return { ...state, claims };
    }
    case "claim_hidden": {
      if (!state.claims.has(action.id)) return state;
      const claims = new Map(state.claims);
      claims.delete(action.id);
      return { ...state, claims };
    }
    case "speaker":
      return { ...state, data: { ...data, currentSpeaker: action.speakerId } };
    case "settings":
      return { ...state, data: { ...data, settings: action.settings } };
    case "audiencia":
      return { ...state, data: { ...data, audiencia: action.audiencia } };
  }
  return state;
}

/** Conecta no fluxo de eventos do servidor e mantém o estado do debate atualizado. */
export function useDebate(view: "operator" | "public"): DebateState {
  const [state, dispatch] = useReducer(reducer, {
    data: null,
    claims: new Map(),
    interim: null,
    connected: false,
  });

  useEffect(() => {
    // EventSource reconecta sozinho; ao reconectar o servidor manda um snapshot novo.
    const source = new EventSource(eventsUrl(view));
    source.onopen = () => dispatch({ type: "connection", connected: true });
    source.onerror = () => dispatch({ type: "connection", connected: false });
    source.onmessage = (msg) => dispatch(JSON.parse(msg.data) as ServerEvent);
    return () => source.close();
  }, [view]);

  return state;
}
