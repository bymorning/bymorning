# Bus runtime

`Bus` is the process-local capability for typed, live Event delivery. It does
not persist Events, replay history, or make domain changes durable. The domain
operation owns its write; an Event only notifies subscribers currently attached
to its Bus.

## Operations

- `publish(definition, data)` validates and delivers one typed Event. It still
  succeeds when there are no subscribers.
- `subscribe()` acquires a scoped live stream. Pass one definition or a
  non-empty tuple of definitions to filter it.

Acquire a subscription before the operation whose notification matters. Its
scope owns the subscription, and closing the scope ends delivery.

```ts
const events = yield * Bus.Service
const stream = yield * events.subscribe(SessionEvent.Created)
yield * events.publish(SessionEvent.Created, { sessionID, session })
```

## Boundaries

`Bus` is neither a database transaction nor an HTTP transport. The server
bridges authorized live Events to the single Workspace stream at `GET
/api/event`. Each connection begins with `server.connected`; it contains no
Event replay or Session-specific stream.

Consumers must treat Events as volatile freshness signals. After connecting or
reconnecting, read the current state from its owning domain (for example,
Session details and Messages) and then apply subsequently received Events.
Missing an Event never erases durable domain state.
