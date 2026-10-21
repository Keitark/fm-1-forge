# Reviewed dependency notices

The published `@cfworker/json-schema` 4.1.1 package declares MIT but omits its license file. Its license here comes from the matching upstream release tag:

https://raw.githubusercontent.com/cfworker/cfworker/%40cfworker%2Fjson-schema%404.1.1/LICENSE.md

SHA-256: `376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094`

The Windows builder checks these exact bytes, includes them in the package notices, and records the upstream URL. It does not download dependencies or notices during a build.
