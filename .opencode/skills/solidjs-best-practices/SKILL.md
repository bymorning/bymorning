---
name: SolidJS Best Practices
description: Apply SolidJS reactivity best practices when writing, reviewing, refactoring, or debugging Solid components, signals, props, effects, resources, control flow, lists, and stores.
---

# SolidJS Best Practices

Work with Solid's fine-grained dependency graph. Preserve reactive getters,
read them in tracked scopes, derive values instead of synchronizing state, and
use the primitive that matches the state shape.

## Workflow

1. Identify each reactive source and every place it is read.
2. Confirm reactive reads happen in JSX or another tracked scope.
3. Preserve prop and store getters across component boundaries.
4. Replace synchronized state and avoidable effects with derivations.
5. Use Solid control flow, resources, and stores where their semantics fit.
6. Verify that every changed value updates only its actual dependents.

## Pass Values Through JSX Props

Call signal accessors when passing their current values as JSX props:

```tsx
const [id, setID] = createSignal(0)

return <User id={id()} name="Brenley" />

function User(props: { id: number; name: string }) {
  return (
    <h1>
      {props.id} - {props.name}
    </h1>
  )
}
```

The JSX expression tracks `id()`, while `User` receives an ordinary value and
does not need to know whether its parent used a signal. Pass an accessor only
when the component API intentionally requires an accessor as behavior, not
merely to preserve reactivity.

## Preserve Reactive Props

Read props through the props object. Solid implements reactive props with
getters, and ordinary destructuring captures a value outside the later tracked
read:

```tsx
function User(props: { name: string }) {
  return <h1>{props.name}</h1>
}
```

Use `splitProps` when destructuring is necessary because it preserves reactive
property access:

```tsx
const [local, rest] = splitProps(props, ["name"])
```

## Place Reads In Tracked Scopes

A component body is setup code and runs once. JSX, `createMemo`, and
`createEffect` establish tracked scopes. Delay a computation with an accessor
when it must be evaluated reactively:

```tsx
const [count, setCount] = createSignal(0)
const doubled = () => count() * 2

return <div>{doubled()}</div>
```

Use `createMemo` when a derived computation is expensive, is read in multiple
places, or should notify dependents only when its result changes:

```tsx
const doubled = createMemo(() => count() * 2)

return (
  <>
    <div>{doubled()}</div>
    <Output value={doubled()} />
  </>
)
```

## Use Solid Control Flow

Prefer `<Show>` for conditional rendering. It expresses a tracked condition,
supports a fallback, and controls when children are evaluated:

```tsx
<Show when={open()} fallback={<EmptyState />}>
  <SidebarMenu />
</Show>
```

Prefer `<For>` over mapping a reactive array in JSX. `<For>` preserves item
identity and updates only the affected DOM as the list changes:

```tsx
<For each={items()}>{(item) => <Item item={item} />}</For>
```

## Keep Effects At The Boundary

Use `createEffect` sparingly. Effects are for synchronizing with the outside
world, such as imperative DOM APIs or third-party libraries that Solid does
not control.

Use `createResource` for asynchronous data rather than fetching into a signal
from an effect. It supplies lifecycle semantics, integrates with Suspense and
error boundaries, and prevents stale requests from winning:

```tsx
const [posts] = createResource(() => fetch("/api/posts").then((response) => response.json()))
```

Derive state relationships directly rather than using an effect to synchronize
one signal from others:

```tsx
const [firstName, setFirstName] = createSignal("John")
const [lastName, setLastName] = createSignal("Doe")
const fullName = () => `${firstName()} ${lastName()}`
```

## Derive As Much As Possible

Represent a value as a function of its sources rather than as separately
mutable state. This keeps the relationship explicit and inside Solid's
dependency graph:

```tsx
const [count, setCount] = createSignal(0)
const double = createMemo(() => count() * 2)
```

Use a plain accessor for cheap derivations read in one place and a memo when
caching or downstream equality matters.

## Use Stores For Structured State

Use signals for scalar values and simple references. Use `createStore` for
complex or nested objects whose properties change independently. Stores track
property paths, so a consumer of `board.notes` does not react to a change in
`board.boards`:

```tsx
const [board, setBoard] = createStore({
  boards: ["Board 1", "Board 2"],
  notes: ["Note 1", "Note 2"],
  settings: { theme: "light" },
})

setBoard("notes", (notes) => [...notes, "Note 3"])

return (
  <>
    <ThemeDisplay theme={board.settings.theme} />
    <NotesList notes={board.notes} />
  </>
)
```

Update stores through their setter and read the narrowest property needed in a
tracked scope. Replacing an entire object held in a signal invalidates every
consumer of that signal, even when only one nested property changed.

## Source

Adapted for this repository from Brenelz, [Solid.js Best
Practices](https://www.brenelz.com/posts/solid-js-best-practices/) (January 12,
2026).
