import { EventEmitter } from 'events';

export const swarmEventBus = new EventEmitter();
swarmEventBus.setMaxListeners(100);

export function emitSwarmEvent(event) {
  swarmEventBus.emit('swarm_event', event);
}
