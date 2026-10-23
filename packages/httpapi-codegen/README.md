# @bymorning/httpapi-codegen

Private build-time source generation for Promise and Effect clients derived from an Effect `HttpApi` contract.

The generated Promise runtime uses `fetch` and has no Effect runtime dependency. The generated Effect runtime uses `HttpApiClient` and imports the authoritative protocol contract.

ByMorning generation reflects the complete portable `@bymorning/protocol` `Api`; runtime-specific Account, Workspace, and Key middleware implementations do not create alternate protocol contracts.
