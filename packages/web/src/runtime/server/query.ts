import { QueryClient, type QueryKey } from "@tanstack/solid-query"
import { scopeKey, type ServerScope } from "./scope"

export const queryPolicy = {
  retry: false,
  retryOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  staleTime: Infinity,
  throwOnError: false,
} as const

export const createQuery = () =>
  new QueryClient({
    defaultOptions: { queries: queryPolicy, mutations: { retry: false } },
  })

export const matchesScope = (scope: ServerScope, key: QueryKey) =>
  scopeKey(scope).every((part, index) => key[index] === part)

export const recoverDirectory = (client: QueryClient, scope: ServerScope) =>
  client.refetchQueries({
    type: "active",
    predicate: (query) => matchesScope(scope, query.queryKey) && query.queryKey[3] === "project-directory",
  })
