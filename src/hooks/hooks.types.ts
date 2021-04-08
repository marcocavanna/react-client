import {
  WebSocketEvent
} from '../lib/client.interfaces';


export interface UseWebSocketEventConfig extends Partial<WebSocketEvent> {
  /** Choose if is active or not */
  active?: boolean;

  /** Handle the Event */
  onEvent?: (event: WebSocketEvent) => void | Promise<void>;
}
