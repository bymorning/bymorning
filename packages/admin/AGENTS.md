# Admin Package Agent Guide

`@bymorning/admin` is a separate HTTP surface mounted at `/admin`. It is not
part of the public Protocol contract and must not be added to `makeApi` or
generated into `@bymorning/client`.

The server host registers it with a second `HttpApiBuilder.layer(AdminApi)`
beside the product API.
